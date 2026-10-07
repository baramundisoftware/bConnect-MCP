/**
 * Create and enrollment tools send the body their request schema declares (#189).
 *
 * Required fields are required arguments, enums are enums, no untyped object
 * argument is passed through, and an operation that takes no body gets none.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const ID = '99999999-9999-4999-8999-999999999999';
const G = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INTERVALS = [{ maintenancePeriod: 'Everyday', start: { hour: 22, minute: 0 }, end: { hour: 6, minute: 0 } }];

let sent: Array<{ method: string; path: string; body: string }> = [];
const msw = setupServer(http.all('*', async ({ request }) => {
  sent.push({ method: request.method, path: new URL(request.url).pathname.replace(/^\/bconnect/, ''), body: await request.text() });
  return HttpResponse.json({ id: ID });
}));

const clients: Record<string, Client> = {};
const saved = { ...process.env };
beforeAll(async () => {
  Object.assign(process.env, {
    BCONNECT_BASE_URL: 'https://bms.create.test/bconnect', BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p',
    BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', BCONNECT_RELEASE: '26R1', ALLOW_WRITE_OPERATIONS: 'true', ALLOW_SECRET_READ: 'true',
  });
  msw.listen({ onUnhandledRequest: 'error' });
  for (const server of ['endpoints', 'assets', 'variables', 'software', 'defensecontrol']) {
    const { createServer } = await import(`../bconnect-${server}-mcp/src/index.ts`);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const c = new Client({ name: 'create-bodies', version: '0' });
    await Promise.all([createServer().server.connect(a), c.connect(b)]);
    clients[server] = c;
  }
});
afterEach(() => { sent = []; });
afterAll(async () => { await Promise.all(Object.values(clients).map((c) => c.close())); msw.close(); process.env = saved; });

async function call(server: string, name: string, args: Record<string, unknown>) {
  try {
    const r = await clients[server].callTool({ name, arguments: args });
    return { isError: r.isError === true, text: (r.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n') };
  } catch (e) {
    return { isError: true, text: String((e as Error).message) };
  }
}
const schemaOf = async (server: string, name: string) =>
  (await clients[server].listTools()).tools.find((t) => t.name === name)!.inputSchema as { properties: Record<string, { enum?: string[] }>; required?: string[] };

describe.each([
  ['endpoints', 'create_windows_endpoint', { displayName: 'PC-01', hostName: 'pc01', logicalGroupId: G, domain: 'corp' },
    'POST', '/endpoints/v2.0/WindowsEndpoints', { displayName: 'PC-01', hostName: 'pc01', logicalGroupId: G, domain: 'corp' }, ['displayName', 'hostName']],
  ['endpoints', 'create_linux_endpoint', { displayName: 'srv', hostName: 'srv01', managementMode: 'SSH' },
    'POST', '/endpoints/v2.0/LinuxEndpoints', { displayName: 'srv', hostName: 'srv01', managementMode: 'SSH' }, ['displayName', 'hostName']],
  ['endpoints', 'create_network_endpoint', { displayName: 'Switch', primaryIP: '10.0.0.1', webInterfaceUrl: 'https://sw' },
    'POST', '/endpoints/v2.0/NetworkEndpoints', { displayName: 'Switch', primaryIP: '10.0.0.1', webInterfaceUrl: 'https://sw' }, ['displayName', 'primaryIP']],
  ['endpoints', 'create_maintenance_window_for_endpoint', { id: ID, maintenanceWindowDefinitionType: 'Everyday', intervals: INTERVALS },
    'POST', `/endpoints/v2.0/Endpoints/${ID}/MaintenanceWindow`, { maintenanceWindowDefinitionType: 'Everyday', intervals: INTERVALS }, ['id', 'maintenanceWindowDefinitionType']],
  ['endpoints', 'create_maintenance_window_for_logical_group', { id: ID, maintenanceWindowDefinitionType: 'Anytime' },
    'POST', `/endpoints/v2.0/LogicalGroups/${ID}/MaintenanceWindow`, { maintenanceWindowDefinitionType: 'Anytime' }, ['id', 'maintenanceWindowDefinitionType']],
  // start_enrollment takes the endpoint type (REQ-SRV-029); the body has only the type's fields.
  ['endpoints', 'start_enrollment', { type: 'WindowsEndpoint', id: ID, enrollmentMailAddress: 'admin@example.com', emailLanguageId: 'de', sync: true },
    'POST', `/endpoints/v2.0/WindowsEndpoints/${ID}/StartEnrollment`, { enrollmentMailAddress: 'admin@example.com', emailLanguageId: 'de', sync: true }, ['id', 'type']],
  ['endpoints', 'start_enrollment', { type: 'MacEndpoint', id: ID, enrollmentMailAddress: 'admin@example.com', enrollmentType: 'Native' },
    'POST', `/endpoints/v2.0/MacEndpoints/${ID}/StartEnrollment`, { enrollmentMailAddress: 'admin@example.com', enrollmentType: 'Native' }, ['id', 'type']],
  ['assets', 'create_asset', { assetTypeId: G, ownerId: ID, ownerType: 'Machine', name: 'Laptop 42' },
    'POST', '/assets/v2.0/Assets', { assetTypeId: G, ownerId: ID, ownerType: 'Machine', name: 'Laptop 42' }, ['assetTypeId', 'name', 'ownerId', 'ownerType']],
  ['variables', 'create_variable_definition', { name: 'Site', category: 'Inventory', scopes: ['Endpoint'], type: 'String', comment: 'Office site' },
    'POST', '/variables/v2.0/VariableDefinitions', { name: 'Site', category: 'Inventory', scopes: ['Endpoint'], type: 'String', comment: 'Office site' }, ['category', 'name', 'scopes']],
  ['software', 'create_software_bundle', { name: 'Office', folderId: G },
    'POST', '/software/v2.0/Bundles', { name: 'Office', parentId: G }, ['name']],
  ['software', 'add_application_to_bundle', { bundleId: ID, applicationId: G },
    'POST', `/software/v2.0/Bundles/${ID}/BundleApplications`, { applicationId: G }, ['applicationId', 'bundleId']],
])('%s %s', (server, name, args, method, path, body, required) => {
  it('sends exactly the fields the request schema declares', async () => {
    const r = await call(server, name, args);
    expect(r.isError).toBe(false);
    expect(sent.map((s) => ({ method: s.method, path: s.path, body: JSON.parse(s.body) }))).toEqual([{ method, path, body }]);
  });

  it('requires what the request schema requires', async () => {
    expect((await schemaOf(server, name)).required?.slice().sort()).toEqual(required.slice().sort());
  });
});

describe('enums and removed arguments', () => {
  it('declares the enums the spec defines', async () => {
    expect((await schemaOf('assets', 'create_asset')).properties.ownerType.enum).toEqual(['Undefined', 'LogicalGroup', 'Machine', 'AssetStock', 'ADObject', 'OrgUnit']);
    expect((await schemaOf('endpoints', 'start_enrollment')).properties.enrollmentType.enum).toEqual(['Unenrolled', 'SSH', 'SSHAndNative', 'Native']);
    expect((await schemaOf('variables', 'create_variable_definition')).properties.type.enum).toContain('Checkbox');
  });

  it.each([
    ['endpoints', 'create_network_endpoint', 'endpointData'],
    ['endpoints', 'create_maintenance_window_for_endpoint', 'maintenanceWindowData'],
    ['endpoints', 'start_enrollment', 'emailRecipient'],
    ['variables', 'create_variable_definition', 'dataType'],
    ['software', 'add_application_to_bundle', 'order'],
  ])('%s %s no longer offers %s', async (server, name, arg) => {
    expect(Object.keys((await schemaOf(server, name)).properties)).not.toContain(arg);
  });
});

describe('refresh_local_admin_account_expiry', () => {
  it('sends no body to an operation that takes none', async () => {
    await call('defensecontrol', 'refresh_local_admin_account_expiry', { endpointId: ID });
    expect(sent.map((s) => [s.method, s.body])).toEqual([['POST', '']]);
  });
});
