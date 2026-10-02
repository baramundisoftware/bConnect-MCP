/**
 * List tools send only the query parameters their route declares (#186), and
 * logical-group tools can reach sub-groups and page (#170).
 *
 * - The path id stays in the path; it isn't sent again as a query parameter.
 * - Each server's QUERY_PARAMS table (src/query-params.ts) equals the query
 *   parameters the bundled specs declare for the tool's operation (both
 *   releases), so the table can't silently drop a declared parameter.
 * - Logical-group member tools offer and send `includeSubfolders`.
 * - `list_logical_groups` offers paging and the declared filters.
 * - `list_unmanaged_endpoints` offers no paging: its route declares none.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { RELEASES, loadOperations } from './lib/spec.js';
import { ROOT } from './lib/exerciser.js';

const G = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SERVERS = ['activedirectory', 'assets', 'defensecontrol', 'endpoints', 'groups', 'jobs', 'software'];

let sent: Array<{ path: string; query: Record<string, string> }> = [];
const msw = setupServer(http.get('*', ({ request }) => {
  const url = new URL(request.url);
  sent.push({ path: url.pathname.replace(/^\/bconnect/, ''), query: Object.fromEntries(url.searchParams) });
  return HttpResponse.json({ data: [] });
}));

const clients: Record<string, Client> = {};
const saved = { ...process.env };
beforeAll(async () => {
  Object.assign(process.env, {
    BCONNECT_BASE_URL: 'https://bms.query.test/bconnect', BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p',
    BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', BCONNECT_RELEASE: '26R1', ALLOW_WRITE_OPERATIONS: '', ALLOW_SECRET_READ: '',
  });
  msw.listen({ onUnhandledRequest: 'error' });
  for (const server of SERVERS) {
    const { createServer } = await import(`../bconnect-${server}-mcp/src/index.ts`);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const c = new Client({ name: 'query-parameters', version: '0' });
    await Promise.all([createServer().server.connect(a), c.connect(b)]);
    clients[server] = c;
  }
});
afterEach(() => { sent = []; });
afterAll(async () => { await Promise.all(Object.values(clients).map((c) => c.close())); msw.close(); process.env = saved; });

async function call(server: string, name: string, args: Record<string, unknown>) {
  const r = await clients[server].callTool({ name, arguments: args });
  expect(r.isError, JSON.stringify(r.content)).not.toBe(true);
  return sent;
}
const propsOf = async (server: string, name: string) =>
  Object.keys((await clients[server].listTools()).tools.find((t) => t.name === name)!.inputSchema.properties ?? {});

describe('#186 the path id and undeclared arguments stay out of the query', () => {
  it.each([
    ['activedirectory', 'list_ad_objects_by_group', { adGroupId: G, Page: 1, includeIndirect: true }, `/activedirectory/v2.0/ADGroups/${G}/ADObjects`, { Page: '1', includeIndirect: 'true' }],
    ['activedirectory', 'list_org_units_by_org_unit', { orgUnitId: G, Name: 'Sales' }, `/activedirectory/v2.0/OrgUnits/${G}/OrgUnits`, { Name: 'Sales' }],
    ['assets', 'list_assets_by_logical_group', { logicalGroupId: G, PageSize: 50 }, `/assets/v2.0/LogicalGroups/${G}/Assets`, { PageSize: '50' }],
    ['assets', 'list_asset_type_subfolders', { folderId: G }, `/assets/v2.0/AssetTypes/Folders/${G}/Folders`, {}],
    ['jobs', 'list_job_instances_by_static_group', { staticGroupId: G, LastAction: 'Started' }, `/jobs/v2.0/StaticGroups/${G}/JobInstances`, { LastAction: 'Started' }],
    ['jobs', 'list_kiosk_releases_by_endpoint', { endpointId: G, Page: 0 }, `/jobs/v2.0/Endpoints/${G}/KioskReleases`, { Page: '0' }],
    ['endpoints', 'list_endpoints_by_logical_group', { logicalGroupId: G, HostName: 'pc01' }, `/endpoints/v2.0/LogicalGroups/${G}/Endpoints`, { HostName: 'pc01' }],
  ])('%s %s', async (server, name, args, path, query) => {
    expect(await call(server, name, args)).toEqual([{ path, query }]);
  });

  it('list_unmanaged_endpoints sends no query and offers no paging', async () => {
    expect(await call('endpoints', 'list_unmanaged_endpoints', {})).toEqual([{ path: '/endpoints/v2.0/UnmanagedEndpoints', query: {} }]);
    expect(await propsOf('endpoints', 'list_unmanaged_endpoints')).toEqual([]);
  });
});

describe('#170 logical-group tools reach sub-groups', () => {
  it.each([
    ['endpoints', 'list_endpoints_by_logical_group', `/endpoints/v2.0/LogicalGroups/${G}/Endpoints`],
    ['endpoints', 'list_group_endpoints', `/endpoints/v2.0/LogicalGroups/${G}/Endpoints`],
    ['endpoints', 'list_windows_endpoints_by_logical_group', `/endpoints/v2.0/LogicalGroups/${G}/WindowsEndpoints`],
    ['groups', 'list_endpoints_by_logical_group', `/endpoints/v2.0/LogicalGroups/${G}/Endpoints`],
    ['groups', 'list_windows_endpoints_by_logical_group', `/endpoints/v2.0/LogicalGroups/${G}/WindowsEndpoints`],
    ['groups', 'list_logical_groups_by_logical_group', `/endpoints/v2.0/LogicalGroups/${G}/LogicalGroups`],
    ['defensecontrol', 'list_defender_threats_by_logical_group', `/defensecontrol/v2.0/MicrosoftDefender/LogicalGroups/${G}/Threats`],
    ['jobs', 'list_job_instances_by_logical_group', `/jobs/v2.0/LogicalGroups/${G}/JobInstances`],
    ['software', 'list_installed_software_by_logical_group', `/software/v2.0/LogicalGroups/${G}/InstalledWindowsSoftware`],
  ])('%s %s offers and sends includeSubfolders', async (server, name, path) => {
    expect(await propsOf(server, name)).toContain('includeSubfolders');
    expect(await call(server, name, { logicalGroupId: G, includeSubfolders: true })).toEqual([{ path, query: { includeSubfolders: 'true' } }]);
  });

  it('no tool offers includeSubGroups, which bConnect ignores', async () => {
    expect(await propsOf('endpoints', 'list_windows_endpoints_by_logical_group')).not.toContain('includeSubGroups');
  });

  it('list_logical_groups pages and filters', async () => {
    expect(await propsOf('endpoints', 'list_logical_groups')).toEqual(expect.arrayContaining(['Page', 'PageSize', 'Name', 'Dip', 'Domain', 'OrderBy', 'SearchQuery']));
    expect(await call('endpoints', 'list_logical_groups', { Page: 2, PageSize: 100, Name: 'Berlin' }))
      .toEqual([{ path: '/endpoints/v2.0/LogicalGroups', query: { Page: '2', PageSize: '100', Name: 'Berlin' } }]);
  });
});

describe('QUERY_PARAMS tables follow the spec', () => {
  const declared = RELEASES.flatMap((r) => loadOperations(r));
  it.each(['activedirectory', 'assets', 'endpoints', 'groups', 'jobs'])('%s', async (server) => {
    const file = join(ROOT, `bconnect-${server}-mcp`, 'src', 'query-params.ts');
    expect(existsSync(file), `${file} missing`).toBe(true);
    const { QUERY_PARAMS } = await import(pathToFileURL(file).href);
    const { TOOL_OPERATIONS } = await import(pathToFileURL(join(ROOT, `bconnect-${server}-mcp`, 'src', 'operations.ts')).href);
    const wrong = Object.entries(QUERY_PARAMS as Record<string, readonly string[]>).filter(([tool, names]) => {
      const ids: readonly string[] = TOOL_OPERATIONS[tool] ?? [];
      const spec = new Set(declared.filter((o) => ids.includes(o.operationId)).flatMap((o) => o.queryParams));
      return ids.length === 0 || names.length !== spec.size || names.some((n) => !spec.has(n));
    }).map(([tool]) => tool);
    expect(wrong).toEqual([]);
  });
});
