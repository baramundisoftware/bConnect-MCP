/**
 * Client-config guard (REQ-SRV-019, issue #197).
 *
 * Every tool call (stdio, HTTP and the gateway alike) builds its BConnectClient
 * in `createServer()`; `main()` builds another one for the startup probe. Both
 * must come from the shared `clientConfigFromEnv()`, so the documented
 * environment reaches every client of every server the same way.
 *
 * - Through the real call path: one tool per server via `createServer()`; the
 *   config of the client it builds must carry the CA, TLS, credential, audit and
 *   rate-limit settings.
 * - In the source: no server reads a client variable itself, and `createServer()`
 *   and `main()` both call the helper (the probe can't run under test).
 *
 * The groups server once read an undocumented BCONNECT_REJECT_UNAUTHORIZED here
 * and ignored the CA: its probe passed and every tool failed TLS.
 * The runtime check started as the guard test of PR #193.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { BConnectConfig } from '@bconnect/mcp-core';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ROOT, SERVERS, connect, createRecorder, guardEnv, requiredArguments, type ToolResult } from './lib/exerciser.js';
import { clientConstructions, envReads, functionCalls, helperCalls, helperProvenance } from './lib/env-reads.js';

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
const HELPER = 'clientConfigFromEnv';
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

/** Every BConnectClient must get the helper's result unchanged; at least two (tool calls, startup probe). */
function constructionProblems(sources: Array<{ name: string; text: string }>): string[] {
  const constructions = sources.flatMap(({ name, text }) =>
    clientConstructions(text, 'BConnectClient', HELPER, name).map((c) => ({ ...c, where: `${name}:${c.line}` })),
  );
  return [
    ...(constructions.length < 2 ? [`only ${constructions.length} BConnectClient construction(s); expected tool client and startup probe`] : []),
    ...constructions.filter((c) => !c.fromHelper).map((c) => `${c.where} ${c.text}`),
  ];
}

/**
 * Every helper call in the package passes only process.env, except in createServer(),
 * which passes process.env and its own credentials parameter.
 */
function helperArgumentProblems(sources: Array<{ name: string; text: string }>): string[] {
  const problems: string[] = [];
  for (const { name, text } of sources) {
    // That main() and createServer() call it at all is checked with functionCalls().
    for (const call of helperCalls(text, HELPER, name)) {
      const args = call.args.join(', ');
      const expected = call.fn === 'createServer' ? `process.env, ${call.parameters[0] ?? '<no parameter>'}` : 'process.env';
      if (args !== expected) problems.push(`${name}: ${call.fn ?? '<top level>'}(): ${HELPER}(${args})`);
    }
  }
  return problems;
}

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

  describe('functionCalls', () => {
    const source = [
      'export function createServer() {',
      '  const getBconnect = () => new BConnectClient(core.clientConfigFromEnv(process.env));',
      '}',
      'async function main() {',
      '  // clientConfigFromEnv(process.env) is not called here',
      '  const s = "clientConfigFromEnv(process.env)";',
      '  new BConnectClient({ baseUrl: process.env.BCONNECT_BASE_URL });',
      '}',
    ].join('\n');

    it('finds a call inside a nested closure', () => {
      expect(functionCalls(source, 'createServer', HELPER)).toBe(true);
    });

    it('does not count a comment or a string as a call', () => {
      expect(functionCalls(source, 'main', HELPER)).toBe(false);
    });

    it('reports a missing function as undefined', () => {
      expect(functionCalls(source, 'start', HELPER)).toBeUndefined();
    });

    it('does not count a mere reference as a call', () => {
      const ref = 'async function main() { const f = clientConfigFromEnv; f(process.env); }';
      expect(functionCalls(ref, 'main', HELPER)).toBe(false);
    });
  });

  describe('clientConstructions', () => {
    const fromHelper = (source: string) =>
      clientConstructions(source, 'BConnectClient', HELPER).map((c) => c.fromHelper);

    it.each([
      ['the helper call directly', 'new BConnectClient(clientConfigFromEnv(process.env, credentials));'],
      ['a variable assigned only the helper', 'const config = clientConfigFromEnv(process.env); new BConnectClient(config);'],
      ['the helper call in parentheses or with a type assertion', 'new BConnectClient((clientConfigFromEnv(process.env) as BConnectConfig));'],
      ['a variable whose members are read', 'const c = clientConfigFromEnv(process.env); const url = c.baseUrl; new BConnectClient(c);'],
      ['a plain member passed to a call', 'const c = clientConfigFromEnv(process.env); log("probing", c.baseUrl); new URL(c.baseUrl); new BConnectClient(c);'],
      ['optional chaining and a type query', 'const c = clientConfigFromEnv(process.env); let u: typeof c | undefined; void c?.baseUrl; new BConnectClient(c);'],
      ['satisfies at the constructor', 'const c = clientConfigFromEnv(process.env); new BConnectClient(c satisfies BConnectConfig);'],
      [
        'a variable declared first and assigned the helper in a try',
        'let c: BConnectConfig; try { c = clientConfigFromEnv(process.env); } catch { process.exit(1); } new BConnectClient(c);',
      ],
    ])('accepts %s', (_label, source) => {
      expect(fromHelper(source)).toEqual([true]);
    });

    it.each([
      ['a hand-built object', 'new BConnectClient({ baseUrl: url, rejectUnauthorized: true });'],
      ['the helper result with overrides', 'new BConnectClient({ ...clientConfigFromEnv(process.env), rejectUnauthorized: true });'],
      [
        'a variable that overrides the helper result',
        'let c; c = { ...clientConfigFromEnv(process.env), ca: undefined }; new BConnectClient(c);',
      ],
      [
        'a variable assigned the helper and then something else',
        'let c = clientConfigFromEnv(process.env); c = { baseUrl: "x" }; new BConnectClient(c);',
      ],
      ['a variable never assigned', 'let c: BConnectConfig; new BConnectClient(c);'],
      ['a helper result changed in place', 'const c = clientConfigFromEnv(process.env); c.ca = undefined; new BConnectClient(c);'],
      ['a helper result changed by Object.assign', 'const c = clientConfigFromEnv(process.env); Object.assign(c, { rejectUnauthorized: false }); new BConnectClient(c);'],
      ['a helper result with a member deleted', 'const c = clientConfigFromEnv(process.env); delete c.ca; new BConnectClient(c);'],
      ['a helper result changed through a copy', 'const c = clientConfigFromEnv(process.env); const a = c; a.ca = undefined; new BConnectClient(c);'],
      ['a nested member written', 'const c = clientConfigFromEnv(process.env); c.rateLimit.maxRequests = 1; new BConnectClient(c);'],
      ['a compound assignment', 'let c = clientConfigFromEnv(process.env); c ||= other; new BConnectClient(c);'],
      ['a second argument', 'new BConnectClient(clientConfigFromEnv(process.env), extra);'],
      ['a member incremented', 'const c = clientConfigFromEnv(process.env); c.rateLimit.maxRequests++; new BConnectClient(c);'],
      ['a member assigned with ??=', 'const c = clientConfigFromEnv(process.env); c.ca ??= x; new BConnectClient(c);'],
      ['a nested member written through !', 'const c = clientConfigFromEnv(process.env); c.rateLimit!.maxRequests = 1; new BConnectClient(c);'],
      ['a nested member handed to Object.assign', 'const c = clientConfigFromEnv(process.env); Object.assign(c.rateLimit, { maxRequests: 1 }); new BConnectClient(c);'],
      [
        'a parameter of the same name',
        'const c = clientConfigFromEnv(process.env); function probe(c: BConnectConfig) { return new BConnectClient(c); } probe({ ...c, ca: undefined });',
      ],
      [
        'an arrow parameter of the same name',
        'const c = clientConfigFromEnv(process.env); const probe = (c: BConnectConfig) => new BConnectClient(c); probe({ ...c, ca: undefined });',
      ],
      ['a nested member spread', 'const c = clientConfigFromEnv(process.env); const r = { ...c.rateLimit }; new BConnectClient(c);'],
      ['a catch variable of the same name', 'let c = clientConfigFromEnv(process.env); try { f(); } catch (c) { new BConnectClient(c); }'],
      ['a for-in variable of the same name', 'let c = clientConfigFromEnv(process.env); for (const c in other) new BConnectClient(c);'],
      ['a destructured name of the same name', 'let c = clientConfigFromEnv(process.env); const { c } = other; new BConnectClient(c);'],
      // A helper-assigned local elsewhere in the file must not vouch for an imported name.
      ['an imported name of the same name', 'import { c } from "./other.js"; function f() { const c = clientConfigFromEnv(process.env); void c.baseUrl; } new BConnectClient(c);'],
      ['a default import of the same name', 'import c from "./other.js"; function f() { const c = clientConfigFromEnv(process.env); void c.baseUrl; } new BConnectClient(c);'],
      ['a namespace import of the same name', 'import * as c from "./other.js"; function f() { const c = clientConfigFromEnv(process.env); void c.baseUrl; } new BConnectClient(c);'],
      ['a nested write behind a type assertion', 'const c = clientConfigFromEnv(process.env); (c.rateLimit!.window as W).ms = 1; new BConnectClient(c);'],
      ['a function of the same name', 'let c = clientConfigFromEnv(process.env); function c() {} new BConnectClient(c);'],
      ['a class of the same name', 'let c = clientConfigFromEnv(process.env); class c {} new BConnectClient(c);'],
      [
        'a loop variable of the same name',
        'let c = clientConfigFromEnv(process.env); for (const c of [{ ...other }]) new BConnectClient(c);',
      ],
      ['no argument', 'new BConnectClient();'],
    ])('rejects %s', (_label, source) => {
      expect(fromHelper(source)).toEqual([false]);
    });
  });

  describe('helperProvenance', () => {
    const IMPORT = 'import { clientConfigFromEnv } from "@bconnect/mcp-core";';
    const check = (source: string) => helperProvenance(source, HELPER, '@bconnect/mcp-core');

    it('accepts the helper imported from the core', () => {
      expect(check(`${IMPORT}\nnew BConnectClient(clientConfigFromEnv(process.env));`)).toEqual([]);
    });

    it.each([
      ['a local function of the same name', `${IMPORT}\nfunction clientConfigFromEnv(e) { return {}; }`],
      ['a local variable of the same name', `${IMPORT}\nconst clientConfigFromEnv = (e) => ({});`],
      ['an import from elsewhere', 'import { clientConfigFromEnv } from "./config.js"; clientConfigFromEnv(process.env);'],
      ['a renamed import', 'import { other as clientConfigFromEnv } from "@bconnect/mcp-core"; clientConfigFromEnv(process.env);'],
      ['no import at all', 'clientConfigFromEnv(process.env);'],
    ])('rejects %s', (_label, source) => {
      expect(check(source)).not.toEqual([]);
    });
  });

  it('reports a server with fewer than two client constructions', () => {
    const one = [{ name: 'index.ts', text: 'new BConnectClient(clientConfigFromEnv(process.env));' }];
    expect(constructionProblems(one)).toEqual([expect.stringContaining('only 1')]);
    expect(constructionProblems([...one, ...one])).toEqual([]);
  });

  describe('helper arguments', () => {
    const index = (mainArgs: string, createArgs: string, extra = '') => [
      {
        name: 'index.ts',
        text: [
          `export function createServer(creds?: BConnectCredentials) { new BConnectClient(clientConfigFromEnv(${createArgs})); }`,
          `async function main() { new BConnectClient(clientConfigFromEnv(${mainArgs})); }`,
          extra,
        ].join('\n'),
      },
    ];

    it('accepts process.env in main() and process.env plus the credentials parameter in createServer()', () => {
      expect(helperArgumentProblems(index('process.env', 'process.env, creds'))).toEqual([]);
    });

    it('accepts multi-line arguments with a trailing comma', () => {
      expect(helperArgumentProblems(index('\n  process.env,\n', 'process.env, creds'))).toEqual([]);
    });

    it('rejects a third function building a client with other arguments', () => {
      const extra = 'function probe() { return new BConnectClient(clientConfigFromEnv(process.env, { baseUrl: "x" })); }';
      expect(helperArgumentProblems(index('process.env', 'process.env, creds', extra))).toEqual([
        expect.stringContaining('probe()'),
      ]);
    });

    it('rejects a helper call in another file with other arguments', () => {
      const other = { name: 'probe.ts', text: 'export const c = clientConfigFromEnv({ BCONNECT_API_KEY: "x" });' };
      expect(helperArgumentProblems([...index('process.env', 'process.env, creds'), other])).toEqual([
        expect.stringContaining('probe.ts'),
      ]);
    });

    it.each([
      ['main() passing credentials', 'process.env, { baseUrl: "https://other/bconnect" }', 'process.env, credentials'],
      ['main() passing a hand-made env', '{ BCONNECT_API_KEY: "x" }', 'process.env, credentials'],
      ['createServer() dropping the credentials', 'process.env', 'process.env'],
      ['createServer() passing another variable', 'process.env', 'process.env, credentials'],
      ['createServer() passing other credentials', 'process.env', 'process.env, { apiKey: "x" }'],
    ])('rejects %s', (_label, mainArgs, createArgs) => {
      expect(helperArgumentProblems(index(mainArgs, createArgs))).not.toEqual([]);
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

describe('source: only the core helper reads the client variables', () => {
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

    it(`builds the tool client with ${HELPER}() in createServer()`, () => {
      expect(functionCalls(index, 'createServer', HELPER)).toBe(true);
    });

    it(`builds the startup-probe client with ${HELPER}() in main()`, () => {
      expect(functionCalls(index, 'main', HELPER)).toBe(true);
    });

    it(`passes every BConnectClient the ${HELPER}() result unchanged`, () => {
      const sources = files.map((file) => ({ name: file.slice(ROOT.length + 1), text: readFileSync(file, 'utf8') }));
      expect(constructionProblems(sources)).toEqual([]);
    });

    it(`calls ${HELPER}(process.env), or (process.env, <its credentials>) in createServer(), and nothing else`, () => {
      const sources = files.map((file) => ({ name: relative(ROOT, file), text: readFileSync(file, 'utf8') }));
      expect(helperArgumentProblems(sources)).toEqual([]);
    });

    it(`imports ${HELPER} from the core and doesn't declare its own`, () => {
      const problems = files.flatMap((file) =>
        helperProvenance(readFileSync(file, 'utf8'), HELPER, '@bconnect/mcp-core', file).map(
          (p) => `${file.slice(ROOT.length + 1)}: ${p}`,
        ),
      );
      expect(problems).toEqual([]);
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
      { credentials: { baseUrl: 'http://bms.request.test/bconnect', apiKey: 'request-key' } },
    );
    expect(config.baseUrl).toBe('http://bms.request.test/bconnect');
    expect(config.apiKey).toBe('request-key');
  });

  it('refuses a tool call without credentials with the shared message and an internal error', async () => {
    const result = await firstReadToolResult(server, { BCONNECT_USERNAME: '', BCONNECT_PASSWORD: '' });
    expect(result.isError).toBe(true);
    expect(result.code).toBe(ErrorCode.InternalError);
    // Exactly the helper's message: only the SDK's "MCP error <code>: " prefix (server and
    // client each add one), no server-specific wrapper ("bConnect API error: …").
    const prefix = `MCP error ${ErrorCode.InternalError}: `;
    expect(result.text.replaceAll(prefix, '')).toBe(MISSING_CREDENTIALS);
    expect(result.text.startsWith(prefix)).toBe(true);
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

