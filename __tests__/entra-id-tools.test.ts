/**
 * Entra ID tools call the routes and send the fields the 26R1 spec declares (#173).
 *
 * Reading is keyed by the Entra ID device id (GET /EntraIdData/{deviceId}) or,
 * on 26R2, by the bMS endpoint id (GET /Endpoints/{endpointId}/EntraIdData, #353),
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

/** A refused call (protocol error) as its message: what the model reads. */
const refusal = async (name: string, args: Record<string, unknown>): Promise<string> => {
  try {
    await client.callTool({ name, arguments: args });
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`${name} was not refused`);
};
const call = async (name: string, args: Record<string, unknown>) => {
  const r = await client.callTool({ name, arguments: args });
  return { isError: r.isError === true, text: (r.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n') };
};
const tool = async (name: string) => (await client.listTools()).tools.find((t) => t.name === name)!;

describe('get_entra_id_data', () => {
  it('reads by Entra ID device id from GET /EntraIdData/{deviceId}', async () => {
    const r = await call('get_entra_id_data', { deviceId: DEVICE });
    expect(r.isError).toBe(false);
    expect(sent.map((s) => [s.method, s.path])).toEqual([['GET', `/endpoints/v2.0/EntraIdData/${DEVICE}`]]);
  });

  it('asks for the Entra ID device id, not a bMS endpoint id (26R1: by endpoint ID is 26R2 only, #353)', async () => {
    const t = await tool('get_entra_id_data');
    expect(JSON.stringify(t.inputSchema.properties)).toMatch(/Entra ID device ID/);
    expect(Object.keys(t.inputSchema.properties ?? {})).toEqual(['deviceId']);
  });

  it('without deviceId it is refused, naming the route, and sends nothing', async () => {
    expect(await refusal('get_entra_id_data', {})).toContain('Valid on bMS 26R1: with deviceId without endpointId');
    expect(sent).toEqual([]);
  });

  it('by endpoint ID is refused on 26R1, naming 26R2, and sends nothing', async () => {
    expect(await refusal('get_entra_id_data', { endpointId: ENDPOINT })).toContain('get_entra_id_data without deviceId with endpointId is only available in bMS 26R2');
    expect(sent).toEqual([]);
  });

  describe('on bMS 26R2 (#353)', () => {
    beforeAll(() => { process.env.BCONNECT_RELEASE = '26R2'; });
    afterAll(() => { process.env.BCONNECT_RELEASE = '26R1'; });

    it('offers deviceId and endpointId, neither required', async () => {
      const t = await tool('get_entra_id_data');
      expect(Object.keys(t.inputSchema.properties ?? {})).toEqual(['deviceId', 'endpointId']);
      expect(t.inputSchema.required ?? []).toEqual([]);
    });

    it('reads by bMS endpoint id from GET /Endpoints/{endpointId}/EntraIdData', async () => {
      const r = await call('get_entra_id_data', { endpointId: ENDPOINT });
      expect(r.isError).toBe(false);
      expect(sent.map((s) => [s.method, s.path])).toEqual([['GET', `/endpoints/v2.0/Endpoints/${ENDPOINT}/EntraIdData`]]);
    });

    it('still reads by Entra ID device id', async () => {
      expect((await call('get_entra_id_data', { deviceId: DEVICE })).isError).toBe(false);
      expect(sent.map((s) => s.path)).toEqual([`/endpoints/v2.0/EntraIdData/${DEVICE}`]);
    });

    it('both or neither is refused, naming both routes, and sends nothing', async () => {
      const valid = 'Valid on bMS 26R2: with deviceId without endpointId; without deviceId with endpointId';
      expect(await refusal('get_entra_id_data', { deviceId: DEVICE, endpointId: ENDPOINT })).toContain(valid);
      expect(await refusal('get_entra_id_data', {})).toContain(valid);
      expect(sent).toEqual([]);
    });

    it('an endpointId that is no GUID is refused before anything is sent', async () => {
      expect(await refusal('get_entra_id_data', { endpointId: 'nope' })).toContain('endpointId must be a valid GUID');
      expect(sent).toEqual([]);
    });
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
