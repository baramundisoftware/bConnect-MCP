/**
 * The remaining servers' list tools offer every filter their route declares (#179).
 *
 * One representative tool per server: the filter is offered in tools/list and
 * reaches bConnect exactly as given, next to the path ID.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const G = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let sent: Array<{ path: string; query: Record<string, string> }> = [];
const msw = setupServer(http.get('*', ({ request }) => {
  const url = new URL(request.url);
  sent.push({ path: url.pathname.replace(/^\/bconnect/, ''), query: Object.fromEntries(url.searchParams) });
  return HttpResponse.json({ data: [] });
}));

const SERVERS = ['activedirectory', 'servermanagement', 'software', 'variables', 'universaldynamicgroups', 'operatingsystems', 'compliance', 'defensecontrol', 'updatemanagement'];
const clients: Record<string, Client> = {};
const saved = { ...process.env };
beforeAll(async () => {
  Object.assign(process.env, {
    BCONNECT_BASE_URL: 'https://bms.filters.test/bconnect', BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p',
    BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', BCONNECT_RELEASE: '26R1', ALLOW_WRITE_OPERATIONS: '', ALLOW_SECRET_READ: '',
  });
  msw.listen({ onUnhandledRequest: 'error' });
  for (const server of SERVERS) {
    const { createServer } = await import(`../bconnect-${server}-mcp/src/index.ts`);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const c = new Client({ name: 'more-list-filters', version: '0' });
    await Promise.all([createServer().server.connect(a), c.connect(b)]);
    clients[server] = c;
  }
});
afterEach(() => { sent = []; });
afterAll(async () => { await Promise.all(Object.values(clients).map((c) => c.close())); msw.close(); process.env = saved; });

describe.each([
  ['activedirectory', 'list_ad_objects_by_group', { adGroupId: G }, { includeIndirect: true }, { includeIndirect: 'true' }, /\/ADGroups\/[^/]+\/ADObjects$/],
  ['activedirectory', 'list_org_units_by_org_unit', { orgUnitId: G }, { Name: 'Sales', includeSubOrgUnits: true }, { Name: 'Sales', includeSubOrgUnits: 'true' }, /\/OrgUnits\/[^/]+\/OrgUnits$/],
  ['servermanagement', 'list_download_jobs', {}, { StateValue: 'Error', LastExecution: 'gt 2026-09-30T00:00:00Z' }, { StateValue: 'Error', LastExecution: 'gt 2026-09-30T00:00:00Z' }, /\/DownloadJobs$/],
  ['software', 'list_installed_software_by_logical_group', { logicalGroupId: G }, { Category: 'Office' }, { Category: 'Office' }, /\/InstalledWindowsSoftware$/],
  ['variables', 'list_variable_instances', {}, { Scope: 'Endpoint', Name: 'Site' }, { Scope: 'Endpoint', Name: 'Site' }, /\/VariableInstances$/],
  ['universaldynamicgroups', 'list_universal_dynamic_groups_by_folder', { folderId: G }, { includeSubfolders: true, Name: 'x' }, { includeSubfolders: 'true', Name: 'x' }, /\/UniversalDynamicGroups$/],
  ['operatingsystems', 'list_os_folders_by_folder', { folderId: G }, { Name: 'Win11' }, { Name: 'Win11' }, /\/Folders$/],
])('%s %s', (server, name, path, filter, query, route) => {
  it('offers the filter', async () => {
    const t = (await clients[server].listTools()).tools.find((x) => x.name === name)!;
    expect(Object.keys(t.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(Object.keys(filter)));
  });

  it('sends it as given, and only it', async () => {
    const r = await clients[server].callTool({ name, arguments: { ...path, ...filter } });
    expect(r.isError, JSON.stringify(r.content)).not.toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].path).toMatch(route);
    expect(sent[0].query).toEqual(query);
  });
});
