/**
 * bconnect-defensecontrol-mcp — server isolation test
 *
 * Verifies that:
 * 1. createServer() starts and lists all 13 defensecontrol tools + the local
 *    get_security_posture composite
 * 2. BCONNECT_RELEASE is inert — it used to hide get_bitlocker_secrets and
 *    update_bitlocker_pin on 25R2, which is no longer a supported release
 * 3. No tools from other domains are registered
 * 4. Unknown tool calls return MethodNotFound
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer } from '../index.js';
import { assertSecurityRouteAllowed } from '@bconnect/mcp-core';

const EXPECTED_TOOLS_25R2 = [
  // BitLocker (25R2)
  'list_bitlocker_windows_endpoints',
  'get_bitlocker_windows_endpoint',
  // Local Admin
  'get_local_admin_accounts',
  'patch_local_admin_user_credentials',
  'refresh_local_admin_account_expiry',
  // Microsoft Defender Threats
  'list_defender_threats',
  'get_defender_threat',
  'list_defender_threats_by_endpoint',
  'list_defender_threats_by_logical_group',
  // Microsoft Defender States
  'list_defender_windows_endpoints',
  'get_defender_windows_endpoint',
];

const EXPECTED_TOOLS_26R1_ONLY = [
  'get_bitlocker_secrets',
  'update_bitlocker_pin',
];

async function startServer() {
  const { server } = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return { client };
}

// Same, but with explicit credentials and a base URL that refuses instantly,
// so a tool call that is *allowed* through fails on connectivity rather than
// on the missing-credentials guard. Used by the A1/A2 regressions, which have
// to tell "reached the HTTP layer" apart from "was refused before it".
async function startServerWithCredentials(): Promise<{ client: Client }> {
  const { server } = createServer({
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'test-api-key',
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return { client };
}

afterEach(() => {
  delete process.env.BCONNECT_RELEASE;
  vi.unstubAllEnvs();
});

// TOK-20: write tools are advertised only when ALLOW_WRITE_OPERATIONS=true.
// The counting and name tests below assert the FULL declared surface, so they
// open the gate; the gate-shut surface is asserted in surface.test.ts.
function openWriteGate(): void {
  vi.stubEnv('ALLOW_WRITE_OPERATIONS', 'true');
}

describe('bconnect-defensecontrol-mcp', () => {
  // MIGRATED (Decision 2). This pair asserted that BCONNECT_RELEASE=25R2 hid
  // get_bitlocker_secrets and update_bitlocker_pin, leaving 12. 25R2 is no
  // longer supported and the switch is gone, so the assertion is inverted:
  // setting the variable must change nothing at all. Kept, not deleted, so a
  // reintroduced conditional fails here rather than shipping.
  it('ignores BCONNECT_RELEASE: 25R2 now advertises the same 14 tools as 26R1', async () => {
    openWriteGate();
    process.env.BCONNECT_RELEASE = '25R2';
    const { client } = await startServer();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toHaveLength(14);
    for (const expected of [...EXPECTED_TOOLS_25R2, ...EXPECTED_TOOLS_26R1_ONLY]) {
      expect(names).toContain(expected);
    }
  });

  it('the two formerly-conditional BitLocker tools are unconditional', async () => {
    openWriteGate();
    for (const release of ['25R2', '26R1', undefined]) {
      if (release === undefined) {delete process.env.BCONNECT_RELEASE;}
      else {process.env.BCONNECT_RELEASE = release;}
      const { client } = await startServer();
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names, `BCONNECT_RELEASE=${release}`).toContain('get_bitlocker_secrets');
      expect(names, `BCONNECT_RELEASE=${release}`).toContain('update_bitlocker_pin');
    }
  });

  it('lists exactly 13 defensecontrol tools in the default (26R1) mode', async () => {
    openWriteGate();
    // No BCONNECT_RELEASE set — default is now 26R1, so both BitLocker-secret tools register.
    const { client } = await startServer();
    const { tools } = await client.listTools();
    // 13 upstream + get_security_posture (LOCAL ADDITION, not upstream).
    expect(tools).toHaveLength(14);
  });

  it('lists exactly 13 defensecontrol tools in 26R1 mode', async () => {
    openWriteGate();
    process.env.BCONNECT_RELEASE = '26R1';
    const { client } = await startServer();
    const { tools } = await client.listTools();
    // 13 upstream + get_security_posture (LOCAL ADDITION, not upstream).
    expect(tools).toHaveLength(14);
  });

  it('registers 26R1-only tools when BCONNECT_RELEASE=26R1', async () => {
    openWriteGate();
    process.env.BCONNECT_RELEASE = '26R1';
    const { client } = await startServer();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of [...EXPECTED_TOOLS_25R2, ...EXPECTED_TOOLS_26R1_ONLY]) {
      expect(names).toContain(expected);
    }
  });

  it('does not register tools from other domains', async () => {
    const { client } = await startServer();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    const forbidden = [
      'list_endpoints', 'get_endpoint',
      'list_assets', 'get_asset',
      'list_ad_groups', 'get_ad_group',
      'list_jobs', 'get_job',
    ];
    for (const name of forbidden) {
      expect(names).not.toContain(name);
    }
  });

  it('all tools have descriptions of at least 20 words', async () => {
    const { client } = await startServer();
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const wordCount = tool.description?.split(/\s+/).length ?? 0;
      expect(wordCount, `${tool.name} description too short (${wordCount} words)`).toBeGreaterThanOrEqual(20);
    }
  });

  it('returns MethodNotFound for unknown tool', async () => {
    const { client } = await startServer();
    await expect(
      client.callTool({ name: 'nonexistent_tool', arguments: {} })
    ).rejects.toThrow();
  });

  // INT4-14 — a renamed tool explains itself rather than a bare "Unknown
  // tool". Made to fail first: with removalReason()'s lookup deleted (or the
  // entry removed from REMOVED_TOOLS), this assertion fails because the
  // thrown message reverts to the bare `Unknown tool: trigger_update_on_client`
  // the second assertion below also guards against regressing to.
  it('a renamed tool (trigger_update_on_client) explains the rename, not a bare "Unknown tool"', async () => {
    const { client } = await startServerWithCredentials();
    await expect(
      client.callTool({ name: 'trigger_update_on_client', arguments: { endpointId: 'd0000001-0001-0001-0001-000000000001' } })
    ).rejects.toThrow(/renamed to refresh_local_admin_account_expiry/);
  });

  it('a genuinely unknown name still gets the bare MethodNotFound message', async () => {
    const { client } = await startServerWithCredentials();
    await expect(
      client.callTool({ name: 'nonexistent_tool', arguments: {} })
    ).rejects.toThrow(/^MCP error -32601: Unknown tool: nonexistent_tool$/);
  });

  // Validator-migration regression tests (centralised validateOrThrow)
  describe('validator rejects bad arguments before reaching bConnect', () => {
    it('get_bitlocker_windows_endpoint: missing endpointId', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'get_bitlocker_windows_endpoint', arguments: {} })
      ).rejects.toThrow(/endpointId is required/i);
    });

    it('get_defender_threat: threatId not a GUID', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'get_defender_threat', arguments: { threatId: 'oops' } })
      ).rejects.toThrow(/guid/i);
    });

    it('list_defender_threats_by_logical_group: missing logicalGroupId', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'list_defender_threats_by_logical_group', arguments: {} })
      ).rejects.toThrow(/logicalGroupId is required/i);
    });

    it('patch_local_admin_user_credentials: patchOperations not an array', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({
          name: 'patch_local_admin_user_credentials',
          arguments: { endpointId: 'd0000001-0001-0001-0001-000000000001', patchOperations: 'oops' }
        })
      ).rejects.toThrow(/patchOperations/i);
    });

    it('refresh_local_admin_account_expiry: timeout not a number', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({
          name: 'refresh_local_admin_account_expiry',
          arguments: { endpointId: 'd0000001-0001-0001-0001-000000000001', timeout: 'not-a-number' }
        })
      ).rejects.toThrow(/timeout/i);
    });
  });

  // Secret-read gate (security audit C3): tools that return live credentials
  // (LAPS passwords, BitLocker keys/PIN) must be off unless ALLOW_SECRET_READ=true.
  describe('secret-read gate (C3)', () => {
    afterEach(() => {
      delete process.env.ALLOW_SECRET_READ;
      delete process.env.BCONNECT_BASE_URL;
    });

    it('blocks get_local_admin_accounts by default (no ALLOW_SECRET_READ)', async () => {
      const { client } = await startServer();
      const res = await client.callTool({ name: 'get_local_admin_accounts', arguments: { endpointId: 'd0000001-0001-0001-0001-000000000001' }});
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toMatch(/ALLOW_SECRET_READ/);
    });

    it('blocks get_bitlocker_secrets by default (26R1)', async () => {
      process.env.BCONNECT_RELEASE = '26R1';
      const { client } = await startServer();
      const res = await client.callTool({
        name: 'get_bitlocker_secrets',
        arguments: { endpointId: 'd0000001-0001-0001-0001-000000000001' },
      });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toMatch(/ALLOW_SECRET_READ/);
    });

    it('passes the gate when ALLOW_SECRET_READ=true (fails downstream, not at the gate)', async () => {
      process.env.ALLOW_SECRET_READ = 'true';
      process.env.BCONNECT_BASE_URL = 'http://127.0.0.1:9'; // refused fast → proves gate was bypassed
      const { client } = await startServer();
      const outcome = await client
        .callTool({ name: 'get_local_admin_accounts', arguments: { endpointId: 'd0000001-0001-0001-0001-000000000001' }})
        .then((res) => ({ res }))
        .catch((err) => ({ err }));
      // Whether it rejected (network) or returned an error result, it must NOT be the gate message.
      expect(JSON.stringify(outcome)).not.toMatch(/Set ALLOW_SECRET_READ=true to enable it/);
    });
  });

  // SEC-3: the two write tools resolve to secret-bearing bodies —
  // updateBitLockerPin() -> BitLockerSecrets, patchLocalAdminUserCredentials()
  // -> LocalAdminAccountWindowsEndpoint — and both are serialised into the tool
  // result unmodified. In the documented remediation posture
  // (ALLOW_WRITE_OPERATIONS=true, ALLOW_SECRET_READ unset) they used to sail
  // past the secret gate and hand back exactly what it exists to withhold.
  describe('secret-read gate also covers the secret-returning write tools (SEC-3)', () => {
    afterEach(() => {
      delete process.env.ALLOW_SECRET_READ;
      delete process.env.ALLOW_WRITE_OPERATIONS;
      delete process.env.BCONNECT_BASE_URL;
    });

    it('blocks patch_local_admin_user_credentials with write enabled but ALLOW_SECRET_READ unset', async () => {
      process.env.ALLOW_WRITE_OPERATIONS = 'true';
      const { client } = await startServer();
      const res = await client.callTool({
        name: 'patch_local_admin_user_credentials',
        arguments: {
          endpointId: 'd0000001-0001-0001-0001-000000000001',
          patchOperations: [{ op: 'replace', path: '/comment', value: 'noop' }],
        },
      });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toMatch(/ALLOW_SECRET_READ/);
    });

    it('blocks update_bitlocker_pin with write enabled but ALLOW_SECRET_READ unset (26R1)', async () => {
      process.env.BCONNECT_RELEASE = '26R1';
      process.env.ALLOW_WRITE_OPERATIONS = 'true';
      const { client } = await startServer();
      const res = await client.callTool({
        name: 'update_bitlocker_pin',
        arguments: {
          endpointId: 'd0000001-0001-0001-0001-000000000001',
          patchOperations: [{ op: 'replace', path: '/pin', value: '123456' }],
        },
      });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toMatch(/ALLOW_SECRET_READ/);
    });

    it('still blocks on the write gate first when ALLOW_WRITE_OPERATIONS is unset', async () => {
      process.env.ALLOW_SECRET_READ = 'true';
      const { client } = await startServer();
      const res = await client.callTool({
        name: 'patch_local_admin_user_credentials',
        arguments: {
          endpointId: 'd0000001-0001-0001-0001-000000000001',
          patchOperations: [{ op: 'replace', path: '/comment', value: 'noop' }],
        },
      });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toMatch(/ALLOW_WRITE_OPERATIONS/);
    });
  });

  // ── A1 ────────────────────────────────────────────────────────────────────
  // The round-2 deny-list matched /LocalAdministrativeAccounts/i, i.e. the
  // whole sub-tree, so POST .../{id}/TriggerUpdateOnClient was refused with
  // -32600 and a message about credential exposure. That route returns
  // Promise<boolean>, not a credential: it is a WRITE, governed by
  // ALLOW_WRITE_OPERATIONS, and the narrowed CREDENTIAL_RETURNING_ROUTES set
  // in @bconnect/mcp-core must let it through while still denying the four
  // routes that really do hand back a secret.
  describe('A1: refresh_local_admin_account_expiry is not a credential-returning route', () => {
    afterEach(() => {
      delete process.env.ALLOW_SECRET_READ;
      delete process.env.ALLOW_WRITE_OPERATIONS;
    });

    it('dispatches refresh_local_admin_account_expiry in the documented posture instead of refusing it', async () => {
      process.env.ALLOW_WRITE_OPERATIONS = 'true';
      // ALLOW_SECRET_READ deliberately unset — this is the documented posture.
      const { client } = await startServerWithCredentials();
      const outcome = await client
        .callTool({
          name: 'refresh_local_admin_account_expiry',
          arguments: { endpointId: 'd0000001-0001-0001-0001-000000000001' },
        })
        .then((res) => ({ res }))
        .catch((err: Error) => ({ message: err.message }));
      const text = JSON.stringify(outcome);

      // Must NOT be the security-route refusal (-32600) — that was the bug.
      expect(text).not.toMatch(/Refusing POST/);
      expect(text).not.toMatch(/credential/i);
      expect(text).not.toMatch(/-32600/);
      // It reached the HTTP layer and failed there instead.
      expect(text).toMatch(/Tool execution failed|connect|ECONNREFUSED/i);
    });

    it('still refuses get_local_admin_accounts, with the isError shape, in the same posture', async () => {
      process.env.ALLOW_WRITE_OPERATIONS = 'true';
      const { client } = await startServerWithCredentials();
      const res = await client.callTool({
        name: 'get_local_admin_accounts',
        arguments: { endpointId: 'd0000001-0001-0001-0001-000000000001' },
      });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toMatch(/ALLOW_SECRET_READ/);
    });

    it('still denies the LAPS resource itself at the transport, but not its sub-resource', () => {
      const laps = '/defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/d0000001-0001-0001-0001-000000000001';
      expect(() => assertSecurityRouteAllowed('GET', laps)).toThrow(/credential/i);
      expect(() => assertSecurityRouteAllowed('POST', `${laps}/TriggerUpdateOnClient`)).not.toThrow();
      expect(() =>
        assertSecurityRouteAllowed('GET', '/defensecontrol/v2.0/BitLocker/WindowsEndpoints/x/Secrets')
      ).toThrow(/credential/i);
    });
  });

  // ── A2 ────────────────────────────────────────────────────────────────────
  // McpError bakes "MCP error <code>: " into .message and the SDK client adds
  // it again when rebuilding the error from the wire, so every rejection used
  // to reach the model as "MCP error -32601: MCP error -32601: …".
  describe('A2: exactly one "MCP error <code>: " prefix on a rejection', () => {
    const prefixCount = (message: string): number =>
      (message.match(/MCP error -?\d+: /g) ?? []).length;

    it('MethodNotFound (unknown tool) carries one prefix', async () => {
      // Credentialed: the client provider runs before the dispatch switch, so
      // without credentials this would be the InternalError instead.
      const { client } = await startServerWithCredentials();
      const err = await client
        .callTool({ name: 'nonexistent_tool', arguments: {} })
        .then(() => null, (e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect(prefixCount((err as Error).message)).toBe(1);
      expect((err as Error).message).toBe('MCP error -32601: Unknown tool: nonexistent_tool');
    });

    it('InvalidParams from the shared validator carries one prefix', async () => {
      const { client } = await startServer();
      const err = await client
        .callTool({ name: 'get_defender_threat', arguments: { threatId: 'oops' } })
        .then(() => null, (e: Error) => e);
      expect(prefixCount((err as Error).message)).toBe(1);
      expect((err as Error).message).toMatch(/^MCP error -32602: /);
    });

    it('the catch-all InternalError wrapper carries one prefix', async () => {
      const { client } = await startServerWithCredentials();
      const err = await client
        .callTool({
          name: 'get_defender_windows_endpoint',
          arguments: { endpointId: 'd0000001-0001-0001-0001-000000000001' },
        })
        .then(() => null, (e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect(prefixCount((err as Error).message)).toBe(1);
      // INT-53 unified the fault text on the shared catch-all in mcp-core.
      expect((err as Error).message).toMatch(/^MCP error -32603: Tool execution failed: /);
    });
  });
});
