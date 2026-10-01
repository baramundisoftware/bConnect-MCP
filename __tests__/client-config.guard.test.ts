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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BConnectConfig } from '@bconnect/mcp-core';
import { ROOT, SERVERS, connect, createRecorder, guardEnv, requiredArguments } from './lib/exerciser.js';
import { envReads, functionCalls } from './lib/env-reads.js';

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

const CA = '-----BEGIN CERTIFICATE-----\nguard-test-ca\n-----END CERTIFICATE-----\n';
const dir = mkdtempSync(join(tmpdir(), 'client-config-'));
const caPath = join(dir, 'ca.pem');
const recorder = createRecorder();
const savedEnv = { ...process.env };

beforeAll(() => {
  writeFileSync(caPath, CA);
  recorder.listen();
});
afterAll(() => {
  recorder.close();
  process.env = savedEnv;
  rmSync(dir, { recursive: true, force: true });
});

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
  // Every client variable is set, '' unless given: dotenv never overrides a present key.
  const blank = Object.fromEntries(CLIENT_VARS.map((v) => [v, '']));
  Object.assign(process.env, blank, guardEnv('26R1', { writes: false, secretRead: false }), env);
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

const sourceFiles = (dirPath: string): string[] =>
  readdirSync(dirPath, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.d.ts'))
    .map((e) => join(e.parentPath, e.name))
    .filter((f) => !/[\\/](__tests__|__mocks__|generated)[\\/]/.test(f));

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
    ])('sees a %s read', (_label, source, name) => {
      expect(envReads(source).map((r) => r.name)).toContain(name);
    });

    it.each([
      ['copied into a variable', 'const e = process.env; e.BCONNECT_CA_CERT_PATH;'],
      ['spread', 'const e = { ...process.env };'],
      ['computed key', 'const k = "X"; process.env[k];'],
      ['rest element', 'const { ...all } = process.env;'],
      ['passed to another function', 'readSettings(process.env);'],
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
});
