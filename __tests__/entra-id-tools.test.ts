/**
 * Entra ID tools call the routes and send the fields the 26R1 spec declares (#173).
 *
 * Reading is keyed by the Entra ID device id (GET /EntraIdData/{deviceId}),
 * linking sends entraIdDeviceId, entraIdTenantId and entraIdUserId, and every
 * description says the API marks these operations as temporary and meant for
 * mobile devices.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const ENDPOINT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DEVICE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TENANT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const USER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

let sent: Array<{ method: string; path: string; body: string }> = [];
const msw = setupServer(http.all('*', async ({ request }) => {
  sent.push({ method: request.method, path: new URL(request.url).pathname.replace(/^\/bconnect/, ''), body: await request.text() });
  return HttpResponse.json({ entraIdDeviceId: DEVICE });
}));

let client: Client;
const saved = { ...process.env };
beforeAll(async () => {
  Object.assign(process.env, {
    BCONNECT_BASE_URL: 'https://bms.entra.test/bconnect', BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p',
    BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', BCONNECT_RELEASE: '26R1', ALLOW_WRITE_OPERATIONS: 'true',
  });
  msw.listen({ onUnhandledRequest: 'error' });
  const { createServer } = await import('../bconnect-endpoints-mcp/src/index.ts');
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'entra-id-tools', version: '0' });
  await Promise.all([createServer().server.connect(a), client.connect(b)]);
});
afterEach(() => { sent = []; });
afterAll(async () => { await client.close(); msw.close(); process.env = saved; });

const call = async (name: string, args: Record<string, unknown>) => {
  const r = await client.callTool({ name, arguments: args });
  return { isError: r.isError === true, text: (r.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n') };
};
const tool = async (name: string) => (await client.listTools()).tools.find((t) => t.name === name)!;

describe('get_entra_id_data', () => {
  it('reads by Entra ID device id from GET /EntraIdData/{deviceId}', async () => {
    const r = await call('get_entra_id_data', { entraIdDeviceId: DEVICE });
    expect(r.isError).toBe(false);
    expect(sent.map((s) => [s.method, s.path])).toEqual([['GET', `/endpoints/v2.0/EntraIdData/${DEVICE}`]]);
  });

  it('asks for the Entra ID device id, not a bMS endpoint id', async () => {
    const t = await tool('get_entra_id_data');
    expect(t.inputSchema.required).toEqual(['entraIdDeviceId']);
    expect(Object.keys(t.inputSchema.properties ?? {})).not.toContain('endpointId');
  });
});

describe('link_entra_id_data', () => {
  it('sends the three Entra ID fields the API declares', async () => {
    const r = await call('link_entra_id_data', { endpointId: ENDPOINT, entraIdDeviceId: DEVICE, entraIdTenantId: TENANT, entraIdUserId: USER });
    expect(r.isError).toBe(false);
    expect(sent.map((s) => ({ method: s.method, path: s.path, body: JSON.parse(s.body) }))).toEqual([{
      method: 'POST', path: `/endpoints/v2.0/Endpoints/${ENDPOINT}/EntraIdData`,
      body: { entraIdDeviceId: DEVICE, entraIdTenantId: TENANT, entraIdUserId: USER },
    }]);
  });

  it('no longer offers deviceId', async () => {
    expect(Object.keys((await tool('link_entra_id_data')).inputSchema.properties ?? {})).not.toContain('deviceId');
  });

  it('refuses ids that are not GUIDs, before any request', async () => {
    const r = await call('link_entra_id_data', { endpointId: ENDPOINT, entraIdDeviceId: 'x', entraIdTenantId: TENANT, entraIdUserId: USER })
      .catch((e: Error) => ({ isError: true, text: e.message }));
    expect(r.isError).toBe(true);
    expect(sent).toEqual([]);
  });
});

describe.each(['get_entra_id_data', 'link_entra_id_data', 'unlink_entra_id_data'])('%s description', (name) => {
  it('says the API marks it as temporary and meant for mobile devices', async () => {
    const d = (await tool(name)).description ?? '';
    expect(d).toMatch(/temporary/i);
    expect(d).toMatch(/mobile/i);
  });
});
