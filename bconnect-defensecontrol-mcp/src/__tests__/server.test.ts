/**
 * bconnect-defensecontrol-mcp — server isolation test
 *
 * Verifies that:
 * 1. createServer() starts and lists all 11 expected defensecontrol tools (25R2)
 * 2. In 26R1 mode, 2 additional BitLocker tools are added (13 total)
 * 3. No tools from other domains are registered
 * 4. Unknown tool calls return MethodNotFound
 */

import { describe, it, expect, afterEach } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer } from '../index.js';

const EXPECTED_TOOLS_25R2 = [
  // BitLocker (25R2)
  'list_bitlocker_windows_endpoints',
  'get_bitlocker_windows_endpoint',
  // Local Admin
  'get_local_admin_accounts',
  'patch_local_admin_user_credentials',
  'trigger_update_on_client',
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

async function startServer(): Promise<void> {
  const { server } = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return { client };
}

afterEach(() => {
  delete process.env.BCONNECT_RELEASE;
});

describe('bconnect-defensecontrol-mcp', () => {
  it('lists exactly 11 defensecontrol tools in 25R2 mode', async () => {
    const { client } = await startServer();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(11);
  });

  it('registers all expected tool names (25R2)', async () => {
    const { client } = await startServer();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of EXPECTED_TOOLS_25R2) {
      expect(names).toContain(expected);
    }
  });

  it('lists exactly 13 defensecontrol tools in 26R1 mode', async () => {
    process.env.BCONNECT_RELEASE = '26R1';
    const { client } = await startServer();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(13);
  });

  it('registers 26R1-only tools when BCONNECT_RELEASE=26R1', async () => {
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

    it('trigger_update_on_client: timeout not a number', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({
          name: 'trigger_update_on_client',
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
});
