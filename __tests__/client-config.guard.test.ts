/**
 * Client-config guard (REQ-SRV-019, issue #197; REQ-SRV-023, #160).
 *
 * Every server gets its bConnect client from the core's `serverClients()` and
 * starts through the core's `runServer()`, so the documented environment
 * reaches every client of every server the same way, and the startup check
 * uses the same client as the tool calls.
 *
 * - Through the real call path: one tool per server via `createServer()`; the
 *   config of the client it uses must carry the CA, TLS, credential, audit and
 *   rate-limit settings.
 * - In the source: no server reads a client variable itself, builds a client,
 *   loads .env or starts a transport; each calls `serverClients()` and `runServer()`.
 * - Through the built servers: startup messages (missing settings, skipped check).
 *
 * The groups server once read an undocumented BCONNECT_REJECT_UNAUTHORIZED here
 * and ignored the CA: its probe passed and every tool failed TLS.
 * The runtime check started as the guard test of PR #193.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { resetServerClients, type BConnectConfig } from '@bconnect/mcp-core';
import { ROOT, SERVERS, connect, createRecorder, guardEnv, requiredArguments, type ToolResult } from './lib/exerciser.js';
import { envReads } from './lib/env-reads.js';

const built = vi.hoisted(() => [] as BConnectConfig[]);

// Record the configuration of every client a server builds; behavior is unchanged.
vi.mock('@bconnect/mcp-core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@bconnect/mcp-core')>();
  class RecordingClientBase extends core.BConnectClientBase {
    constructor(config: BConnectConfig) {
      built.push(config);
      super(config);
    }
  }
  return { ...core, BConnectClientBase: RecordingClientBase };
});

/** The variables that configure the bConnect client; only the core helper reads them. */
const CLIENT_VARS = [
  'BCONNECT_BASE_URL',
  'BCONNECT_USERNAME',
  'BCONNECT_PASSWORD',
  'BCONNECT_API_KEY',
  'BCONNECT_CA_CERT_PATH',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'BCONNECT_AUDIT_LEVEL',
  'BCONNECT_RATE_LIMIT_ENABLED',
  'BCONNECT_RATE_LIMIT_MAX_REQUESTS',
  'BCONNECT_RATE_LIMIT_WINDOW_MS',
  // Removed (REQ-SRV-019 AC 3); no server may bring it back.
  'BCONNECT_REJECT_UNAUTHORIZED',
];
const MISSING_CREDENTIALS = 'Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required';

const CA = '-----BEGIN CERTIFICATE-----\nguard-test-ca\n-----END CERTIFICATE-----\n';
const dir = mkdtempSync(join(tmpdir(), 'client-config-'));
const caPath = join(dir, 'ca.pem');
const recorder = createRecorder();

beforeAll(() => {
  writeFileSync(caPath, CA);
  recorder.listen();
});
afterAll(() => {
  recorder.close();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

/** Every client variable is set, '' unless given: dotenv never overrides a present key. */
function setEnv(env: Record<string, string>): void {
  const all = {
    ...Object.fromEntries(CLIENT_VARS.map((v) => [v, ''])),
    ...guardEnv('26R1', { writes: false, secretRead: false }),
    ...env,
  };
  for (const [key, value] of Object.entries(all)) vi.stubEnv(key, value);
}

/** The result of the server's first read tool (never gated), under `env`. */
async function firstReadToolResult(server: string, env: Record<string, string>): Promise<ToolResult> {
  setEnv(env);
  const conn = await connect(server);
  try {
    const tool = conn.tools.find((t) => /^(list|get)_/.test(t.name));
    if (!tool) throw new Error(`${server}: no read tool`);
    return await conn.call(tool.name, requiredArguments(tool.inputSchema));
  } finally {
    await conn.close();
  }
}

/**
 * The config of the client a server builds for a tool call, under `env`.
 * Tries the server's tools in order and takes the first call that builds a
 * client (a gated write tool refuses before building one). Throws when none does.
 */
async function clientConfig(
  server: string,
  env: Record<string, string>,
  opts: { credentials?: Record<string, string>; tools?: string[] } = {},
): Promise<BConnectConfig> {
  setEnv(env);
  // Each server keeps one client per process; forget it so this call builds one from `env`.
  resetServerClients();
  const conn = await connect(server, opts.credentials);
  try {
    const tools = opts.tools
      ? opts.tools.map((name) => ({ name, inputSchema: {} }))
      : conn.tools;
    for (const tool of tools) {
      built.length = 0;
      await conn.call(tool.name, requiredArguments(tool.inputSchema));
      const config = built.at(-1);
      if (config) return config;
    }
  } finally {
    await conn.close();
  }
  throw new Error(`${server}: no tool call built a client`);
}

/** Every file that is compiled into the build: generated code too, test files not. */
const sourceFiles = (dirPath: string): string[] =>
  readdirSync(dirPath, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.[mc]?ts$/.test(e.name) && !/\.d\.[mc]?ts$/.test(e.name))
    .map((e) => join(e.parentPath, e.name))
    .filter((f) => !/[\\/](__tests__|__mocks__)[\\/]/.test(f));

/** Server packages plus the template a new server is copied from. */
const SOURCE_PACKAGES = [...SERVERS, 'bconnect-server-template'].filter((d) =>
  existsSync(join(ROOT, d, 'src', 'index.ts')),
);

describe('guard self-tests', () => {
  it('finds the servers from the repo', () => {
    expect(SERVERS.length).toBeGreaterThanOrEqual(13);
    expect(SOURCE_PACKAGES).toContain('bconnect-server-template');
    expect(SOURCE_PACKAGES).toContain('bconnect-groups-mcp');
  });

  it('skips a tool that builds no client and takes the next one', async () => {
    const config = await clientConfig('bconnect-endpoints-mcp', {}, { tools: ['delete_endpoint', 'list_endpoints'] });
    expect(config.baseUrl).toBeDefined();
  });

  it('fails when the tool call builds no client', async () => {
    // Writes are off: the write gate refuses before a client is built.
    await expect(
      clientConfig('bconnect-endpoints-mcp', {}, { tools: ['delete_endpoint'] }),
    ).rejects.toThrow(/no tool call built a client/);
  });

  describe('envReads', () => {
    it.each([
      ['property access', 'const x = process.env.BCONNECT_CA_CERT_PATH;', 'BCONNECT_CA_CERT_PATH'],
      ['element access', "const x = process.env['BCONNECT_AUDIT_LEVEL'];", 'BCONNECT_AUDIT_LEVEL'],
      ['template key', 'const x = process.env[`NODE_TLS_REJECT_UNAUTHORIZED`];', 'NODE_TLS_REJECT_UNAUTHORIZED'],
      ['destructuring', 'const { BCONNECT_API_KEY } = process.env;', 'BCONNECT_API_KEY'],
      ['renamed destructuring', 'const { BCONNECT_RATE_LIMIT_ENABLED: on } = process.env;', 'BCONNECT_RATE_LIMIT_ENABLED'],
      ['env parameter', 'function f(env = process.env) { return env.BCONNECT_BASE_URL; }', 'BCONNECT_BASE_URL'],
      ['groups-style switch', "rejectUnauthorized: process.env.BCONNECT_REJECT_UNAUTHORIZED !== 'false'", 'BCONNECT_REJECT_UNAUTHORIZED'],
      ['globalThis', 'const x = globalThis.process.env.BCONNECT_REJECT_UNAUTHORIZED;', 'BCONNECT_REJECT_UNAUTHORIZED'],
      ['process element access', "const x = process['env'].BCONNECT_CA_CERT_PATH;", 'BCONNECT_CA_CERT_PATH'],
      ['process behind a type assertion', 'const x = (process as NodeJS.Process).env.BCONNECT_REJECT_UNAUTHORIZED;', 'BCONNECT_REJECT_UNAUTHORIZED'],
      ['process behind !', 'const x = process!.env.BCONNECT_CA_CERT_PATH;', 'BCONNECT_CA_CERT_PATH'],
      ['process in parentheses', 'const x = (process).env.BCONNECT_CA_CERT_PATH;', 'BCONNECT_CA_CERT_PATH'],
      ['globalThis behind a type assertion', 'const x = (globalThis as any).process.env.BCONNECT_CA_CERT_PATH;', 'BCONNECT_CA_CERT_PATH'],
    ])('sees a %s read', (_label, source, name) => {
      expect(envReads(source).map((r) => r.name)).toContain(name);
    });

    it.each([
      ['copied into a variable', 'const e = process.env; e.BCONNECT_CA_CERT_PATH;'],
      ['spread', 'const e = { ...process.env };'],
      ['computed key', 'const k = "X"; process.env[k];'],
      ['rest element', 'const { ...all } = process.env;'],
      ['passed to another function', 'readSettings(process.env);'],
      ['destructured from process', 'const { env: pe } = process; pe.BCONNECT_CA_CERT_PATH;'],
      ['reached through a copy of process', 'const p = process; p.env.BCONNECT_CA_CERT_PATH;'],
      ['reached through process passed on', 'readSettings(process);'],
      ['imported under another name', 'import * as p from "node:process"; p.env.BCONNECT_CA_CERT_PATH;'],
      ['imported as env', 'import { env as e } from "process"; e.BCONNECT_CA_CERT_PATH;'],
      ['required', 'const p = require("node:process"); p.env.BCONNECT_CA_CERT_PATH;'],
      ['imported dynamically', 'const p = await import("node:process"); p.env.BCONNECT_CA_CERT_PATH;'],
      ['re-exported from another file', 'export { env } from "node:process";'],
      ['reached through a copy of globalThis', 'const g = globalThis; g.process.env.BCONNECT_CA_CERT_PATH;'],
      ['the default of a parameter not named env', 'function f(e = process.env) { return e.BCONNECT_CA_CERT_PATH; }'],
      ['copied from behind a type assertion', 'const e = (process as any).env; e.BCONNECT_CA_CERT_PATH;'],
      ['passed to a class extends clause', 'class A extends mixin(process) {}'],
      ['globalThis passed to a class extends clause', 'class A extends mixin(globalThis) {}'],
    ])('reports a hidden read when process.env is %s', (_label, source) => {
      expect(envReads(source).some((r) => r.name === null)).toBe(true);
    });

    it('ignores names in comments, strings and log messages', () => {
      const source = [
        '// reads process.env.BCONNECT_CA_CERT_PATH',
        'console.error("Check BCONNECT_BASE_URL and process.env.BCONNECT_API_KEY");',
        'const s = `set NODE_TLS_REJECT_UNAUTHORIZED=0`;',
      ].join('\n');
      expect(envReads(source)).toEqual([]);
    });

    it.each([
      ['a property name', 'const o = { process: "x", globalThis: 1 }; interface J { process: string }'],
      ['a class property or method name', 'class C { process = 1; globalThis() {} }'],
      ['an interface extends clause', 'interface J extends Base<typeof process> {}'],
      ['a type position', 'type G = typeof globalThis; let p: typeof process;'],
      ['declare global', 'declare global { var x: number }'],
      ['a typeof test', 'if (typeof globalThis !== "undefined" && typeof process === "object") {}'],
      ['a member behind a type assertion', '(globalThis as any).fetch; (process as NodeJS.Process).exit(0);'],
    ])('does not report %s as a hidden read', (_label, source) => {
      expect(envReads(source)).toEqual([]);
    });

    it('allows other members of process', () => {
      expect(envReads('process.exit(1); process.stdout.write("x"); globalThis.process.on("exit", f);')).toEqual([]);
    });

    it('allows handing process.env to the helper', () => {
      expect(envReads('const c = clientConfigFromEnv(process.env, credentials);')).toEqual([]);
    });
  });

  describe('stale build', () => {
    const tree = (buildAge: number, sourceAges: number[]) => {
      const root = mkdtempSync(join(dir, 'stale-'));
      const now = Date.now() / 1000;
      mkdirSync(join(root, 'build'));
      mkdirSync(join(root, 'src', 'modules'), { recursive: true });
      writeFileSync(join(root, 'build', 'index.js'), '');
      utimesSync(join(root, 'build', 'index.js'), now - buildAge, now - buildAge);
      sourceAges.forEach((age, i) => {
        const file = join(root, 'src', i === 0 ? 'index.ts' : join('modules', `m${i}.ts`));
        writeFileSync(file, '');
        utimesSync(file, now - age, now - age);
      });
      return root;
    };

    it('accepts a build newer than every source', () => {
      expect(staleBuild(tree(10, [100, 100]), [])).toBeUndefined();
    });

    it('reports a build older than any source file, not only index.ts', () => {
      expect(staleBuild(tree(10, [100, 1]), [])).toMatch(/older than/);
    });

    it('reports a build older than the core sources', () => {
      const core = tree(0, [1]);
      expect(staleBuild(tree(10, [100]), [join(core, 'src')])).toMatch(/older than/);
    });

    it('stops startServer() from running a stale build', () => {
      expect(() => startServer('stale-server', {}, tree(10, [1]))).toThrow(/older than/);
    });

    it('reports a missing build', () => {
      const root = tree(10, [100]);
      rmSync(join(root, 'build'), { recursive: true });
      expect(staleBuild(root, [])).toMatch(/missing/);
    });
  });

  it('scans generated code and .mts/.cts files, which are compiled into the build', () => {
    const root = mkdtempSync(join(dir, 'scan-'));
    mkdirSync(join(root, 'generated'));
    for (const f of ['generated/types.ts', 'a.mts', 'b.cts', 'c.d.ts']) writeFileSync(join(root, f), '');
    expect(sourceFiles(root).map((f) => relative(root, f)).sort()).toEqual(
      ['a.mts', 'b.cts', join('generated', 'types.ts')].sort(),
    );
  });

  it('scans every source file of a server, not only index.ts', () => {
    const files = sourceFiles(join(ROOT, 'bconnect-groups-mcp', 'src')).map((f) => f.slice(ROOT.length + 1));
    expect(files).toContain(join('bconnect-groups-mcp', 'src', 'index.ts'));
    expect(files).toContain(join('bconnect-groups-mcp', 'src', 'bconnect-client.ts'));
    expect(files.some((f) => f.includes(`${join('src', 'modules')}`))).toBe(true);
  });
});

/** Source without comments, so a mention in a comment neither counts nor hides. */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** What a server leaves to the core: building clients, loading .env, starting transports (REQ-SRV-023 AC 2). */
const CORE_ONLY: Array<[string, RegExp]> = [
  ['builds a BConnectClient', /\bnew\s+BConnectClient\b/],
  ['calls clientConfigFromEnv', /\bclientConfigFromEnv\b/],
  ['runs the connectivity check', /\btestConnection\b/],
  ['loads .env', /\bdotenv\b/],
  ['starts a stdio transport', /\bStdioServerTransport\b/],
  ['starts an HTTP transport', /\bStreamableHTTPServerTransport\b|\bexpress\b/],
];

/** Why a server's sources don't leave startup and clients to the core. */
function startupProblems(files: Array<{ name: string; text: string }>, index: string): string[] {
  const problems = files.flatMap(({ name, text }) =>
    CORE_ONLY.filter(([, pattern]) => pattern.test(code(text))).map(([what]) => `${name} ${what}`),
  );
  if (!/\bserverClients\s*\(/.test(code(index))) {problems.push('index.ts doesn\'t call serverClients()');}
  if (!/\brunServer\s*\(/.test(code(index))) {problems.push('index.ts doesn\'t call runServer()');}
  return problems;
}

describe('source: startup and clients come from the core', () => {
  describe('self-test', () => {
    const good = 'const clients = serverClients(BConnectClient);\nrunServer({ name, createServer, clients });';
    it('accepts a server that uses serverClients() and runServer(), mentioning the rest in comments only', () => {
      expect(startupProblems([{ name: 'index.ts', text: `${good}\n// no new BConnectClient, dotenv or express here\n/* testConnection */` }], good)).toEqual([]);
    });
    it.each(CORE_ONLY.map(([what]) => what))('reports a server that %s', (what) => {
      const sample: Record<string, string> = {
        'builds a BConnectClient': 'const c = new BConnectClient(config);',
        'calls clientConfigFromEnv': 'const config = clientConfigFromEnv(process.env);',
        'runs the connectivity check': 'await client.testConnection();',
        'loads .env': 'import * as dotenv from "dotenv";',
        'starts a stdio transport': 'const t = new StdioServerTransport();',
        'starts an HTTP transport': 'const app = express();',
      };
      expect(startupProblems([{ name: 'x.ts', text: sample[what] }], good)).toEqual([`x.ts ${what}`]);
    });
    it('reports an index.ts without serverClients() or runServer()', () => {
      expect(startupProblems([], 'main();')).toEqual(["index.ts doesn't call serverClients()", "index.ts doesn't call runServer()"]);
    });
  });

  describe.each(SOURCE_PACKAGES)('%s', (pkg) => {
    const files = sourceFiles(join(ROOT, pkg, 'src'));
    const index = readFileSync(join(ROOT, pkg, 'src', 'index.ts'), 'utf8');

    it('reads no client variable itself, and no environment it can hide a read in', () => {
      const offending = files.flatMap((file) =>
        envReads(readFileSync(file, 'utf8'), file)
          .filter((r) => r.name === null || CLIENT_VARS.includes(r.name))
          .map((r) => `${file.slice(ROOT.length + 1)}:${r.line} ${r.text}`),
      );
      expect(offending).toEqual([]);
    });

    it('leaves clients, .env and transports to the core: serverClients() and runServer()', () => {
      const sources = files.map((file) => ({ name: relative(ROOT, file), text: readFileSync(file, 'utf8') }));
      expect(startupProblems(sources, index)).toEqual([]);
    });
  });
});

describe.each(SERVERS)('%s: the client a tool call builds', (server) => {
  it('uses the CA, TLS, credential, audit and rate-limit settings', async () => {
    const config = await clientConfig(server, {
      BCONNECT_API_KEY: 'guard-api-key',
      BCONNECT_CA_CERT_PATH: caPath,
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      BCONNECT_AUDIT_LEVEL: 'write',
      BCONNECT_RATE_LIMIT_ENABLED: 'true',
      BCONNECT_RATE_LIMIT_MAX_REQUESTS: '7',
      BCONNECT_RATE_LIMIT_WINDOW_MS: '1500',
    });
    expect(config.baseUrl).toBe(guardEnv('26R1', { writes: false, secretRead: false }).BCONNECT_BASE_URL);
    expect(config.apiKey).toBe('guard-api-key');
    expect(config.ca).toBe(CA);
    expect(config.rejectUnauthorized).toBe(false);
    expect(config.auditLog?.level).toBe('write');
    expect(config.rateLimit).toEqual({ enabled: true, maxRequests: 7, windowMs: 1500 });
  });

  it('verifies certificates by default, with no CA, audit or rate limit', async () => {
    const config = await clientConfig(server, {});
    expect(config.rejectUnauthorized).toBe(true);
    expect(config.ca).toBeUndefined();
    expect(config.auditLog?.level ?? 'none').toBe('none');
    expect(config.rateLimit?.enabled ?? false).toBe(false);
    expect(config).toMatchObject({ username: 'guard', password: 'guard' });
  });

  it('ignores the removed BCONNECT_REJECT_UNAUTHORIZED switch', async () => {
    const config = await clientConfig(server, { BCONNECT_REJECT_UNAUTHORIZED: 'false' });
    expect(config.rejectUnauthorized).toBe(true);
  });

  it('lets per-request credentials (gateway) override the environment', async () => {
    const config = await clientConfig(
      server,
      { BCONNECT_API_KEY: 'env-key' },
      { credentials: { baseUrl: 'https://bms.request.test/bconnect', apiKey: 'request-key' } },
    );
    expect(config.baseUrl).toBe('https://bms.request.test/bconnect');
    expect(config.apiKey).toBe('request-key');
  });

  it('refuses a tool call without credentials with the shared message, as a tool result', async () => {
    const result = await firstReadToolResult(server, { BCONNECT_USERNAME: '', BCONNECT_PASSWORD: '' });
    // REQ-XC-001: a configuration error is a tool result the model can read,
    // not a protocol error; exactly the helper's message, no server wrapper.
    expect(result.isError).toBe(true);
    expect(result.code).toBeUndefined();
    expect(JSON.parse(result.text)).toEqual([{ type: 'text', text: MISSING_CREDENTIALS }]);
  });
});

/** Why `<pkg>/build/index.js` can't be trusted to match the sources, or undefined. */
function staleBuild(pkg: string, extraSourceDirs: string[]): string | undefined {
  const entry = join(pkg, 'build', 'index.js');
  if (!existsSync(entry)) return 'build/index.js is missing';
  const built = statSync(entry).mtimeMs;
  const newer = [join(pkg, 'src'), ...extraSourceDirs]
    .flatMap((d) => sourceFiles(d))
    .filter((f) => statSync(f).mtimeMs > built);
  return newer.length ? `build/index.js is older than ${newer.map((f) => relative(ROOT, f)).join(', ')}` : undefined;
}

/**
 * main() can't run in-process, so the startup path runs as a real process
 * (the build CI makes before the tests). Without credentials it must exit 1
 * with one line naming both ways to authenticate: no stack, nothing on stdout.
 */
function startServer(server: string, env: Record<string, string>, pkg = join(ROOT, server)) {
  const entry = join(pkg, 'build', 'index.js');
  const stale = staleBuild(pkg, [join(ROOT, 'packages', 'mcp-core', 'src')]);
  if (stale) throw new Error(`${server}: ${stale}; run npm run build`);
  const blank = Object.fromEntries(CLIENT_VARS.map((v) => [v, '']));
  // cwd without a .env file; VITEST unset so main() runs.
  return spawnSync(process.execPath, [entry], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? '', ...blank, BCONNECT_BASE_URL: 'http://127.0.0.1:9/bconnect', ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });
}

describe('startup without credentials', () => {
  it('self-test: a server with credentials fails for another reason, so the message check can tell', () => {
    const run = startServer('bconnect-groups-mcp', { BCONNECT_API_KEY: 'guard-key' });
    expect(run.status).toBe(1);
    expect(run.stderr).not.toContain(MISSING_CREDENTIALS);
  });

  it.each(SERVERS)('%s exits 1 with one line naming both ways to authenticate', (server) => {
    const run = startServer(server, {});
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr.trim()).toBe(`${server}: ${MISSING_CREDENTIALS}`);
  });
});

describe('startup without a base URL (REQ-SRV-023 AC 2, AC 8)', () => {
  it.each(SERVERS)('%s exits 1 with one line naming BCONNECT_BASE_URL', (server) => {
    const run = startServer(server, { BCONNECT_API_KEY: 'guard-key', BCONNECT_BASE_URL: '' });
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr.trim().split('\n')).toHaveLength(1);
    expect(run.stderr.trim()).toMatch(new RegExp(`^${server}: BCONNECT_BASE_URL `));
  });
});

const AUDIT_INVALID = (value: string) => `BCONNECT_AUDIT_LEVEL "${value}" isn't valid. Use one of: none, security, write, all.`;

describe('startup with an unknown audit level', () => {
  it.each(SERVERS)('%s exits 1 with one line naming the value and the valid levels', (server) => {
    const run = startServer(server, { BCONNECT_API_KEY: 'guard-key', BCONNECT_AUDIT_LEVEL: 'writes' });
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr.trim()).toBe(`${server}: ${AUDIT_INVALID('writes')}`);
  });
});

/** Lines on stdout that aren't JSON-RPC 2.0 messages. */
function nonJsonRpcLines(stdout: string): string[] {
  return stdout.split(/\r?\n/).filter((line) => line.trim() !== '').filter((line) => {
    try {
      return (JSON.parse(line) as { jsonrpc?: unknown }).jsonrpc !== '2.0';
    } catch {
      return true;
    }
  });
}

interface StdioSession { stdout: string; stderr: string; requests: string[]; tools: number }

/**
 * Starts a built server over stdio against a local stand-in for bConnect (plain
 * http on 127.0.0.1, which the client allows) and runs initialize + tools/list.
 * The startup check is the request that gets audited.
 */
async function stdioSession(server: string, env: Record<string, string>): Promise<StdioSession> {
  const entry = join(ROOT, server, 'build', 'index.js');
  const stale = staleBuild(join(ROOT, server), [join(ROOT, 'packages', 'mcp-core', 'src')]);
  if (stale) throw new Error(`${server}: ${stale}; run npm run build`);
  const requests: string[] = [];
  const api = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json');
    res.end('[]');
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  const { port } = api.address() as AddressInfo;
  const blank = Object.fromEntries(CLIENT_VARS.map((v) => [v, '']));
  const child = spawn(process.execPath, [entry], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? '', ...blank, BCONNECT_BASE_URL: `http://127.0.0.1:${port}/bconnect`, BCONNECT_API_KEY: 'guard-key', ...env },
  });
  let stdout = '';
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  const answered = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${server}: no tools/list answer within 20 s; stderr: ${stderr}`)), 20_000);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
      if (/"id":2[,}]/.test(stdout)) { clearTimeout(timer); resolve(); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`${server} exited with ${code}; stderr: ${stderr}`)); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
  });
  const send = (message: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'guard', version: '1' } } });
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  const closed = once(child, 'close');
  try {
    await answered;
  } finally {
    child.kill();
    // stderr is a separate pipe: wait until both pipes are drained before reading it.
    await closed;
    api.closeAllConnections();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
  const list = stdout.split(/\r?\n/).map((line) => { try { return JSON.parse(line) as { id?: number; result?: { tools?: unknown[] } }; } catch { return undefined; } })
    .find((message) => message?.id === 2);
  return { stdout, stderr, requests, tools: list?.result?.tools?.length ?? 0 };
}

/** What's missing for the session to prove the audit path ran and stayed off stdout. */
function auditProblems(session: StdioSession): string[] {
  const problems = nonJsonRpcLines(session.stdout).map((line) => `stdout: ${line}`);
  if (session.requests.length === 0) problems.push('no request reached the bConnect stand-in, so nothing could be audited');
  // Audit lines name the path below the base URL (http://127.0.0.1:<port>/bconnect).
  const probe = session.requests[0]?.split(' ')[1]?.split('?')[0]?.replace(/^\/bconnect(?=\/)/, '');
  // A security-relevant route (e.g. servermanagement's SecurityGroups probe) is tagged [SECURITY AUDIT].
  if (probe && !session.stderr.split('\n').some((line) => /\[(SECURITY )?AUDIT\]/.test(line) && line.includes(probe))) {
    problems.push(`stderr has no [AUDIT] or [SECURITY AUDIT] line for ${probe}`);
  }
  return problems;
}

describe('audit output in stdio mode', () => {
  it.each(SERVERS)('%s at audit level all: stdout carries only JSON-RPC, the audit line goes to stderr', async (server) => {
    const session = await stdioSession(server, { BCONNECT_AUDIT_LEVEL: 'all' });
    expect(auditProblems(session)).toEqual([]);
    expect(session.tools, 'tools/list must answer with the tool catalogue').toBeGreaterThan(0);
  }, 30_000);

  it('accepts the level in any case and with surrounding spaces', async () => {
    const session = await stdioSession('bconnect-groups-mcp', { BCONNECT_AUDIT_LEVEL: ' ALL ' });
    expect(auditProblems(session)).toEqual([]);
  }, 30_000);

  it.each(SERVERS)('%s with the check skipped: says skipped, never verified (REQ-SRV-023 AC 3)', async (server) => {
    const session = await stdioSession(server, { BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true' });
    expect(session.requests).toEqual([]);
    expect(session.stderr).toMatch(/skipped/i);
    expect(session.stderr).not.toMatch(/verified/i);
  }, 30_000);

  describe('self-test', () => {
    it('reports lines that are not JSON-RPC', () => {
      expect(nonJsonRpcLines('{"jsonrpc":"2.0","id":1,"result":{}}\r\n[AUDIT] GET /x\n{"id":3}\n\n')).toEqual(['[AUDIT] GET /x', '{"id":3}']);
    });

    it('reports a session in which nothing reached bConnect, so nothing was audited', async () => {
      const session = await stdioSession('bconnect-groups-mcp', { BCONNECT_AUDIT_LEVEL: 'all', BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true' });
      expect(auditProblems(session)).toEqual(['no request reached the bConnect stand-in, so nothing could be audited']);
    }, 30_000);

    it('reports a request whose audit line is missing', () => {
      expect(auditProblems({ stdout: '', stderr: 'started\n', requests: ['GET /bconnect/x/v2.0/Y?PageSize=1'], tools: 1 })).toEqual(['stderr has no [AUDIT] or [SECURITY AUDIT] line for /x/v2.0/Y']);
    });
  });
});
