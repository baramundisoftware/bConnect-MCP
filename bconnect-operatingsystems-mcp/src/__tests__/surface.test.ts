/**
 * bconnect-operatingsystems-mcp — the 2026-08-02 round-3 surface revision.
 *
 *   TOK-20  write tools are advertised only when ALLOW_WRITE_OPERATIONS=true;
 *           hiding one does not disable the gate that refuses it.
 *   TOK-25  `countOnly` returns the envelope count instead of a page of rows.
 *   TOK-10  the shared pagination fragment replaced the copied OpenAPI prose.
 *   INT-53  expected API failures come back as isError tool results.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BConnectApiError, PAGE_DESCRIPTION, VERBOSE_PAGE_DESCRIPTION } from '@bconnect/mcp-core';

import { createServer } from '../index.js';
import { OperatingSystemsModule } from '../modules/operatingsystems.js';

const WRITE_TOOLS = [
  'create_os_folder',
  'update_os_folder',
  'delete_os_folder',
  'update_os_windows_endpoint',
];

const LIST_TOOLS = ['list_os_folders', 'list_os_folders_by_folder', 'list_os_windows_endpoints'];

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
    const { tools } = await (await connect()).listTools();
    const names = tools.map((t) => t.name);
    for (const write of WRITE_TOOLS) {
      expect(names).not.toContain(write);
    }
  });

  it('gate open: the surface is the full declared array, in declared order', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', 'true');
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'list_os_folders',
      'get_os_folder',
      'list_os_folders_by_folder',
      'list_os_windows_endpoints',
      'get_os_windows_endpoint',
      ...WRITE_TOOLS,
    ]);
  });

  it('hiding is not disabling: a hidden write called by name still gets the refusal', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    const client = await connect();
    const result = await client.callTool({ name: 'delete_os_folder', arguments: { id: GUID } });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toBe(
      "Write operation 'delete_os_folder' is disabled. Set ALLOW_WRITE_OPERATIONS=true to enable write operations."
    );
  });
});

describe('TOK-10 — shared schema fragments', () => {
  it('every list tool uses the canonical zero-indexed Page wording', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', 'true');
    const { tools } = await (await connect()).listTools();
    for (const name of LIST_TOOLS) {
      const tool = tools.find((t) => t.name === name)!;
      const props = (tool.inputSchema as { properties: Record<string, { description?: string }> }).properties;
      expect(props.Page!.description, name).toBe(PAGE_DESCRIPTION);
      expect(props.Page!.description, name).not.toBe(VERBOSE_PAGE_DESCRIPTION);
    }
  });
});

describe('TOK-25 — countOnly', () => {
  it('every list tool advertises countOnly', async () => {
    const { tools } = await (await connect()).listTools();
    for (const name of LIST_TOOLS) {
      const tool = tools.find((t) => t.name === name)!;
      const props = (tool.inputSchema as { properties: Record<string, unknown> }).properties;
      expect(props, name).toHaveProperty('countOnly');
    }
  });

  it('asks for a page past the end and returns the count, not the rows', async () => {
    const spy = vi
      .spyOn(OperatingSystemsModule.prototype, 'getWindowsEndpoints')
      .mockResolvedValue({ page: 100000, pageSize: 1, totalItems: 84, totalPages: 84, data: [] } as never);

    const client = await connect();
    const result = await client.callTool({
      name: 'list_os_windows_endpoints',
      arguments: { countOnly: true },
    });

    expect(spy).toHaveBeenCalledWith({ Page: 100000, PageSize: 1 });
    expect(JSON.parse(textOf(result))).toEqual({ totalItems: 84 });
  });

  it('the folder-scoped count keeps the path id out of the query', async () => {
    const spy = vi
      .spyOn(OperatingSystemsModule.prototype, 'getFoldersByFolderId')
      .mockResolvedValue({ page: 100000, pageSize: 1, totalItems: 3, totalPages: 3, data: [] } as never);

    const client = await connect();
    const result = await client.callTool({
      name: 'list_os_folders_by_folder',
      arguments: { folderId: GUID, countOnly: true, includeSubfolders: true },
    });

    expect(spy).toHaveBeenCalledWith(GUID, { includeSubfolders: true, Page: 100000, PageSize: 1 });
    expect(JSON.parse(textOf(result))).toEqual({
      totalItems: 3,
      filters: { includeSubfolders: true },
    });
  });
});

describe('INT-53 — one error channel', () => {
  it('404 comes back as a readable isError result', async () => {
    vi.spyOn(OperatingSystemsModule.prototype, 'getFolder').mockRejectedValue(
      new BConnectApiError(404, 'Resource not found. GET /operatingsystems/v2.0/Folders/…')
    );
    const client = await connect();
    const result = await client.callTool({ name: 'get_os_folder', arguments: { id: GUID } });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toContain('Resource not found.');
  });

  it('500 stays a protocol InternalError', async () => {
    vi.spyOn(OperatingSystemsModule.prototype, 'getFolder').mockRejectedValue(
      new BConnectApiError(500, 'bConnect API returned an internal server error.')
    );
    const client = await connect();
    await expect(client.callTool({ name: 'get_os_folder', arguments: { id: GUID } })).rejects.toThrow(
      /Tool execution failed: bConnect API returned an internal server error\./
    );
  });
});
