/**
 * Endpoint and group list tools offer every filter their route declares (#179).
 *
 * The filters come from the generated tables, per bMS release, and reach
 * bConnect exactly as given. Endpoint lists take the type as an argument
 * (REQ-SRV-029): list_endpoints offers every type's filters and sends the
 * chosen type's; search_endpoints is gone (list_endpoints with SearchQuery).
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

const clients: Record<string, Client> = {};
const saved = { ...process.env };
beforeAll(async () => {
  Object.assign(process.env, {
    BCONNECT_BASE_URL: 'https://bms.filters.test/bconnect', BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p',
    BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', BCONNECT_RELEASE: '26R1', ALLOW_WRITE_OPERATIONS: '', ALLOW_SECRET_READ: '',
  });
  msw.listen({ onUnhandledRequest: 'error' });
  for (const server of ['endpoints', 'groups']) {
    const { createServer } = await import(`../bconnect-${server}-mcp/src/index.ts`);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const c = new Client({ name: 'endpoint-group-filters', version: '0' });
    await Promise.all([createServer().server.connect(a), c.connect(b)]);
    clients[server] = c;
  }
});
afterEach(() => { sent = []; process.env.BCONNECT_RELEASE = '26R1'; });
afterAll(async () => { await Promise.all(Object.values(clients).map((c) => c.close())); msw.close(); process.env = saved; });

const propsOf = async (server: string, name: string) =>
  Object.keys((await clients[server].listTools()).tools.find((t) => t.name === name)!.inputSchema.properties ?? {});
async function call(server: string, name: string, args: Record<string, unknown>) {
  const r = await clients[server].callTool({ name, arguments: args });
  expect(r.isError, JSON.stringify(r.content)).not.toBe(true);
  return sent;
}

describe('endpoints', () => {
  it('list_endpoints offers and, with type WindowsEndpoint, sends HostName, Domain and the 26R1 EntraIdDeviceId', async () => {
    expect(await propsOf('endpoints', 'list_endpoints')).toEqual(expect.arrayContaining(['type', 'HostName', 'Domain', 'DisplayName', 'EntraIdDeviceId', 'OrderBy', 'Page']));
    expect(await call('endpoints', 'list_endpoints', { type: 'WindowsEndpoint', HostName: 'pc01', Domain: 'corp', EntraIdDeviceId: G }))
      .toEqual([{ path: '/endpoints/v2.0/WindowsEndpoints', query: { HostName: 'pc01', Domain: 'corp', EntraIdDeviceId: G } }]);
  });

  it('does not offer the 26R1-only EntraIdDeviceId on 25R2', async () => {
    process.env.BCONNECT_RELEASE = '25R2';
    const props = await propsOf('endpoints', 'list_endpoints');
    expect(props).toContain('HostName');
    expect(props).not.toContain('EntraIdDeviceId');
  });

  it('list_endpoints searches with SearchQuery (search_endpoints\' query) and sends no type-specific filter without a type', async () => {
    const props = await propsOf('endpoints', 'list_endpoints');
    expect(props).toEqual(expect.arrayContaining(['SearchQuery', 'PageSize', 'HostName', 'DisplayName', 'OrderBy', 'Page']));
    expect(props).not.toContain('query');
    expect(props).not.toContain('pageSize');
    expect(await call('endpoints', 'list_endpoints', { SearchQuery: 'x', PageSize: 50, HostName: 'pc01' }))
      .toEqual([{ path: '/endpoints/v2.0/Endpoints', query: { SearchQuery: 'x', PageSize: '50', HostName: 'pc01' } }]);
  });
});

describe('groups', () => {
  it('list_windows_endpoints_by_static_group offers and sends HostName and Domain', async () => {
    expect(await propsOf('groups', 'list_windows_endpoints_by_static_group')).toEqual(expect.arrayContaining(['HostName', 'Domain', 'DisplayName']));
    expect(await call('groups', 'list_windows_endpoints_by_static_group', { staticGroupId: G, HostName: 'pc01' }))
      .toEqual([{ path: `/endpoints/v2.0/StaticGroups/${G}/WindowsEndpoints`, query: { HostName: 'pc01' } }]);
  });

  it('list_logical_groups_by_logical_group offers Name, Dip and Domain', async () => {
    expect(await propsOf('groups', 'list_logical_groups_by_logical_group')).toEqual(expect.arrayContaining(['Name', 'Dip', 'Domain', 'includeSubfolders']));
    expect(await call('groups', 'list_logical_groups_by_logical_group', { logicalGroupId: G, Name: 'Berlin' }))
      .toEqual([{ path: `/endpoints/v2.0/LogicalGroups/${G}/LogicalGroups`, query: { Name: 'Berlin' } }]);
  });
});
