/**
 * bconnect-universaldynamicgroups-mcp — server isolation test
 *
 * Verifies that:
 * 1. 25R2 mode returns 0 tools (26R1-only server)
 * 2. 26R1 mode registers all 6 UDG tools
 * 3. No tools from other domains are registered
 * 4. Unknown tool calls return MethodNotFound
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer } from '../index.js';

const EXPECTED_TOOLS = [
  'list_universal_dynamic_groups',
  'get_universal_dynamic_group',
  'list_universal_dynamic_groups_by_folder',
  'list_udg_folders',
  'get_udg_folder',
  'list_udg_folders_by_folder',
];

async function startServer(release: string = '25R2') {
  process.env.BCONNECT_RELEASE = release;
  const { server } = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return { client };
}

describe('bconnect-universaldynamicgroups-mcp (25R2 mode)', () => {
  afterEach(() => { delete process.env.BCONNECT_RELEASE; });

  it('returns 0 tools in 25R2 (26R1-only server)', async () => {
    const { client } = await startServer('25R2');
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(0);
  });
});

describe('bconnect-universaldynamicgroups-mcp (26R1 mode)', () => {
  beforeEach(() => { process.env.BCONNECT_RELEASE = '26R1'; });
  afterEach(() => { delete process.env.BCONNECT_RELEASE; });

  it('lists exactly 6 UDG tools in 26R1', async () => {
    const { client } = await startServer('26R1');
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(6);
  });

  it('registers all expected UDG tool names', async () => {
    const { client } = await startServer('26R1');
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of EXPECTED_TOOLS) {
      expect(names).toContain(expected);
    }
  });

  it('does not register tools from other domains', async () => {
    const { client } = await startServer('26R1');
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    const forbidden = [
      'list_endpoints', 'get_endpoint',
      'list_assets', 'get_asset',
      'list_installed_windows_software',
      'list_software_bundles',
      'list_jobs', 'get_job',
    ];
    for (const name of forbidden) {
      expect(names).not.toContain(name);
    }
  });

  it('all tools have descriptions of at least 20 words', async () => {
    const { client } = await startServer('26R1');
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const wordCount = tool.description?.split(/\s+/).length ?? 0;
      expect(wordCount, `${tool.name} description too short (${wordCount} words)`).toBeGreaterThanOrEqual(20);
    }
  });

  it('returns MethodNotFound for unknown tool', async () => {
    const { client } = await startServer('26R1');
    await expect(
      client.callTool({ name: 'nonexistent_tool', arguments: {} })
    ).rejects.toThrow();
  });

  // Validator-migration regression tests (centralised validateOrThrow)
  describe('validator rejects bad arguments before reaching bConnect', () => {
    it('get_universal_dynamic_group: missing id', async () => {
      const { client } = await startServer('26R1');
      await expect(
        client.callTool({ name: 'get_universal_dynamic_group', arguments: {} })
      ).rejects.toThrow(/id is required/i);
    });

    it('get_universal_dynamic_group: id not a GUID', async () => {
      const { client } = await startServer('26R1');
      await expect(
        client.callTool({ name: 'get_universal_dynamic_group', arguments: { id: 'not-a-guid' } })
      ).rejects.toThrow(/guid/i);
    });

    it('list_universal_dynamic_groups_by_folder: missing folderId', async () => {
      const { client } = await startServer('26R1');
      await expect(
        client.callTool({ name: 'list_universal_dynamic_groups_by_folder', arguments: {} })
      ).rejects.toThrow(/folderId is required/i);
    });

    it('list_udg_folders_by_folder: folderId not a GUID', async () => {
      const { client } = await startServer('26R1');
      await expect(
        client.callTool({
          name: 'list_udg_folders_by_folder',
          arguments: { folderId: 'oops' }
        })
      ).rejects.toThrow(/guid/i);
    });
  });
});
