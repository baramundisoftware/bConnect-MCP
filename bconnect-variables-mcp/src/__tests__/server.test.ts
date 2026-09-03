/**
 * bconnect-variables-mcp — server isolation test
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer } from '../index.js';

const EXPECTED_TOOLS = [
  'list_variable_definitions',
  'get_variable_definition',
  'create_variable_definition',
  'update_variable_definition',
  'delete_variable_definition',
  'list_variable_instances',
  'get_variable_instance',
  'list_variable_instances_by_endpoint',
  'list_variable_instances_by_logical_group',
  'list_variable_instances_by_ad_object',
  'list_variable_instances_by_job_definition',
  'list_variable_instances_by_application',
  'update_variable_instance',
];

async function startServer(): Promise<{ client: InstanceType<typeof Client> }> {
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

describe('bconnect-variables-mcp', () => {
  // TOK-20: the four write tools are still declared and still dispatched; they
  // are simply not advertised while ALLOW_WRITE_OPERATIONS is not "true".
  it('lists exactly 9 read tools with the write gate shut', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    const { client } = await startServer();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(9);
  });

  it('lists exactly 13 variable tools with the write gate open', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', 'true');
    const { client } = await startServer();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(13);
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
      'list_jobs', 'get_job',
      'list_installed_windows_software',
      'list_universal_dynamic_groups',
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
    it('get_variable_definition: missing id', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'get_variable_definition', arguments: {} })
      ).rejects.toThrow(/id is required/i);
    });

    // LOCAL PATCH (F23/B3): this test previously asserted "dataType is required".
    // `dataType` is not a bConnect field — the API's VariableDefinitionForCreation
    // requires category + name + scopes — so the test was encoding the bug and
    // protecting it from being noticed. Every create call passed validation and
    // then failed at the API with HTTP 400.
    it('create_variable_definition: missing category', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'create_variable_definition', arguments: { name: 'foo', scopes: ['Endpoint'] } })
      ).rejects.toThrow(/category is required/i);
    });

    it('create_variable_definition: missing scopes', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'create_variable_definition', arguments: { name: 'foo', category: 'bar' } })
      ).rejects.toThrow(/scopes is required/i);
    });

    it('list_variable_instances_by_endpoint: endpointId not a GUID', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'list_variable_instances_by_endpoint', arguments: { endpointId: 'oops' } })
      ).rejects.toThrow(/guid/i);
    });

    it('list_variable_instances_by_job_definition: missing windowsJobDefinitionId', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({ name: 'list_variable_instances_by_job_definition', arguments: {} })
      ).rejects.toThrow(/windowsJobDefinitionId is required/i);
    });

    it('update_variable_instance: patchOperations not an array', async () => {
      const { client } = await startServer();
      await expect(
        client.callTool({
          name: 'update_variable_instance',
          arguments: { id: 'd0000001-0001-0001-0001-000000000001', patchOperations: 'oops' }
        })
      ).rejects.toThrow(/patchOperations/i);
    });
  });
});
