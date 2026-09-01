/**
 * bconnect-variables-mcp — the 2026-08-02 round-3 surface revision.
 *
 *   TOK-20  write tools are advertised only when ALLOW_WRITE_OPERATIONS=true.
 *   TOK-25  `countOnly` returns the envelope count instead of a page of rows.
 *   TOK-10  the seven filter properties that were spelled out on all eight list
 *           tools are now one shared fragment, and `Scope`'s enum survived the
 *           collapse — it is the one filter bConnect rejects rather than ignores.
 *   INT-53  expected API failures come back as isError tool results.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BConnectApiError, PAGE_DESCRIPTION, VERBOSE_PAGE_DESCRIPTION } from '@bconnect/mcp-core';

import { createServer } from '../index.js';
import { VariablesModule } from '../modules/variables.js';

const WRITE_TOOLS = [
  'create_variable_definition',
  'update_variable_definition',
  'delete_variable_definition',
  'update_variable_instance',
];

const LIST_TOOLS = [
  'list_variable_definitions',
  'list_variable_instances',
  'list_variable_instances_by_endpoint',
  'list_variable_instances_by_logical_group',
  'list_variable_instances_by_ad_object',
  'list_variable_instances_by_job_definition',
  'list_variable_instances_by_application',
];

const GUID = 'd0000001-0001-0001-0001-000000000001';

async function connect(): Promise<Client> {
  const { server } = createServer({ apiKey: 'test-key', baseUrl: 'https://bms-server/bconnect' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'surface-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: unknown): string {
  return (result as { content: { text: string }[] }).content[0]!.text;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('TOK-20 — write tools are conditional on ALLOW_WRITE_OPERATIONS', () => {
  it('gate shut: no write tool is advertised', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    const names = (await (await connect()).listTools()).tools.map((t) => t.name);
    for (const write of WRITE_TOOLS) {
      expect(names).not.toContain(write);
    }
    expect(names).toHaveLength(9);
  });

  it('gate open: every declared tool is advertised', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', 'true');
    const names = (await (await connect()).listTools()).tools.map((t) => t.name);
    for (const write of WRITE_TOOLS) {
      expect(names).toContain(write);
    }
    expect(names).toHaveLength(13);
  });

  it('hiding is not disabling: a hidden write called by name still gets the refusal', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    const client = await connect();
    const result = await client.callTool({
      name: 'delete_variable_definition',
      arguments: { id: GUID },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toBe(
      "Write operation 'delete_variable_definition' is disabled. Set ALLOW_WRITE_OPERATIONS=true to enable write operations."
    );
  });
});

describe('TOK-10 — one shared filter fragment across the list tools', () => {
  it('every list tool declares the same seven filters, with the canonical Page wording', async () => {
    const { tools } = await (await connect()).listTools();
    for (const name of LIST_TOOLS) {
      const tool = tools.find((t) => t.name === name)!;
      const props = (tool.inputSchema as {
        properties: Record<string, { description?: string; enum?: string[] }>;
      }).properties;

      for (const key of ['OrderBy', 'SearchQuery', 'Page', 'PageSize', 'Name', 'Category', 'Scope']) {
        expect(props, `${name}.${key}`).toHaveProperty(key);
      }
      expect(props.Page!.description, name).toBe(PAGE_DESCRIPTION);
      expect(props.Page!.description, name).not.toBe(VERBOSE_PAGE_DESCRIPTION);
      // D14b: Scope is the one filter bConnect rejects with 400 rather than
      // silently ignoring, so its allowed values must survive.
      expect(props.Scope!.enum, name).toContain('WindowsJobDefinition');
      expect(props.Scope!.enum, name).toHaveLength(9);
    }
  });
});

describe('TOK-25 — countOnly', () => {
  it('every list tool advertises countOnly', async () => {
    const { tools } = await (await connect()).listTools();
    for (const name of LIST_TOOLS) {
      const tool = tools.find((t) => t.name === name)!;
      expect((tool.inputSchema as { properties: object }).properties, name).toHaveProperty('countOnly');
    }
  });

  it('asks for a page past the end and returns the count, not the rows', async () => {
    const spy = vi
      .spyOn(VariablesModule.prototype, 'getVariableDefinitions')
      .mockResolvedValue({ page: 100000, pageSize: 1, totalItems: 63, totalPages: 63, data: [] } as never);

    const client = await connect();
    const result = await client.callTool({
      name: 'list_variable_definitions',
      arguments: { countOnly: true, Scope: 'Endpoint' },
    });

    expect(spy).toHaveBeenCalledWith({ Scope: 'Endpoint', Page: 100000, PageSize: 1 });
    expect(JSON.parse(textOf(result))).toEqual({ totalItems: 63, filters: { Scope: 'Endpoint' } });
  });

  it('the scoped count keeps the path id out of the query', async () => {
    const spy = vi
      .spyOn(VariablesModule.prototype, 'getVariableInstancesByEndpoint')
      .mockResolvedValue({ page: 100000, pageSize: 1, totalItems: 7, totalPages: 7, data: [] } as never);

    const client = await connect();
    await client.callTool({
      name: 'list_variable_instances_by_endpoint',
      arguments: { endpointId: GUID, countOnly: true },
    });

    expect(spy).toHaveBeenCalledWith(GUID, { Page: 100000, PageSize: 1 });
  });
});

describe('INT-53 — one error channel', () => {
  it('404 comes back as a readable isError result', async () => {
    vi.spyOn(VariablesModule.prototype, 'getVariableDefinition').mockRejectedValue(
      new BConnectApiError(404, 'Resource not found. GET /variables/v2.0/VariableDefinitions/…')
    );
    const client = await connect();
    const result = await client.callTool({ name: 'get_variable_definition', arguments: { id: GUID } });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toContain('Resource not found.');
  });

  it('500 stays a protocol InternalError', async () => {
    vi.spyOn(VariablesModule.prototype, 'getVariableDefinition').mockRejectedValue(
      new BConnectApiError(500, 'bConnect API returned an internal server error.')
    );
    const client = await connect();
    await expect(
      client.callTool({ name: 'get_variable_definition', arguments: { id: GUID } })
    ).rejects.toThrow(/Tool execution failed: bConnect API returned an internal server error\./);
  });
});
