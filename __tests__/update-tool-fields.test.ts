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

/** update_endpoint takes the endpoint type (REQ-SRV-029): "update_endpoint WindowsEndpoint" calls it with that type. */
const nameOf = (name: string) => name.split(' ')[0];
const selectOf = (name: string): Record<string, string> => (name.includes(' ') ? { type: name.split(' ')[1] } : {});

describe.each([
  ['update_endpoint WindowsEndpoint', `/endpoints/v2.0/WindowsEndpoints/${ID}`,
    { displayName: 'PC-01', logicalGroupId: GROUP, isDeactivated: true, registeredUserUpdateMode: 'EnterManually' },
    [replace('/displayName', 'PC-01'), replace('/logicalGroupId', GROUP), replace('/registeredUserUpdateMode', 'EnterManually'), replace('/isDeactivated', true)]],
  ['update_endpoint LinuxEndpoint', `/endpoints/v2.0/LinuxEndpoints/${ID}`,
    { hostName: 'srv-01', managementMode: 'SSH' },
    [replace('/hostName', 'srv-01'), replace('/managementMode', 'SSH')]],
  ['update_endpoint MacEndpoint', `/endpoints/v2.0/MacEndpoints/${ID}`,
    { displayName: 'Mac-01', owner: 'Company' },
    [replace('/DisplayName', 'Mac-01'), replace('/Owner', 'Company')]],
  ['update_logical_group', `/endpoints/v2.0/LogicalGroups/${ID}`,
    { name: 'Berlin', parentId: GROUP },
    [replace('/name', 'Berlin'), replace('/parentId', GROUP)]],
  ['update_endpoint NetworkEndpoint', `/endpoints/v2.0/NetworkEndpoints/${ID}`,
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
    const r = await call(nameOf(name), { ...selectOf(name), id: ID, ...args });
    expect(r.isError).toBe(false);
    expect(sent).toEqual([{ method: 'PATCH', path, body: expectedPatch }]);
  });

  it('refuses a call that changes nothing, before any request', async () => {
    const r = await call(nameOf(name), { ...selectOf(name), id: ID });
    expect(r.isError).toBe(true);
    expect(sent).toEqual([]);
  });

  it('declares named fields and "id plus at least one field" (plus the type, where it takes one)', async () => {
    const t = await tool(nameOf(name));
    const props = Object.keys(t.inputSchema.properties ?? {});
    expect(props).toContain('id');
    expect(props.length).toBeGreaterThan(1);
    expect(props).not.toContain('updateData');
    expect(props).not.toContain('maintenanceWindowData');
    expect((t.inputSchema as { minProperties?: number }).minProperties).toBe(name.includes(' ') ? 3 : 2);
  });
});

describe('update_endpoint with type IndustrialEndpoint (25R2 route)', () => {
  it('declares named fields instead of an untyped updateData object', async () => {
    // Only 25R2 has the route, so only 25R2 lists the tool (#159); the list follows the release per request.
    const before = process.env.BCONNECT_RELEASE;
    process.env.BCONNECT_RELEASE = '25R2';
    const t = await tool('update_endpoint').finally(() => {
      if (before === undefined) {delete process.env.BCONNECT_RELEASE;} else {process.env.BCONNECT_RELEASE = before;}
    });
    expect(Object.keys(t.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(['id', 'displayName', 'port']));
    expect((t.inputSchema.properties as Record<string, { description?: string }>).port.description).toMatch(/Only for type "IndustrialEndpoint"\.$/);
    expect(Object.keys(t.inputSchema.properties ?? {})).not.toContain('updateData');
  });
});

describe('typed values', () => {
  it('refuses a logicalGroupId that is not a GUID', async () => {
    const r = await call('update_endpoint', { type: 'WindowsEndpoint', id: ID, logicalGroupId: 'not-a-guid' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/logicalGroupId/);
    expect(sent).toEqual([]);
  });

  it('offers the enums the spec declares', async () => {
    const t = await tool('update_endpoint');
    const p = t.inputSchema.properties as Record<string, { enum?: string[]; type?: string }>;
    expect(p.registeredUserUpdateMode.enum).toEqual(['UseNextLogonUser', 'DoNotUseRegisteredUser', 'UpdateContinously', 'EnterManually']);
    expect(p.isDeactivated.type).toBe('boolean');
  });
});

describe('nested and per-release fields (#328)', () => {
  const at = (type: string) => `/endpoints/v2.0/${type}s/${ID}`;
  const withRelease = async (release: string, run: () => Promise<void>) => {
    process.env.BCONNECT_RELEASE = release;
    try { await run(); } finally { process.env.BCONNECT_RELEASE = '26R1'; }
  };

  it('Windows: the agent connection and the custom state as nested paths, with their types', async () => {
    const r = await call('update_endpoint', { type: 'WindowsEndpoint', id: ID, clientAgentExtendedInternetMode: true, clientAgentNetworkMode: 'Dynamic', customStateType: 2, customStateText: 'Rack 4' });
    expect(r.isError, r.text).toBe(false);
    expect(sent).toEqual([{ method: 'PATCH', path: at('WindowsEndpoint'), body: [
      replace('/clientAgentLink/ExtendedInternetMode', true), replace('/clientAgentLink/NetworkMode', 'Dynamic'),
      replace('/customState/Type', 2), replace('/customState/Text', 'Rack 4'),
    ] }]);
  });

  it.each(['LinuxEndpoint', 'NetworkEndpoint'])('%s: sshPort is /sshConfiguration/Port, an integer', async (type) => {
    expect((await call('update_endpoint', { type, id: ID, sshPort: 2222 })).isError).toBe(false);
    expect(sent).toEqual([{ method: 'PATCH', path: at(type), body: [replace('/sshConfiguration/Port', 2222)] }]);
  });

  it('Network on 26R1/26R2: snmpConfiguration replaced as a whole object; no snmpCommunity', async () => {
    const snmp = { version: 'V3', username: 'mon', authentication: 'SHA256', authenticationPassword: 'a', encryption: 'AES', encryptionPassword: 'e' };
    for (const release of ['26R1', '26R2']) {
      await withRelease(release, async () => {
        sent = [];
        expect((await call('update_endpoint', { type: 'NetworkEndpoint', id: ID, snmpConfiguration: snmp })).isError).toBe(false);
        expect(sent).toEqual([{ method: 'PATCH', path: at('NetworkEndpoint'), body: [replace('/snmpConfiguration', snmp)] }]);
        expect((await call('update_endpoint', { type: 'NetworkEndpoint', id: ID, snmpCommunity: 'public' })).text).toMatch(/snmpCommunity/);
      });
    }
  });

  it('Network on 25R2: only the community, as /snmpConfiguration/community', async () => {
    await withRelease('25R2', async () => {
      expect((await call('update_endpoint', { type: 'NetworkEndpoint', id: ID, snmpCommunity: 'public' })).isError).toBe(false);
      expect(sent).toEqual([{ method: 'PATCH', path: at('NetworkEndpoint'), body: [replace('/snmpConfiguration/community', 'public')] }]);
      sent = [];
      expect((await call('update_endpoint', { type: 'NetworkEndpoint', id: ID, snmpConfiguration: { version: 'V1' } })).text).toMatch(/snmpConfiguration/);
      expect(sent).toEqual([]);
    });
  });

  it('Industrial (25R2): the SNMP fields as /snmpConfiguration/<Field>', async () => {
    await withRelease('25R2', async () => {
      expect((await call('update_endpoint', { type: 'IndustrialEndpoint', id: ID, snmpVersion: 'V2c', snmpCommunity: 'plant' })).isError).toBe(false);
      expect(sent).toEqual([{ method: 'PATCH', path: at('IndustrialEndpoint'), body: [replace('/snmpConfiguration/Version', 'V2c'), replace('/snmpConfiguration/Community', 'plant')] }]);
    });
  });

  it.each([['AndroidEndpoint', 'AndroidEndpoint'], ['IOSEndpoint', 'IosEndpoint']])('%s: the PATCH example fields in PascalCase; serialNumber refused', async (type, route) => {
    expect((await call('update_endpoint', { type, id: ID, displayName: 'Phone', category: 'Field', owner: 'Company', registeredUser: 'DOMAIN\\anna' })).isError).toBe(false);
    expect(sent).toEqual([{ method: 'PATCH', path: `/endpoints/v2.0/${route}s/${ID}`, body: [
      replace('/DisplayName', 'Phone'), replace('/Category', 'Field'), replace('/Owner', 'Company'), replace('/RegisteredUser', 'DOMAIN\\anna'),
    ] }]);
    sent = [];
    expect((await call('update_endpoint', { type, id: ID, serialNumber: 'X1' })).isError).toBe(true);
    expect(sent).toEqual([]);
  });

  it('the listing offers snmpConfiguration with its properties on 26R1, snmpCommunity on 25R2', async () => {
    const props = (await tool('update_endpoint')).inputSchema.properties as Record<string, { properties?: object; description?: string }>;
    expect(Object.keys(props.snmpConfiguration?.properties ?? {})).toEqual(expect.arrayContaining(['version', 'community', 'authenticationPassword']));
    expect(props.snmpCommunity).toBeUndefined();
    await withRelease('25R2', async () => {
      const p25 = (await tool('update_endpoint')).inputSchema.properties as Record<string, unknown>;
      expect(p25.snmpCommunity).toBeDefined();
      expect(p25.snmpConfiguration).toBeUndefined();
    });
  });
});
