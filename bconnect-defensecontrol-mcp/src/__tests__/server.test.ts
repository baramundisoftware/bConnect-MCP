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

async function startServer() {
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
});
