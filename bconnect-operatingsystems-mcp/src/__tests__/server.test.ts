/**
 * bconnect-operatingsystems-mcp — server isolation test
 *
 * Verifies that:
 * 1. createServer() starts and lists all 9 expected operatingsystems tools
 * 2. No tools from other domains are registered
 * 3. Unknown tool calls return MethodNotFound
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer } from '../index.js';

const EXPECTED_TOOLS = [
  'list_os_folders',
  'get_os_folder',
  'list_os_folders_by_folder',
  'list_os_windows_endpoints',
  'get_os_windows_endpoint',
  'create_os_folder',
  'update_os_folder',
  'delete_os_folder',
  'update_os_windows_endpoint',
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
  vi.unstubAllEnvs();
});

describe('bconnect-operatingsystems-mcp', () => {
  // TOK-20: the advertised surface now depends on ALLOW_WRITE_OPERATIONS. The
  // four write tools are still declared and still dispatched — they are simply
  // not advertised while the gate is shut.
  it('lists exactly 5 read tools with the write gate shut', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    const { client } = await startServer();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);
  });

  it('lists exactly 9 operatingsystems tools with the write gate open', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', 'true');
    const { client } = await startServer();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(9);
  });

  it('registers all expected tool names', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', 'true');
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

  // Validator-migration regression tests (centralised validateOrThrow)
  describe('validator rejects bad arguments before reaching bConnect', () => {
    it('get_os_folder: missing id', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'get_os_folder', arguments: {} })
      ).rejects.toThrow(/id is required/i);
    });

    it('get_os_windows_endpoint: endpointId not a GUID', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'get_os_windows_endpoint', arguments: { endpointId: 'oops' } })
      ).rejects.toThrow(/guid/i);
    });

    it('list_os_folders_by_folder: missing folderId', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'list_os_folders_by_folder', arguments: {} })
      ).rejects.toThrow(/folderId is required/i);
    });

    it('create_os_folder: missing folderData', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'create_os_folder', arguments: {} })
      ).rejects.toThrow(/folderData is required/i);
    });

    it('update_os_folder: patchOperations not an array', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({
          name: 'update_os_folder',
          arguments: { id: 'd0000001-0001-0001-0001-000000000001', patchOperations: 'oops' }
        })
      ).rejects.toThrow(/patchOperations/i);
    });
  });
});
