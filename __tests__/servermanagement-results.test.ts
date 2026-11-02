/**
 * Servermanagement results say what bMS did (#327).
 *
 * Start and restart of a microservice are only accepted by bMS ("Microservice
 * starting." / "restarting.", no body), so the result says so and points to
 * get_microservice. msw_cleanup answers 200 for a failed cleanup too; the lead
 * line follows wasSuccessful.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const ID = '99999999-9999-4999-8999-999999999999';
const BASE = 'https://bms.results.test/bconnect/servermanagement/v2.0';

let cleanup: () => Response = () => HttpResponse.json({ wasSuccessful: true, result: 'done' });
const msw = setupServer(
  http.post(`${BASE}/Microservices/:id/Start`, () => new HttpResponse(null, { status: 200 })),
  http.post(`${BASE}/Microservices/:id/Restart`, () => new HttpResponse(null, { status: 200 })),
  http.post(`${BASE}/Dips/MSWCleanup`, () => cleanup()),
);

let client: Client;
const saved = { ...process.env };
beforeAll(async () => {
  Object.assign(process.env, {
    BCONNECT_BASE_URL: 'https://bms.results.test/bconnect', BCONNECT_API_KEY: 'k',
    BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', BCONNECT_RELEASE: '26R1', ALLOW_WRITE_OPERATIONS: 'true',
  });
  msw.listen({ onUnhandledRequest: 'error' });
  const { createServer } = await import('../bconnect-servermanagement-mcp/src/index.ts');
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'servermanagement-results', version: '0' });
  await Promise.all([createServer().server.connect(a), client.connect(b)]);
});
afterEach(() => { cleanup = () => HttpResponse.json({ wasSuccessful: true, result: 'done' }); });
afterAll(async () => { await client.close(); msw.close(); process.env = saved; });

async function text(name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; text: string }> {
  const r = await client.callTool({ name, arguments: args });
  return { isError: r.isError === true, text: (r.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n') };
}

describe('microservice start and restart', () => {
  it('start_microservice reports an accepted request, not a started service', async () => {
    expect(await text('start_microservice', { id: ID })).toEqual({
      isError: false,
      text: 'Start requested: bMS accepted the request ("Microservice starting."). Check the state with get_microservice.',
    });
  });

  it('restart_microservice reports an accepted request, not a restarted service', async () => {
    expect(await text('restart_microservice', { id: ID })).toEqual({
      isError: false,
      text: 'Restart requested: bMS accepted the request ("Microservice restarting."). Check the state with get_microservice.',
    });
  });
});

describe('msw_cleanup', () => {
  it('leads with success when wasSuccessful is true', async () => {
    const r = await text('msw_cleanup');
    expect(r.isError).toBe(false);
    expect(r.text.split('\n')[0]).toBe('MSW cleanup succeeded:');
    expect(r.text).toContain('"wasSuccessful":true');
  });

  it.each([
    ['false', { wasSuccessful: false, result: 'locked files' }],
    ['missing', { result: 'unknown' }],
  ])('says it did not succeed when wasSuccessful is %s, with the result', async (_case, body) => {
    cleanup = () => HttpResponse.json(body);
    const r = await text('msw_cleanup');
    expect(r.text.split('\n')[0]).toBe('MSW cleanup did not succeed (wasSuccessful is not true):');
    expect(r.text).toContain(body.result);
    expect(r.text).not.toMatch(/executed|succeeded:/);
  });
});
