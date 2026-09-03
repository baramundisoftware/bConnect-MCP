/**
 * bconnect-assets-mcp — the 2026-08-02 round-3 surface revision.
 *
 *   TOK-20  write tools are advertised only when ALLOW_WRITE_OPERATIONS=true.
 *           This is the largest write set in the territory: 11 of 26 tools.
 *   TOK-25  `countOnly` returns the envelope count instead of a page of rows.
 *   TOK-10  the local paginationProps/filter fragments now build on mcp-core's,
 *           so this server and the other twelve say the same thing.
 *   INT-53  expected API failures come back as isError tool results.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BConnectApiError, PAGE_DESCRIPTION, VERBOSE_PAGE_DESCRIPTION } from '@bconnect/mcp-core';

import { createServer } from '../index.js';
import { AssetsModule } from '../modules/assets.js';

const WRITE_TOOLS = [
  'create_asset',
  'update_asset',
  'delete_asset',
  'create_asset_stock_folder',
  'update_asset_stock_folder',
  'delete_asset_stock_folder',
  'create_asset_type_folder',
  'update_asset_type_folder',
  'delete_asset_type_folder',
  'create_asset_type',
  'delete_asset_type',
];

const LIST_TOOLS = [
  'list_assets',
  'list_assets_in_asset_stock',
  'list_assets_by_logical_group',
  'list_assets_by_windows_endpoint',
  'list_assets_by_org_unit',
  'list_assets_by_ad_object',
  'list_asset_stock_folders',
  'list_asset_stock_subfolders',
  'list_asset_type_folders',
  'list_asset_type_subfolders',
  'list_asset_types',
];

const GUID = 'd0000001-0001-0001-0001-000000000001';

async function connect(release?: string): Promise<Client> {
  if (release) {
    vi.stubEnv('BCONNECT_RELEASE', release);
  }
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
  it('gate shut (26R1): 15 read tools, none of the 11 writes advertised', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    const names = (await (await connect()).listTools()).tools.map((t) => t.name);
    expect(names).toHaveLength(15);
    for (const write of WRITE_TOOLS) {
      expect(names).not.toContain(write);
    }
  });

  it('gate open (26R1): all 26 declared tools are advertised', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', 'true');
    const names = (await (await connect()).listTools()).tools.map((t) => t.name);
    expect(names).toHaveLength(26);
    for (const write of WRITE_TOOLS) {
      expect(names).toContain(write);
    }
  });

  // MIGRATED (Decision 2). Was "gate shut (25R2): the two 26R1 reads are gone".
  // The release switch is gone, so the two reads are always advertised and the
  // only thing the write gate hides is writes. Asserting the OLD names are
  // present is what makes a reintroduced release conditional fail.
  it('gate shut: the 26R1 reads are still advertised — only writes are hidden', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    const names = (await (await connect('25R2')).listTools()).tools.map((t) => t.name);
    expect(names).toHaveLength(15);
    expect(names).toContain('list_assets_by_org_unit');
    expect(names).toContain('list_assets_by_ad_object');
    for (const write of WRITE_TOOLS) {
      expect(names).not.toContain(write);
    }
  });

  it('hiding is not disabling: a hidden write called by name still gets the refusal', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    const client = await connect();
    const result = await client.callTool({ name: 'delete_asset', arguments: { id: GUID } });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toBe(
      "Write operation 'delete_asset' is disabled. Set ALLOW_WRITE_OPERATIONS=true to enable write operations."
    );
  });
});

describe('TOK-10 — shared schema fragments', () => {
  it('every list tool uses the canonical zero-indexed Page wording', async () => {
    const { tools } = await (await connect()).listTools();
    for (const name of LIST_TOOLS) {
      const tool = tools.find((t) => t.name === name)!;
      const props = (tool.inputSchema as { properties: Record<string, { description?: string }> }).properties;
      expect(props.Page!.description, name).toBe(PAGE_DESCRIPTION);
      expect(props.Page!.description, name).not.toBe(VERBOSE_PAGE_DESCRIPTION);
    }
  });

  it('the domain-specific OrderBy/SearchQuery hints were not collapsed away', async () => {
    const { tools } = await (await connect()).listTools();
    const list = tools.find((t) => t.name === 'list_assets')!;
    const props = (list.inputSchema as { properties: Record<string, { description?: string }> }).properties;
    expect(props.SearchQuery!.description).toContain('InventoryNumber');
    expect(props.OrderBy!.description).toContain('AssetId');
    expect(props).toHaveProperty('DisplayName');
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
      .spyOn(AssetsModule.prototype, 'getAssets')
      .mockResolvedValue({ page: 100000, pageSize: 1, totalItems: 412, totalPages: 412, data: [] } as never);

    const client = await connect();
    const result = await client.callTool({
      name: 'list_assets',
      arguments: { countOnly: true, DisplayName: 'Dell Latitude' },
    });

    expect(spy).toHaveBeenCalledWith({ DisplayName: 'Dell Latitude', Page: 100000, PageSize: 1 });
    expect(JSON.parse(textOf(result))).toEqual({
      totalItems: 412,
      filters: { DisplayName: 'Dell Latitude' },
    });
  });

  it('the endpoint-scoped count keeps the path id out of the query', async () => {
    const spy = vi
      .spyOn(AssetsModule.prototype, 'getAssetsByWindowsEndpoint')
      .mockResolvedValue({ page: 100000, pageSize: 1, totalItems: 3, totalPages: 3, data: [] } as never);

    const client = await connect();
    const result = await client.callTool({
      name: 'list_assets_by_windows_endpoint',
      arguments: { endpointId: GUID, countOnly: true },
    });

    expect(spy).toHaveBeenCalledWith(GUID, { Page: 100000, PageSize: 1 });
    expect(JSON.parse(textOf(result))).toEqual({ totalItems: 3 });
  });
});

describe('INT-53 — one error channel', () => {
  it('404 comes back as a readable isError result', async () => {
    vi.spyOn(AssetsModule.prototype, 'getAsset').mockRejectedValue(
      new BConnectApiError(404, 'Resource not found. GET /assets/v2.0/Assets/…')
    );
    const client = await connect();
    const result = await client.callTool({ name: 'get_asset', arguments: { id: GUID } });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toContain('Resource not found.');
  });

  it('400 comes back as a readable isError result, carrying the API detail', async () => {
    vi.spyOn(AssetsModule.prototype, 'getAsset').mockRejectedValue(
      new BConnectApiError(400, 'bConnect API error (HTTP 400): ownerType is not a known value.')
    );
    const client = await connect();
    const result = await client.callTool({ name: 'get_asset', arguments: { id: GUID } });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toContain('ownerType is not a known value.');
  });

  it('500 stays a protocol InternalError', async () => {
    vi.spyOn(AssetsModule.prototype, 'getAsset').mockRejectedValue(
      new BConnectApiError(500, 'bConnect API returned an internal server error.')
    );
    const client = await connect();
    await expect(client.callTool({ name: 'get_asset', arguments: { id: GUID } })).rejects.toThrow(
      /Tool execution failed: bConnect API returned an internal server error\./
    );
  });
});
