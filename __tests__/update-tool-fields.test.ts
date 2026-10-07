/**
 * Endpoint update tools take named fields and send a JSON Patch (#171).
 *
 * Each tool offers the fields its route's spec example names, as typed
 * arguments, and builds `[{op: "replace", path, value}]` with exactly the path
 * spelling of that example (PascalCase for Mac, lower case for the maintenance
 * window type). A call that changes nothing is refused before any request.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const ID = '77777777-7777-4777-8777-777777777777';
const GROUP = '88888888-8888-4888-8888-888888888888';

let sent: Array<{ method: string; path: string; body: unknown }> = [];
const msw = setupServer(http.all('*', async ({ request }) => {
  const text = await request.text();
  sent.push({ method: request.method, path: new URL(request.url).pathname.replace(/^\/bconnect/, ''), body: text ? JSON.parse(text) : undefined });
  return HttpResponse.json({ id: ID });
}));

let client: Client;
const saved = { ...process.env };
beforeAll(async () => {
  Object.assign(process.env, {
    BCONNECT_BASE_URL: 'https://bms.update.test/bconnect', BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p',
    BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', BCONNECT_RELEASE: '26R1', ALLOW_WRITE_OPERATIONS: 'true',
  });
  msw.listen({ onUnhandledRequest: 'error' });
  const { createServer } = await import('../bconnect-endpoints-mcp/src/index.ts');
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'update-tool-fields', version: '0' });
  await Promise.all([createServer().server.connect(a), client.connect(b)]);
});
afterEach(() => { sent = []; });
afterAll(async () => { await client.close(); msw.close(); process.env = saved; });

async function call(name: string, args: Record<string, unknown>) {
  try {
    const r = await client.callTool({ name, arguments: args });
    return { isError: r.isError === true, text: (r.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n') };
  } catch (e) {
    return { isError: true, text: String((e as Error).message) };
  }
}
const tool = async (name: string) => (await client.listTools()).tools.find((t) => t.name === name)!;
const replace = (path: string, value: unknown) => ({ op: 'replace', path, value });

describe.each([
  ['update_windows_endpoint', `/endpoints/v2.0/WindowsEndpoints/${ID}`,
    { displayName: 'PC-01', logicalGroupId: GROUP, isDeactivated: true, registeredUserUpdateMode: 'EnterManually' },
    [replace('/displayName', 'PC-01'), replace('/logicalGroupId', GROUP), replace('/registeredUserUpdateMode', 'EnterManually'), replace('/isDeactivated', true)]],
  ['update_linux_endpoint', `/endpoints/v2.0/LinuxEndpoints/${ID}`,
    { hostName: 'srv-01', managementMode: 'SSH' },
    [replace('/hostName', 'srv-01'), replace('/managementMode', 'SSH')]],
  ['update_mac_endpoint', `/endpoints/v2.0/MacEndpoints/${ID}`,
    { displayName: 'Mac-01', owner: 'Company' },
    [replace('/DisplayName', 'Mac-01'), replace('/Owner', 'Company')]],
  ['update_logical_group', `/endpoints/v2.0/LogicalGroups/${ID}`,
    { name: 'Berlin', parentId: GROUP },
    [replace('/name', 'Berlin'), replace('/parentId', GROUP)]],
  ['update_network_endpoint', `/endpoints/v2.0/NetworkEndpoints/${ID}`,
    { primaryIP: '10.0.0.5', webInterfaceUrl: 'https://switch-01' },
    [replace('/primaryIP', '10.0.0.5'), replace('/webInterfaceUrl', 'https://switch-01')]],
  ['update_maintenance_window_for_endpoint', `/endpoints/v2.0/Endpoints/${ID}/MaintenanceWindow`,
    { maintenanceWindowDefinitionType: 'Everyday', intervals: [{ maintenancePeriod: 'Everyday', start: { hour: 22, minute: 0 }, end: { hour: 6, minute: 0 } }] },
    [replace('/maintenancewindowdefinitiontype', 'Everyday'), replace('/intervals', [{ maintenancePeriod: 'Everyday', start: { hour: 22, minute: 0 }, end: { hour: 6, minute: 0 } }])]],
  ['update_maintenance_window_for_logical_group', `/endpoints/v2.0/LogicalGroups/${ID}/MaintenanceWindow`,
    { maintenanceWindowDefinitionType: 'Never' },
    // An interval-free type removes the old intervals (#237).
    [replace('/maintenancewindowdefinitiontype', 'Never'), { op: 'remove', path: '/intervals' }]],
])('%s', (name, path, args, expectedPatch) => {
  it('sends a JSON Patch built from the given fields, with the spec path spelling', async () => {
    const r = await call(name, { id: ID, ...args });
    expect(r.isError).toBe(false);
    expect(sent).toEqual([{ method: 'PATCH', path, body: expectedPatch }]);
  });

  it('refuses a call that changes nothing, before any request', async () => {
    const r = await call(name, { id: ID });
    expect(r.isError).toBe(true);
    expect(sent).toEqual([]);
  });

  it('declares named fields and "id plus at least one field"', async () => {
    const t = await tool(name);
    const props = Object.keys(t.inputSchema.properties ?? {});
    expect(props).toContain('id');
    expect(props.length).toBeGreaterThan(1);
    expect(props).not.toContain('updateData');
    expect(props).not.toContain('maintenanceWindowData');
    expect((t.inputSchema as { minProperties?: number }).minProperties).toBe(2);
  });
});

describe('update_industrial_endpoint (25R2 route)', () => {
  it('declares named fields instead of an untyped updateData object', async () => {
    // Only 25R2 has the route, so only 25R2 lists the tool (#159); the list follows the release per request.
    const before = process.env.BCONNECT_RELEASE;
    process.env.BCONNECT_RELEASE = '25R2';
    const t = await tool('update_industrial_endpoint').finally(() => {
      if (before === undefined) {delete process.env.BCONNECT_RELEASE;} else {process.env.BCONNECT_RELEASE = before;}
    });
    expect(Object.keys(t.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(['id', 'displayName', 'port']));
    expect(Object.keys(t.inputSchema.properties ?? {})).not.toContain('updateData');
  });
});

describe('typed values', () => {
  it('refuses a logicalGroupId that is not a GUID', async () => {
    const r = await call('update_windows_endpoint', { id: ID, logicalGroupId: 'not-a-guid' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/logicalGroupId/);
    expect(sent).toEqual([]);
  });

  it('offers the enums the spec declares', async () => {
    const t = await tool('update_windows_endpoint');
    const p = t.inputSchema.properties as Record<string, { enum?: string[]; type?: string }>;
    expect(p.registeredUserUpdateMode.enum).toEqual(['UseNextLogonUser', 'DoNotUseRegisteredUser', 'UpdateContinously', 'EnterManually']);
    expect(p.isDeactivated.type).toBe('boolean');
  });
});
