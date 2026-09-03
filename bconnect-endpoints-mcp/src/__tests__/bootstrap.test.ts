/**
 * This server's half of the unified bootstrap (finding OPT-32).
 *
 * `main()` is gone from src/index.ts. Every decision it used to make lives in
 * `runServer()` in packages/mcp-core, which has its own tests; what needs
 * asserting HERE is the contract this server has to satisfy for those decisions
 * to hold, and the two behaviours that changed for this server specifically.
 *
 * ── Difference 3: the startup probe must use the client the tools use ───────
 * `runServer` prefers `createServer().getClient` over building its own, and the
 * whole point is that the check cannot verify under a different configuration
 * than the tools then run with. That only works if `createServer()` actually
 * returns `getClient`, and if that function is the MEMOISED provider rather
 * than a factory — which is the same property finding R3 was about: a client
 * rebuilt per call rebuilds everything stateful it owns, which is why rate
 * limiting never limited (B8) and the response cache could not work (B7).
 *
 * ── Difference 2: no example.com fallback ──────────────────────────────────
 * This server used to pass `defaultBaseUrl: "https://bms.example.com:443/bconnect"`
 * into its client provider. With BCONNECT_BASE_URL unset that sends real
 * credentials to a hostname the vendor does not control. The default is gone
 * from this file; the absence is asserted below because an absence is exactly
 * the kind of change that gets quietly reinstated.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { shouldAutoStart } from '@bconnect/mcp-core';

import { createServer } from '../index.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const indexSource = readFileSync(join(packageRoot, 'src/index.ts'), 'utf8');

/**
 * The same file with comments removed.
 *
 * The assertions below are about what the code DOES, and this file's header
 * deliberately names `BCONNECT_RELEASE` and `is26R1` to record what was taken
 * out. A test that forbade the word would forbid the explanation with it.
 */
const indexCode = indexSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const CREDS = { apiKey: 'test-key', baseUrl: 'http://bms.test.local/bconnect' };

describe('runServer contract', () => {
  it('createServer returns the memoised client, not just a server', () => {
    const handle = createServer(CREDS);
    expect(typeof handle.getClient).toBe('function');
    // Identity, not shape: this is what makes "the probe uses the tools'
    // client" structural rather than a convention two files have to keep.
    expect(handle.getClient()).toBe(handle.getClient());
  });

  it('gives two servers two clients — the provider is per session', () => {
    expect(createServer(CREDS).getClient()).not.toBe(createServer(CREDS).getClient());
  });

  it('a tool call does not replace the client the probe would have used', async () => {
    const handle = createServer(CREDS);
    const probed = handle.getClient();

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await handle.server.connect(serverTransport);
    const client = new Client({ name: 'bootstrap', version: '1.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
    // Fails on connect (nothing is listening); what matters is that dispatch
    // asked the provider rather than constructing its own.
    await client.callTool({ name: 'list_endpoints', arguments: {} }).catch(() => undefined);

    expect(handle.getClient()).toBe(probed);
  });
});

describe('the bootstrap decisions this file no longer makes', () => {
  it('hands main() to mcp-core rather than hand-writing one', () => {
    expect(indexCode).toContain("runServer(");
    expect(indexSource).toContain('shouldAutoStart()');
    expect(indexSource).not.toMatch(/async function main\s*\(/);
  });

  it('carries no placeholder base URL', () => {
    // The exact string that used to be the fallback.
    expect(indexSource).not.toContain('bms.example.com');
    expect(indexSource).not.toContain('defaultBaseUrl');
  });

  it('does not auto-start under vitest', () => {
    // `=== undefined`, not `!process.env.VITEST`: VITEST=0 would defeat the
    // truthiness form and dial out to a real bMS mid-suite.
    expect(shouldAutoStart({ VITEST: 'true' } as NodeJS.ProcessEnv)).toBe(false);
    expect(shouldAutoStart({ VITEST: '0' } as NodeJS.ProcessEnv)).toBe(false);
    expect(shouldAutoStart({} as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('the release gate is gone from the source, not just from the surface', () => {
  const saved = process.env.BCONNECT_RELEASE;
  beforeEach(() => {
    delete process.env.BCONNECT_RELEASE;
  });
  afterEach(() => {
    if (saved === undefined) {
      delete process.env.BCONNECT_RELEASE;
    } else {
      process.env.BCONNECT_RELEASE = saved;
    }
  });

  it('reads no BCONNECT_RELEASE and branches on no is26R1', () => {
    // Product decision 2. The catalogue conditional and the six
    // `if (!is26R1) throw new BareMcpError(MethodNotFound, ...)` dispatch arms
    // are both gone; server.test.ts asserts the surface consequence.
    //
    expect(indexCode).not.toContain('BCONNECT_RELEASE');
    expect(indexCode).not.toContain('is26R1');
  });

  it('carries no industrial module method', () => {
    // Product decision 1. 26R1 declares no /v2.0/IndustrialEndpoints route, so
    // a method that builds one can only produce a 404.
    const moduleSource = readFileSync(join(packageRoot, 'src/modules/endpoints.ts'), 'utf8');
    expect(moduleSource).not.toMatch(/async\s+\w*[Ii]ndustrial\w*\s*\(/);
    expect(moduleSource).not.toContain('${this.basePath}/IndustrialEndpoints');
  });
});
