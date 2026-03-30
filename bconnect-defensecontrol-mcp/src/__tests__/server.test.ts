/**
 * bconnect-defensecontrol-mcp — server isolation test
 *
 * Verifies that:
 * 1. createServer() starts and lists all 13 expected defensecontrol tools
 * 2. No tools from other domains are registered
 * 3. Unknown tool calls return MethodNotFound
 */

import { describe, it, expect } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer } from '../index.js';

const EXPECTED_TOOLS = [
  // BitLocker
  'list_bitlocker_windows_endpoints',
  'get_bitlocker_windows_endpoint',
  'get_bitlocker_secrets',
  'update_bitlocker_pin',
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

async function startServer() {
  const { server } = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return { client };
}

describe('bconnect-defensecontrol-mcp', () => {
  it('lists exactly 13 defensecontrol tools', async () => {
    const { client } = await startServer();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(13);
  });

  it('registers all expected tool names', async () => {
    const { client } = await startServer();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of EXPECTED_TOOLS) {
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
