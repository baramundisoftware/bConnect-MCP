/**
 * bconnect-activedirectory-mcp — the 2026-08-02 round-3 surface revision.
 *
 *   TOK-10  the same 8-line Page/PageSize pair was written out 12 times in this
 *           file — more occurrences than any other server in this territory. It
 *           is now the shared `pageProperties` fragment.
 *   TOK-25  `countOnly` returns the envelope count instead of a page of rows.
 *   TOK-20  this server declares no writes; the catalogue is asserted read-only
 *           so that adding a write here without gating it fails a test.
 *   INT-53  expected API failures come back as isError tool results.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  BConnectApiError,
  PAGE_DESCRIPTION,
  PAGE_SIZE_DESCRIPTION,
  VERBOSE_PAGE_DESCRIPTION,
  WRITE_TOOL_VERB_PREFIXES,
} from '@bconnect/mcp-core';

import { createServer } from '../index.js';
import { ActiveDirectoryModule } from '../modules/activedirectory.js';

const LIST_TOOLS = [
  'list_ad_groups',
  'list_ad_subgroups',
  'list_ad_groups_by_org_unit',
  'list_ad_objects',
  'list_ad_object_memberships',
  'list_ad_objects_by_group',
  'list_ad_objects_by_org_unit',
  'list_ad_users',
  'list_ad_users_by_group',
  'list_ad_users_by_org_unit',
  'list_org_units',
  'list_org_units_by_org_unit',
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

describe('TOK-20 — the catalogue is read-only and stays that way', () => {
  it('advertises the same tools whether the write gate is open or shut', async () => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', '');
    const shut = (await (await connect()).listTools()).tools.map((t) => t.name);
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', 'true');
    const open = (await (await connect()).listTools()).tools.map((t) => t.name);
    expect(shut).toEqual(open);
    expect(shut).toHaveLength(16);
  });

  it('no advertised tool carries a write verb', async () => {
    const names = (await (await connect()).listTools()).tools.map((t) => t.name);
    expect(names.filter((n) => WRITE_TOOL_VERB_PREFIXES.some((p) => n.startsWith(p)))).toEqual([]);
  });
});

describe('TOK-10 — all 12 hand-written pagination blocks became one fragment', () => {
  it('every list tool uses the canonical wording', async () => {
    const { tools } = await (await connect()).listTools();
    for (const name of LIST_TOOLS) {
      const tool = tools.find((t) => t.name === name)!;
      const props = (tool.inputSchema as { properties: Record<string, { description?: string }> }).properties;
      expect(props.Page!.description, name).toBe(PAGE_DESCRIPTION);
      expect(props.PageSize!.description, name).toBe(PAGE_SIZE_DESCRIPTION);
      expect(props.Page!.description, name).not.toBe(VERBOSE_PAGE_DESCRIPTION);
    }
  });

  it('the per-tool traversal flags survived the collapse', async () => {
    const { tools } = await (await connect()).listTools();
    const subgroups = tools.find((t) => t.name === 'list_ad_subgroups')!;
    const byOrgUnit = tools.find((t) => t.name === 'list_ad_groups_by_org_unit')!;
    expect((subgroups.inputSchema as { properties: object }).properties).toHaveProperty('includeIndirect');
    expect((byOrgUnit.inputSchema as { properties: object }).properties).toHaveProperty('includeSubOrgUnit');
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
      .spyOn(ActiveDirectoryModule.prototype, 'getADUsers')
      .mockResolvedValue({ page: 100000, pageSize: 1, totalItems: 1204, totalPages: 1204, data: [] } as never);

    const client = await connect();
    const result = await client.callTool({
      name: 'list_ad_users',
      arguments: { countOnly: true, SearchQuery: 'labcorp' },
    });

    expect(spy).toHaveBeenCalledWith({ SearchQuery: 'labcorp', Page: 100000, PageSize: 1 });
    expect(JSON.parse(textOf(result))).toEqual({
      totalItems: 1204,
      filters: { SearchQuery: 'labcorp' },
    });
  });

  it('the group-scoped count keeps the path id out of the query', async () => {
    const spy = vi
      .spyOn(ActiveDirectoryModule.prototype, 'getADUsersByGroup')
      .mockResolvedValue({ page: 100000, pageSize: 1, totalItems: 18, totalPages: 18, data: [] } as never);

    const client = await connect();
    const result = await client.callTool({
      name: 'list_ad_users_by_group',
      arguments: { adGroupId: GUID, countOnly: true, includeIndirect: true },
    });

    expect(spy).toHaveBeenCalledWith(GUID, { includeIndirect: true, Page: 100000, PageSize: 1 });
    expect(JSON.parse(textOf(result))).toEqual({
      totalItems: 18,
      filters: { includeIndirect: true },
    });
  });
});

describe('INT-53 — one error channel', () => {
  it('404 comes back as a readable isError result', async () => {
    vi.spyOn(ActiveDirectoryModule.prototype, 'getADGroup').mockRejectedValue(
      new BConnectApiError(404, 'Resource not found. GET /activedirectory/v2.0/ADGroups/…')
    );
    const client = await connect();
    const result = await client.callTool({ name: 'get_ad_group', arguments: { id: GUID } });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toContain('Resource not found.');
  });

  it('429 comes back as a readable isError result — the model can slow down', async () => {
    vi.spyOn(ActiveDirectoryModule.prototype, 'getADGroup').mockRejectedValue(
      new BConnectApiError(429, 'Rate limit exceeded. Retry after a short delay.')
    );
    const client = await connect();
    const result = await client.callTool({ name: 'get_ad_group', arguments: { id: GUID } });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toContain('Rate limit exceeded');
  });

  it('500 stays a protocol InternalError', async () => {
    vi.spyOn(ActiveDirectoryModule.prototype, 'getADGroup').mockRejectedValue(
      new BConnectApiError(500, 'bConnect API returned an internal server error.')
    );
    const client = await connect();
    await expect(client.callTool({ name: 'get_ad_group', arguments: { id: GUID } })).rejects.toThrow(
      /Tool execution failed: bConnect API returned an internal server error\./
    );
  });
});
