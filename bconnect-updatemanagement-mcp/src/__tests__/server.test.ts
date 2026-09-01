/**
 * bconnect-updatemanagement-mcp — server isolation test
 */

import { describe, it, expect, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer } from '../index.js';

/**
 * TOK-20: the advertised surface now depends on ALLOW_WRITE_OPERATIONS, so the
 * expectations are split. `update_update_management_endpoint` is still declared
 * and still dispatched — it is simply not advertised while the gate is shut.
 */
const EXPECTED_READ_TOOLS = [
  'list_update_management_endpoints',
  'get_update_management_endpoint',
];

const EXPECTED_WRITE_TOOLS = [
  'update_update_management_endpoint',
];

async function startServer() {
  const { server } = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return { client };
}

describe('bconnect-updatemanagement-mcp', () => {
  it('lists exactly 2 read tools with the write gate shut', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    const { client } = await startServer();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(2);
    vi.unstubAllEnvs();
  });

  it('lists exactly 3 update management tools with the write gate open', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', 'true');
    const { client } = await startServer();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(3);
    vi.unstubAllEnvs();
  });

  it('registers all expected tool names', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', 'true');
    const { client } = await startServer();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of [...EXPECTED_READ_TOOLS, ...EXPECTED_WRITE_TOOLS]) {
      expect(names).toContain(expected);
    }
    vi.unstubAllEnvs();
  });

  it('does not register tools from other domains', async () => {
    const { client } = await startServer();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    const forbidden = [
      'list_endpoints', 'get_endpoint',
      'list_assets', 'get_asset',
      'list_jobs', 'get_job',
      'list_installed_windows_software',
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
    it('get_update_management_endpoint: missing id', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'get_update_management_endpoint', arguments: {} })
      ).rejects.toThrow(/id is required/i);
    });

    it('get_update_management_endpoint: id not a GUID', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'get_update_management_endpoint', arguments: { id: 'not-a-guid' } })
      ).rejects.toThrow(/guid/i);
    });

    it('update_update_management_endpoint: missing patchOperations', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({
          name: 'update_update_management_endpoint',
          arguments: { id: 'd0000001-0001-0001-0001-000000000001' }
        })
      ).rejects.toThrow(/patchOperations/i);
    });

    it('update_update_management_endpoint: patchOperations not an array', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({
          name: 'update_update_management_endpoint',
          arguments: { id: 'd0000001-0001-0001-0001-000000000001', patchOperations: 'oops' }
        })
      ).rejects.toThrow(/patchOperations/i);
    });
  });
});
