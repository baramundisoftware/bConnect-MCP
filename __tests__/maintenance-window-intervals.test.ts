/**
 * Maintenance windows follow bMS's interval rule (#237, REQ-XC-003 AC 7).
 *
 * A window of type Anytime or Never carries no intervals; Everyday,
 * WorkdayWeekend and IndividualWeekday need at least one. An update to an
 * interval-free type removes the existing intervals; a call that breaks the
 * rule is refused before any request.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const ID = '77777777-7777-4777-8777-777777777777';
const INTERVALS = [{ maintenancePeriod: 'Everyday', start: { hour: 22, minute: 0 }, end: { hour: 23, minute: 0 } }];

let sent: Array<{ method: string; path: string; body: unknown }> = [];
const msw = setupServer(http.all('*', async ({ request }) => {
  const text = await request.text();
  sent.push({ method: request.method, path: new URL(request.url).pathname.replace(/^\/bconnect/, ''), body: text ? JSON.parse(text) : undefined });
  return HttpResponse.json({ maintenanceWindowDefinitionType: 'Anytime' });
}));

let client: Client;
const saved = { ...process.env };
beforeAll(async () => {
  Object.assign(process.env, {
    BCONNECT_BASE_URL: 'https://bms.window.test/bconnect', BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p',
    BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', BCONNECT_RELEASE: '26R1', ALLOW_WRITE_OPERATIONS: 'true',
  });
  msw.listen({ onUnhandledRequest: 'error' });
  const { createServer } = await import('../bconnect-endpoints-mcp/src/index.ts');
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'maintenance-window-intervals', version: '0' });
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
const route = (target: string) => (target === 'endpoint' ? `/endpoints/v2.0/Endpoints/${ID}/MaintenanceWindow` : `/endpoints/v2.0/LogicalGroups/${ID}/MaintenanceWindow`);

describe.each(['endpoint', 'logical_group'])('%s', (target) => {
  const update = `update_maintenance_window_for_${target}`;
  const create = `create_maintenance_window_for_${target}`;

  it.each(['Anytime', 'Never'])('an update to %s removes the intervals', async (type) => {
    const r = await call(update, { id: ID, maintenanceWindowDefinitionType: type });
    expect(r.isError, r.text).toBe(false);
    expect(sent).toEqual([{ method: 'PATCH', path: route(target), body: [
      { op: 'replace', path: '/maintenancewindowdefinitiontype', value: type },
      { op: 'remove', path: '/intervals' },
    ] }]);
  });

  it.each(['Anytime', 'Never'])('%s with intervals is refused before any request (create and update)', async (type) => {
    for (const [name, extra] of [[create, {}], [update, {}]] as const) {
      const r = await call(name, { id: ID, maintenanceWindowDefinitionType: type, intervals: INTERVALS, ...extra });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(new RegExp(`'${type}' takes no intervals`));
    }
    expect(sent).toEqual([]);
  });

  it.each(['Everyday', 'WorkdayWeekend', 'IndividualWeekday'])('%s without intervals is refused before any request (create and type-changing update)', async (type) => {
    for (const args of [{ id: ID, maintenanceWindowDefinitionType: type }, { id: ID, maintenanceWindowDefinitionType: type, intervals: [] }]) {
      for (const name of [create, update]) {
        const r = await call(name, args);
        expect(r.isError).toBe(true);
        expect(r.text).toMatch(new RegExp(`'${type}' needs at least one interval`));
      }
    }
    expect(sent).toEqual([]);
  });

  it('an interval type with intervals goes through unchanged', async () => {
    await call(update, { id: ID, maintenanceWindowDefinitionType: 'Everyday', intervals: INTERVALS });
    await call(create, { id: ID, maintenanceWindowDefinitionType: 'Everyday', intervals: INTERVALS });
    expect(sent).toEqual([
      { method: 'PATCH', path: route(target), body: [
        { op: 'replace', path: '/maintenancewindowdefinitiontype', value: 'Everyday' },
        { op: 'replace', path: '/intervals', value: INTERVALS },
      ] },
      { method: 'POST', path: route(target), body: { maintenanceWindowDefinitionType: 'Everyday', intervals: INTERVALS } },
    ]);
  });

  it('an interval-free create sends no intervals', async () => {
    await call(create, { id: ID, maintenanceWindowDefinitionType: 'Anytime' });
    expect(sent).toEqual([{ method: 'POST', path: route(target), body: { maintenanceWindowDefinitionType: 'Anytime' } }]);
  });

  it('an update of the intervals alone is sent as before', async () => {
    await call(update, { id: ID, intervals: INTERVALS });
    expect(sent).toEqual([{ method: 'PATCH', path: route(target), body: [{ op: 'replace', path: '/intervals', value: INTERVALS }] }]);
  });

  it('the descriptions state the rule', async () => {
    const tools = (await client.listTools()).tools;
    for (const name of [create, update]) {
      const t = tools.find((x) => x.name === name)!;
      expect(t.description).toMatch(/Anytime and Never take no intervals/);
      expect(String((t.inputSchema.properties as Record<string, { description?: string }>).intervals?.description)).toMatch(/at least one/);
    }
  });
});
