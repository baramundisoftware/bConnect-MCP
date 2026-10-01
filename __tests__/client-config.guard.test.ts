/**
 * Client-configuration guard.
 *
 * Every tool call (stdio, HTTP and the gateway alike) builds its BConnectClient
 * in `createServer()`, not in `main()`, which only runs the startup probe. This
 * guard calls one tool of every server and checks that the client it built
 * honors the documented environment: BCONNECT_CA_CERT_PATH,
 * NODE_TLS_REJECT_UNAUTHORIZED, BCONNECT_AUDIT_LEVEL and BCONNECT_RATE_LIMIT_*.
 *
 * The groups server once read an undocumented BCONNECT_REJECT_UNAUTHORIZED here
 * and ignored the CA: its probe passed and every tool failed TLS.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BConnectConfig } from '@bconnect/mcp-core';
import { SERVERS, connect, createRecorder, guardEnv, requiredArguments } from './lib/exerciser.js';

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

/** The configuration of the client a server builds for its first tool, under `env`. */
async function clientConfig(server: string, env: Record<string, string>): Promise<BConnectConfig | undefined> {
  Object.assign(process.env, guardEnv('26R1', { writes: false, secretRead: false }), env);
  const conn = await connect(server);
  built.length = 0;
  const tool = conn.tools[0];
  await conn.call(tool.name, requiredArguments(tool.inputSchema));
  await conn.close();
  return built.at(-1);
}

describe.each(SERVERS)('%s: createServer client configuration', (server) => {
  it('uses BCONNECT_CA_CERT_PATH, NODE_TLS_REJECT_UNAUTHORIZED, audit level and rate limit', async () => {
    const config = await clientConfig(server, {
      BCONNECT_CA_CERT_PATH: caPath,
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      BCONNECT_AUDIT_LEVEL: 'write',
      BCONNECT_RATE_LIMIT_ENABLED: 'true',
      BCONNECT_RATE_LIMIT_MAX_REQUESTS: '7',
    });
    expect(config, 'no client was built').toBeDefined();
    expect(config!.ca).toBe(CA);
    expect(config!.rejectUnauthorized).toBe(false);
    expect(config!.auditLog?.level).toBe('write');
    expect(config!.rateLimit).toMatchObject({ enabled: true, maxRequests: 7 });
  });

  it('verifies certificates by default', async () => {
    const config = await clientConfig(server, {
      BCONNECT_CA_CERT_PATH: '',
      NODE_TLS_REJECT_UNAUTHORIZED: '',
      BCONNECT_AUDIT_LEVEL: '',
      BCONNECT_RATE_LIMIT_ENABLED: '',
      BCONNECT_RATE_LIMIT_MAX_REQUESTS: '',
    });
    expect(config, 'no client was built').toBeDefined();
    expect(config!.rejectUnauthorized).toBe(true);
    expect(config!.ca).toBeUndefined();
  });
});
