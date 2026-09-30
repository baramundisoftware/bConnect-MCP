/**
 * bconnect-activedirectory-mcp — server isolation test
 *
 * Verifies that:
 * 1. createServer() starts and lists all 16 expected AD tools
 * 2. No tools from other domains are registered
 * 3. Unknown tool calls return MethodNotFound
 */

import { describe, it, expect } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer } from '../index.js';

const EXPECTED_TOOLS = [
  'list_ad_groups',
  'get_ad_group',
  'list_ad_subgroups',
  'list_ad_groups_by_org_unit',
  'list_ad_objects',
  'get_ad_object',
  'list_ad_object_memberships',
  'list_ad_objects_by_group',
  'list_ad_objects_by_org_unit',
  'list_ad_users',
  'get_ad_user',
  'list_ad_users_by_group',
  'list_ad_users_by_org_unit',
  'list_org_units',
  'get_org_unit',
  'list_org_units_by_org_unit',
];

async function startServer(): Promise<void> {
  const { server } = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return { client };
}

describe('bconnect-activedirectory-mcp', () => {
  it('lists exactly 16 AD tools', async () => {
    const { client } = await startServer();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(16);
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
    // Must not contain endpoint, asset, job, or other domain tools
    const forbidden = [
      'list_endpoints', 'get_endpoint',
      'list_assets', 'get_asset',
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

  // Validator-migration regression tests (centralised validateOrThrow)
  describe('validator rejects bad arguments before reaching bConnect', () => {
    it('get_ad_group: missing id', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'get_ad_group', arguments: {} })
      ).rejects.toThrow(/id is required/i);
    });

    it('get_ad_user: id not a GUID', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'get_ad_user', arguments: { id: 'not-a-guid' } })
      ).rejects.toThrow(/guid/i);
    });

    it('list_ad_subgroups: missing adGroupId', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'list_ad_subgroups', arguments: {} })
      ).rejects.toThrow(/adGroupId is required/i);
    });

    it('list_ad_users_by_org_unit: orgUnitId not a GUID', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'list_ad_users_by_org_unit', arguments: { orgUnitId: 'oops' } })
      ).rejects.toThrow(/guid/i);
    });

    it('list_ad_object_memberships: missing id', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'list_ad_object_memberships', arguments: {} })
      ).rejects.toThrow(/id is required/i);
    });
  });
});
