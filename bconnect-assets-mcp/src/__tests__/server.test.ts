/**
 * bconnect-assets-mcp — server isolation test
 *
 * Verifies that:
 * 1. createServer() starts and lists all 26 expected asset tools
 * 2. No tools from other domains are registered
 * 3. Unknown tool calls return MethodNotFound
 */

import { describe, it, expect } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer } from '../index.js';

const EXPECTED_TOOLS = [
  'list_assets',
  'create_asset',
  'get_asset',
  'update_asset',
  'delete_asset',
  'list_assets_in_asset_stock',
  'list_assets_by_logical_group',
  'list_assets_by_windows_endpoint',
  'list_asset_stock_folders',
  'create_asset_stock_folder',
  'get_asset_stock_folder',
  'update_asset_stock_folder',
  'delete_asset_stock_folder',
  'list_asset_stock_subfolders',
  'list_asset_type_folders',
  'create_asset_type_folder',
  'get_asset_type_folder',
  'update_asset_type_folder',
  'delete_asset_type_folder',
  'list_asset_type_subfolders',
  'list_asset_types',
  'create_asset_type',
  'get_asset_type',
  'delete_asset_type',
  'list_assets_by_org_unit',
  'list_assets_by_ad_object',
];

async function startServer(release = '26R1') {
  process.env.BCONNECT_RELEASE = release;
  const { server } = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return { client };
}

describe('bconnect-assets-mcp', () => {
  it('lists exactly 26 asset tools (26R1)', async () => {
    const { client } = await startServer();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(26);
  });

  it('registers all expected tool names', async () => {
    const { client } = await startServer();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of EXPECTED_TOOLS) {
      expect(names).toContain(expected);
    }
  });

  it('lists exactly 24 asset tools (25R2, without 26R1-only tools)', async () => {
    const { client } = await startServer('25R2');
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(24);
  });

  it('does not register tools from other domains', async () => {
    const { client } = await startServer();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    const forbidden = [
      'list_endpoints', 'get_endpoint',
      'list_ad_groups', 'get_ad_group',
      'list_jobs', 'get_job',
      'list_variables', 'get_variable',
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
