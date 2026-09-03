/**
 * start / restart report a REQUEST ACCEPTED, because that is all the API says.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * The bConnect spec's own 200 descriptions are explicit about which of the
 * three transitions is synchronous:
 *
 *   POST /Microservices/{id}/Start    -> "Microservice starting."     (200)
 *   POST /Microservices/{id}/Restart  -> "Microservice restarting."   (200)
 *   POST /Microservices/{id}/Stop     -> "Microservice stopped."      (200)
 *
 * Two are in progress; one is done. All three routes return `content?: never`,
 * so nothing is read back — and the handlers nonetheless answered "Microservice
 * started successfully." and "restarted successfully.", asserting the completion
 * the API pointedly did not.
 *
 * The tool DESCRIPTIONS were already honest ("Returns no content on successful
 * start REQUEST"). The lie was only in the runtime text, which is the half a
 * model actually reads back to an operator.
 *
 * ── Why it matters here specifically ────────────────────────────────────────
 * A microservice that fails to come up is exactly the case an operator runs
 * this tool for. `list_microservices`' own description warns "Treat any state
 * other than 'Running' as 'this module is unavailable'" — and nothing called
 * it. Told "started successfully", the operator stops looking.
 *
 * This is the same class the same file fixed for `msw_cleanup` on 2026-08-11
 * (a constant string asserting the one thing a false answer denies). Two arms
 * of the same switch were left behind.
 *
 * ── What is deliberately NOT done ───────────────────────────────────────────
 * The handler does NOT read the state back. `get_microservice` immediately
 * after a Start would race the transition it just requested and would report
 * "Starting" — or still "Stopped" — as though that were the outcome. Inventing
 * a read-back that races is a worse answer than naming the boundary and telling
 * the caller which tool settles it.
 *
 * Driven through the REAL handler, per the project rule that only the handler
 * path proves what a model sees.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../index.js';

const BASE_URL = 'http://bms.test.local/bconnect';
const MS = `${BASE_URL}/servermanagement/v2.0/Microservices`;
const ID = 'd0000001-0001-0001-0001-000000000001';

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

async function callText(name: string): Promise<string> {
  const { server } = createServer({ apiKey: 'test-key', baseUrl: BASE_URL });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'ms-transition-probe', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  const result = await client.callTool({ name, arguments: { id: ID } });
  return (result.content as Array<{ text: string }>)[0].text;
}

/** The API answers 200 with no body, exactly as the spec declares. */
function acceptWith(action: string): void {
  mockApi.use(http.post(`${MS}/:id/${action}`, () => new HttpResponse(null, { status: 200 })));
}

describe('an asynchronous transition is not reported as a completed one', () => {
  it('start does not claim the microservice is running', async () => {
    acceptWith('Start');
    const text = await callText('start_microservice');

    // Vacuity: the arm really did run and produce text.
    expect(text.length).toBeGreaterThan(0);
    // The property: no claim of a finished transition. Asserted as a property
    // of the CLAIM rather than a spelling — any wording is fine that does not
    // say the thing the API declined to say.
    expect(text).not.toMatch(/started successfully|is now running|has started/i);
    // And it must say what WAS established: the request was accepted.
    expect(text).toMatch(/accept|request|starting/i);
  });

  it('restart does not claim the microservice is back', async () => {
    acceptWith('Restart');
    const text = await callText('restart_microservice');
    expect(text).not.toMatch(/restarted successfully|is now running|has restarted/i);
    expect(text).toMatch(/accept|request|restarting/i);
  });

  it('points the caller at the tool that settles the outcome', async () => {
    // Naming the boundary is only half an answer; the caller needs the next
    // step, because "not confirmed" without a route to confirmation is the
    // shape operators learn to ignore.
    acceptWith('Start');
    const text = await callText('start_microservice');
    expect(text).toMatch(/get_microservice|list_microservices/);
  });

  it("names Starting as an expected transient, not a failure", async () => {
    // The fix's first cut said "treat any state other than Running as
    // unavailable" — lifted from list_microservices, where it is right for a
    // STEADY-STATE read. After a Start, 'Starting' is the healthy state for
    // several seconds, so that text replaced a false completion claim with a
    // false FAILURE claim inside the very window it directs the caller into.
    acceptWith("Start");
    const text = await callText("start_microservice");
    expect(text).toMatch(/Starting/);
    expect(text).not.toMatch(/any state other than Running/i);
  });

  it("claims no status code it did not read", async () => {
    // The route is Promise<void>; nothing inspects response.status. Printing
    // "(HTTP 200)" asserted an observation the handler never made — the defect
    // class this whole change exists to remove.
    acceptWith("Start");
    const text = await callText("start_microservice");
    expect(text).not.toMatch(/HTTP \d/);
  });

  it('stop DOES report completion, because the API asserts it', async () => {
    // The control, and the reason this is a two-arm fix rather than a
    // blanket one: the spec's 200 for Stop is "Microservice stopped." — past
    // tense, synchronous. Weakening this one would trade a false claim for a
    // false doubt, which is its own inaccuracy.
    acceptWith('Stop');
    const text = await callText('stop_microservice');
    expect(text).toMatch(/stopped/i);
    // Forbids the false claim, not the pointer. An earlier version banned the
    // word "confirm" outright, which pinned the ABSENCE of a get_microservice
    // reference as a permanent property — and ServiceState has a 'Stopping'
    // transient, so that is exactly the thing a future reader may need to add.
    expect(text).not.toMatch(/request accepted|not established/i);
  });
});
