/**
 * `trigger_intune_installation` reads the boolean the API returns.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * The route's 200 body is `"application/json": boolean`
 * (`generated/endpoints-types.ts`, TriggerInstallationViaIntune). The module
 * was `Promise<void>` — it awaited the POST and discarded `response.data` — and
 * the handler returned the constant
 * `Intune installation triggered for endpoint ${id}`.
 *
 * So a 200 carrying **false** was reported as triggered. That is
 * `msw_cleanup`'s discarded `wasSuccessful` verbatim, in a different server:
 * the same class the servermanagement file fixed in August, and the same class
 * fixed for `start_microservice` and the four `assign_job_to_*` arms this week.
 * The pattern is not one bug; it is a habit of returning a constant next to a
 * body nobody read.
 *
 * ── Why this one matters ────────────────────────────────────────────────────
 * It is a write against a managed endpoint, and the tool's own description
 * ends "WARNING: starts an installation". An operator told the install was
 * triggered stops watching. A silent false means the agent never arrives and
 * the endpoint stays unmanaged — which no later read will flag as an error,
 * because nothing was ever queued.
 *
 * ── The three answers, kept apart ───────────────────────────────────────────
 * true      -> triggered, as the 200 description asserts
 * false     -> NOT confirmed. Deliberately no cause: the spec puts no
 *              description on this boolean, every documented refusal has its
 *              own status code, and the vendor's one documented bare-boolean
 *              200 elsewhere (defensecontrol's TriggerUpdateOnClient) means
 *              "could not be reached". Naming a mechanism would be the same
 *              defect inverted.
 * anything  -> the response carried no boolean, so this call cannot say either
 * else         way. Absent is not success.
 *
 * The false and unknown arms must stay DISTINGUISHABLE, and an earlier version
 * of this file did not check that: its assertion allowed `did not`, which the
 * unknown arm's "did not carry one" also matched, so deleting the false arm
 * outright left every test green.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../index.js';

const BASE_URL = 'http://bms.test.local/bconnect';
const ID = 'e0000001-0001-0001-0001-000000000001';
const ROUTE = `${BASE_URL}/endpoints/v2.0/WindowsEndpoints/:id/TriggerInstallationViaIntune`;

const mockApi = setupServer();

let savedGate: string | undefined;
beforeAll(() => {
  savedGate = process.env.ALLOW_WRITE_OPERATIONS;
  process.env.ALLOW_WRITE_OPERATIONS = 'true';
  mockApi.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => {
  process.env.ALLOW_WRITE_OPERATIONS = savedGate ?? '';
  mockApi.close();
});
afterEach(() => mockApi.resetHandlers());

async function trigger(): Promise<string> {
  const { server } = createServer({ apiKey: 'test-key', baseUrl: BASE_URL });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'intune-probe', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  const result = await client.callTool({
    name: 'trigger_intune_installation',
    arguments: { id: ID },
  });
  return (result.content as Array<{ text: string }>)[0].text;
}

/** `boolean | object` rather than `unknown`: msw's json() needs a JSON body. */
const answers = (body: boolean | Record<string, unknown>): void => {
  mockApi.use(http.post(ROUTE, () => HttpResponse.json(body, { status: 200 })));
};

describe('a 200 carrying false is not reported as triggered', () => {
  it('says the installation was NOT triggered when the body is false', async () => {
    answers(false);
    const text = await trigger();

    // Vacuity: the handler ran.
    expect(text.length).toBeGreaterThan(0);
    // The property that was live: a false body read as success.
    expect(text).not.toMatch(/installation triggered for endpoint/i);
    // NOT /did not/: the UNKNOWN arm says "did not carry one", so that
    // alternation matched it too — and deleting the false arm entirely left
    // every test in this file green. Pin a phrase only the false arm emits.
    expect(text).toMatch(/returned false/);
    expect(text).toMatch(/not report this endpoint as enrolling/);
  });

  it('reports success when the body is true', async () => {
    // The control. Over-hedging every answer would trade a false success for a
    // false doubt, which is its own inaccuracy — the API does assert this one.
    answers(true);
    const text = await trigger();
    expect(text).toMatch(/triggered/i);
    expect(text).not.toMatch(/not triggered|could not confirm/i);
  });

  it('cannot confirm when the body is not a boolean at all', async () => {
    // Absent is not success. A route that stops returning the flag must not
    // silently become an unconditional "triggered".
    answers({ unexpected: 'shape' });
    const text = await trigger();
    expect(text).toMatch(/cannot confirm|carried no boolean/i);
    expect(text).not.toMatch(/^Intune installation triggered/i);
  });

  it.each([[true], [false], [{ unexpected: 'shape' }]] as const)(
    'names the endpoint when the body is %j, so every answer is attributable',
    async (body) => {
      answers(body as boolean | Record<string, unknown>);
      expect(await trigger()).toContain(ID);
    },
  );
});
