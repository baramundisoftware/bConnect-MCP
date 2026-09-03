/**
 * get_patch_readiness — past failures the current state hides (deferred audit
 * item M4), through the REAL tool handler.
 *
 * The defect class is this suite's own headline discovery: on WORKSTATION1,
 * every job's CURRENT state read FinishedSuccessfully or Rescheduled while the
 * same rows carried 27 erroneousExecutions — and get_endpoint_briefing was
 * built to lead with exactly that. get_patch_readiness then answered "is
 * patching working" from current state and step states alone:
 * `erroneousExecutions` was never read, so a patch job that failed 18 times
 * and succeeded twice — currently resting between attempts — counted as
 * patching-in-good-order. Measured live: WORKSTATION1's "UPDATE: Microsoft
 * Updates" instance reads FinishedSuccessfully with 2 errors to 2 successes.
 *
 * The boundary the controls pin: an instance ALREADY surfaced as failing (or
 * success-with-a-failed-step) must not be double-reported here, a clean
 * history stays silent, and a row with NO counter lands in its own
 * errorCountUnknown bucket — a row with no counter is not a row with zero
 * errors (the endpoint-briefing rule).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../index.js";

const BASE = "http://bms.history.local/bconnect";
const UM = `${BASE}/updatemanagement/v2.0/WindowsEndpoints`;
const CVE = `${BASE}/compliance/v2.0/DetectedVulnerabilities`;
const JOBS = `${BASE}/jobs/v2.0/JobInstances`;
const EPS = `${BASE}/endpoints/v2.0/Endpoints`;

const E1 = "11111111-1111-4111-8111-111111111111";

const page = (rows: unknown[], totalItems = rows.length) => ({
  currentPage: 0, pageSize: 500, totalPages: 1, totalItems,
  hasPreviousPage: false, hasNextPage: false, data: rows,
});

const patchInstance = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  jobDefinitionName: "UPDATE: Microsoft Updates (Patch Profile)",
  endpointId: E1,
  endpointName: "PATCHME",
  state: "FinishedSuccessfully",
  steps: [{ type: "WindowsMicrosoftUpdateInstallation", state: "FinishedSuccessfully" }],
  ...overrides,
});

const quietOtherRoutes = [
  http.get(UM, () => HttpResponse.json(page([]))),
  http.get(CVE, () => HttpResponse.json(page([]))),
  http.get(EPS, () => HttpResponse.json(page([{ id: E1, displayName: "PATCHME" }]))),
];

const mockApi = setupServer(...quietOtherRoutes, http.get(JOBS, () => HttpResponse.json(page([]))));
beforeAll(() => mockApi.listen({ onUnhandledRequest: "error" }));
afterAll(() => mockApi.close());
afterEach(() => mockApi.resetHandlers(...quietOtherRoutes, http.get(JOBS, () => HttpResponse.json(page([])))));

async function report() {
  const { server } = createServer({ apiKey: "test-key", baseUrl: BASE });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "history-probe", version: "1.0.0" }, { capabilities: {} });
  await client.connect(ct);
  const res = await client.callTool({ name: "get_patch_readiness", arguments: {} });
  const text = (res.content as Array<{ text: string }>)[0].text;
  return JSON.parse(text) as Record<string, any>;
}

describe("past failed executions are not hidden behind a clean current state", () => {
  it("a currently-successful patch job with 18 past errors is surfaced, with the counters", async () => {
    mockApi.use(http.get(JOBS, () => HttpResponse.json(page([
      patchInstance({ erroneousExecutions: 18, successfulExecutions: 2 }),
    ]))));
    const json = await report();

    expect(json.patchJobs.pastFailures).toBe(1);
    const examples = json.patchJobs.pastFailureExamples as Array<Record<string, unknown>>;
    expect(examples[0]).toMatchObject({ endpoint: "PATCHME", errors: 18, successes: 2 });
    const headline = (json.headline as string[]).join(" ");
    expect(headline).toMatch(/18/);
    expect(headline).toMatch(/current state does not show/i);
  });

  it("control: an instance already surfaced as failing is not double-reported", async () => {
    mockApi.use(http.get(JOBS, () => HttpResponse.json(page([
      patchInstance({ state: "FinishedWithError", erroneousExecutions: 5, successfulExecutions: 1,
        steps: [{ type: "WindowsMicrosoftUpdateInstallation", state: "FinishedWithError" }] }),
    ]))));
    const json = await report();

    expect(json.patchJobs.notSucceeding).toBe(1);
    expect(json.patchJobs.pastFailures).toBe(0);
  });

  it("control: a clean history stays silent", async () => {
    mockApi.use(http.get(JOBS, () => HttpResponse.json(page([
      patchInstance({ erroneousExecutions: 0, successfulExecutions: 7 }),
    ]))));
    const json = await report();

    expect(json.patchJobs.pastFailures).toBe(0);
    expect((json.headline as string[]).join(" ")).not.toMatch(/current state does not show/i);
  });

  it("a row with NO counter is counted as unknown, never as zero errors", async () => {
    mockApi.use(http.get(JOBS, () => HttpResponse.json(page([
      patchInstance(),
    ]))));
    const json = await report();

    expect(json.patchJobs.errorCountUnknown).toBe(1);
    expect(json.patchJobs.pastFailures).toBe(0);
  });
});
