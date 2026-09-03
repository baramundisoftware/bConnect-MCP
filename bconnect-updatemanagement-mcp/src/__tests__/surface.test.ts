/**
 * bconnect-updatemanagement-mcp — the 2026-08-02 round-3 surface revision.
 *
 * Covers, end to end over a real Client <-> Server transport pair:
 *
 *   TOK-20  write tools are not advertised unless ALLOW_WRITE_OPERATIONS=true,
 *           and hiding one does not disable the gate that refuses it.
 *   TOK-25  `countOnly` asks the API for a page past the end and returns the
 *           envelope count instead of a page of rows.
 *   INT-53  expected API failures (400/403/404/429) come back as an isError
 *           tool result; faults (5xx) stay protocol errors.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BConnectApiError } from '@bconnect/mcp-core';

import { createServer } from '../index.js';
import { UpdateManagementModule } from '../modules/updatemanagement.js';

const WRITE_TOOL = 'update_update_management_endpoint';

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
  it('gate shut: the catalogue advertises reads only', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    const { tools } = await (await connect()).listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(['list_update_management_endpoints', 'get_update_management_endpoint']);
    expect(names).not.toContain(WRITE_TOOL);
  });

  it('gate open: the catalogue is the full declared array, in declared order', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', 'true');
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'list_update_management_endpoints',
      'get_update_management_endpoint',
      WRITE_TOOL,
    ]);
  });

  it('hiding is not disabling: calling a hidden write by name still gets the refusal', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    const client = await connect();
    const result = await client.callTool({
      name: WRITE_TOOL,
      arguments: {
        id: 'd0000001-0001-0001-0001-000000000001',
        patchOperations: [{ op: 'replace', path: '/updateProfileId', value: null }],
      },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toBe(
      `Write operation '${WRITE_TOOL}' is disabled. Set ALLOW_WRITE_OPERATIONS=true to enable write operations.`
    );
  });
});

describe('TOK-25 — countOnly', () => {
  it('the list tool advertises countOnly', async () => {
    const { tools } = await (await connect()).listTools();
    const list = tools.find((t) => t.name === 'list_update_management_endpoints')!;
    const properties = (list.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(properties).toHaveProperty('countOnly');
    expect((properties.countOnly as { type: string }).type).toBe('boolean');
  });

  it('asks for a page past the end and returns the count, not the rows', async () => {
    const spy = vi
      .spyOn(UpdateManagementModule.prototype, 'getWindowsEndpoints')
      .mockResolvedValue({ page: 100000, pageSize: 1, totalItems: 137, totalPages: 137, data: [] } as never);

    const client = await connect();
    const result = await client.callTool({
      name: 'list_update_management_endpoints',
      arguments: { countOnly: true, SearchQuery: 'WIN11' },
    });

    expect(spy).toHaveBeenCalledWith({ SearchQuery: 'WIN11', Page: 100000, PageSize: 1 });
    const payload = JSON.parse(textOf(result));
    expect(payload).toEqual({ totalItems: 137, filters: { SearchQuery: 'WIN11' } });
    expect(payload).not.toHaveProperty('data');
    // The whole point: the count costs a couple of hundred bytes, not a page.
    expect(textOf(result).length).toBeLessThan(200);
  });

  it('countOnly must be a boolean', async () => {
    const client = await connect();
    await expect(
      client.callTool({ name: 'list_update_management_endpoints', arguments: { countOnly: 'yes' } })
    ).rejects.toThrow(/countOnly must be of type boolean/i);
  });
});

describe('INT-53 — one error channel', () => {
  it('404 comes back as a readable isError result, not a protocol error', async () => {
    vi.spyOn(UpdateManagementModule.prototype, 'getWindowsEndpoint').mockRejectedValue(
      new BConnectApiError(404, 'Resource not found. GET /updatemanagement/v2.0/WindowsEndpoints/…', {
        method: 'GET',
        path: '/updatemanagement/v2.0/WindowsEndpoints/x',
      })
    );

    const client = await connect();
    const result = await client.callTool({
      name: 'get_update_management_endpoint',
      arguments: { id: 'd0000001-0001-0001-0001-000000000001' },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toContain('Resource not found.');
  });

  it('500 stays a protocol InternalError', async () => {
    vi.spyOn(UpdateManagementModule.prototype, 'getWindowsEndpoint').mockRejectedValue(
      new BConnectApiError(500, 'bConnect API returned an internal server error.', {
        method: 'GET',
        path: '/updatemanagement/v2.0/WindowsEndpoints/x',
      })
    );

    const client = await connect();
    await expect(
      client.callTool({
        name: 'get_update_management_endpoint',
        arguments: { id: 'd0000001-0001-0001-0001-000000000001' },
      })
    ).rejects.toThrow(/Tool execution failed: bConnect API returned an internal server error\./);
  });

  it('a validation failure is still a protocol error, not an isError result', async () => {
    const client = await connect();
    await expect(
      client.callTool({ name: 'get_update_management_endpoint', arguments: { id: 'not-a-guid' } })
    ).rejects.toThrow(/guid/i);
  });
});
