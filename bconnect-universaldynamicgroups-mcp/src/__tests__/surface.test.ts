/**
 * bconnect-universaldynamicgroups-mcp — the 2026-08-02 round-3 surface revision.
 *
 *   TOK-25  `countOnly` returns the envelope count instead of a page of rows.
 *   TOK-10  the shared pagination fragment replaced the copied OpenAPI prose.
 *   INT-53  expected API failures come back as isError tool results.
 *   TOK-20  this server declares no writes; the catalogue is asserted read-only
 *           so that adding a write here without gating it fails a test.
 *
 * Also pins the one place where the two folder routes genuinely disagree:
 * bConnect spells the sub-folder flag `includeSubfolders` on the UDG-by-folder
 * route and `includeSubFolders` on the folders-by-folder route. Normalising
 * either would silently drop the filter (bConnect answers 200 and ignores an
 * unknown parameter — finding D6), so the schemas mirror the API exactly.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  BConnectApiError,
  PAGE_DESCRIPTION,
  VERBOSE_PAGE_DESCRIPTION,
  WRITE_TOOL_VERB_PREFIXES,
} from '@bconnect/mcp-core';

import { createServer } from '../index.js';
import { UniversalDynamicGroupsModule } from '../modules/universaldynamicgroups.js';

const LIST_TOOLS = [
  'list_universal_dynamic_groups',
  'list_universal_dynamic_groups_by_folder',
  'list_udg_folders',
  'list_udg_folders_by_folder',
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
  });

  it('no advertised tool carries a write verb', async () => {
    const names = (await (await connect()).listTools()).tools.map((t) => t.name);
    const writeShaped = names.filter((n) => WRITE_TOOL_VERB_PREFIXES.some((p) => n.startsWith(p)));
    expect(writeShaped).toEqual([]);
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

  it('the two folder routes keep bConnect\'s own inconsistent casing', async () => {
    const { tools } = await (await connect()).listTools();
    const byFolder = tools.find((t) => t.name === 'list_universal_dynamic_groups_by_folder')!;
    const folders = tools.find((t) => t.name === 'list_udg_folders_by_folder')!;
    expect((byFolder.inputSchema as { properties: object }).properties).toHaveProperty('includeSubfolders');
    expect((folders.inputSchema as { properties: object }).properties).toHaveProperty('includeSubFolders');
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
      .spyOn(UniversalDynamicGroupsModule.prototype, 'getUniversalDynamicGroups')
      .mockResolvedValue({ page: 100000, pageSize: 1, totalItems: 11, totalPages: 11, data: [] } as never);

    const client = await connect();
    const result = await client.callTool({
      name: 'list_universal_dynamic_groups',
      arguments: { countOnly: true, Name: 'Win11 Rollout' },
    });

    expect(spy).toHaveBeenCalledWith({ Name: 'Win11 Rollout', Page: 100000, PageSize: 1 });
    expect(JSON.parse(textOf(result))).toEqual({
      totalItems: 11,
      filters: { Name: 'Win11 Rollout' },
    });
  });

  it('the folder-scoped count keeps the path id out of the query', async () => {
    const spy = vi
      .spyOn(UniversalDynamicGroupsModule.prototype, 'getFoldersByFolder')
      .mockResolvedValue({ page: 100000, pageSize: 1, totalItems: 2, totalPages: 2, data: [] } as never);

    const client = await connect();
    await client.callTool({
      name: 'list_udg_folders_by_folder',
      arguments: { folderId: GUID, countOnly: true },
    });

    expect(spy).toHaveBeenCalledWith(GUID, { Page: 100000, PageSize: 1 });
  });
});

describe('INT-53 — one error channel', () => {
  it('404 comes back as a readable isError result', async () => {
    vi.spyOn(UniversalDynamicGroupsModule.prototype, 'getUniversalDynamicGroup').mockRejectedValue(
      new BConnectApiError(404, 'Resource not found. GET /universaldynamicgroups/v2.0/…')
    );
    const client = await connect();
    const result = await client.callTool({ name: 'get_universal_dynamic_group', arguments: { id: GUID } });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toContain('Resource not found.');
  });

  it('500 stays a protocol InternalError', async () => {
    vi.spyOn(UniversalDynamicGroupsModule.prototype, 'getUniversalDynamicGroup').mockRejectedValue(
      new BConnectApiError(500, 'bConnect API returned an internal server error.')
    );
    const client = await connect();
    await expect(
      client.callTool({ name: 'get_universal_dynamic_group', arguments: { id: GUID } })
    ).rejects.toThrow(/Tool execution failed: bConnect API returned an internal server error\./);
  });
});
