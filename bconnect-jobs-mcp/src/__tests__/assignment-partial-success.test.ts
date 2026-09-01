/**
 * A group assignment reports what 207 actually means: fully OR PARTIALLY done.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * The four `assign_job_to_*` routes declare exactly ONE 2xx, and it is 207:
 *
 *   "Group assignment fully or partially succeeded. Failed assignments may be
 *    listed in the response body with reasons for the error."
 *
 * with a body of `ProblemDetails` — not `JobInstance[]`
 * (`generated/jobs-types.ts` 2044-2053, and the same block for the static,
 * dynamic and universal-dynamic variants). There is no 200 at all, so EVERY
 * successful assignment takes this path.
 *
 * The handlers printed `Created ${result.length} job instances`. Two ways that
 * is wrong, and both are reachable:
 *
 *   - On the declared body, `result` is an object, so `.length` is `undefined`
 *     and the operator is told "Created undefined job instances".
 *   - If the server does return an array, the count is of what was CREATED and
 *     says nothing about what failed — which is the one thing a 207 exists to
 *     tell you. An operator assigns a patch job to a group, is told it worked,
 *     and some endpoints silently never got it.
 *
 * ── Why this one is worse than the microservice case ────────────────────────
 * It is a write that changes machines, the count reads as a receipt, and the
 * tool DESCRIPTION was already corrected to warn about 207 — enforced by
 * `descriptions-match-routes.test.ts`. Only the runtime half was left, which is
 * the half a model reads back to a human. Same split, higher stakes.
 *
 * Driven through the REAL handler; the module fake cannot show what the
 * operator is told.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../index.js';

const BASE_URL = 'http://bms.test.local/bconnect';
const ASSIGN = `${BASE_URL}/jobs/v2.0/LogicalGroups/:id/AssignJobDefinition`;
const GROUP = 'a0000001-0001-0001-0001-000000000001';
const JOB = 'b0000001-0001-0001-0001-000000000001';

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

async function assign(): Promise<string> {
  const { server } = createServer({ apiKey: 'test-key', baseUrl: BASE_URL });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'assign-probe', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  const result = await client.callTool({
    name: 'assign_job_to_logical_group',
    arguments: { logicalGroupId: GROUP, jobDefinitionId: JOB },
  });
  return (result.content as Array<{ text: string }>)[0].text;
}

/** The body the spec declares for 207 — ProblemDetails, naming the failures. */
const PROBLEM_DETAILS = {
  // The shape a real bMS returned, taken from this repo's own captured run
  // (phase3-rollback journals, 2026-07-28): failures live in a nested
  // `problems[]` array of per-endpoint 403s, there is no `detail`, and ZERO
  // instances were created. An earlier version of this fixture invented a flat
  // `detail` string while the real body sat unused in the repo.
  title: 'Not all job definition assignments could be processed successfully.',
  status: 207,
  problems: [
    { title: "Missing rights for assigning job definition to endpoint 'WIN10CLIENT7'.", status: 403 },
    { title: "Missing rights for assigning job definition to endpoint 'WIN10CLIENT3'.", status: 403 },
  ],
};

/** What the module's TYPE claims comes back, and what a server may also send. */
const CREATED_ROWS = [
  { id: 'ji-1', endpointName: 'WIN11CLIENT1', state: 'Waiting' },
  { id: 'ji-2', endpointName: 'WORKSTATION1', state: 'Waiting' },
];

describe('a 207 assignment is never reported as an unqualified success', () => {
  it('does not print a count from the declared ProblemDetails body', async () => {
    mockApi.use(http.post(ASSIGN, () => HttpResponse.json(PROBLEM_DETAILS, { status: 207 })));
    const text = await assign();

    // Vacuity: the handler ran and produced text.
    expect(text.length).toBeGreaterThan(0);
    // The property that was live: `.length` on an object is undefined.
    expect(text).not.toMatch(/undefined/i);
    // And it must not invent a creation count it does not have.
    expect(text).not.toMatch(/Created \d+ job instances/);
  });

  it('states that NO count is available rather than reporting zero', async () => {
    // Found by mutation, not by inspection. Making the non-array branch fall
    // back to `[]` instead of null passed every other assertion in this file
    // while printing "0 job instance(s) are listed below as created" — a false
    // ZERO, which reads as "nothing was assigned" when the truth is "this body
    // does not say". That is the missing-fact-as-good-fact defect wearing the
    // fix's own wording, and nothing here could see it.
    mockApi.use(http.post(ASSIGN, () => HttpResponse.json(PROBLEM_DETAILS, { status: 207 })));
    const text = await assign();

    expect(text).not.toMatch(/\b0 job instance/i);
    expect(text).toMatch(/no creation count|no job-instance list/i);
  });

  it('surfaces the failure detail the 207 body carries', async () => {
    // The whole point of a 207 body is naming what did not work. Discarding it
    // and printing a count is how a partial failure reads as a receipt.
    mockApi.use(http.post(ASSIGN, () => HttpResponse.json(PROBLEM_DETAILS, { status: 207 })));
    const text = await assign();
    expect(text).toMatch(/WIN10CLIENT7/);
    expect(text).toMatch(/Missing rights/i);
  });

  it('discloses possible partial failure even when rows ARE returned', async () => {
    // The dangerous case, because it looks right: an array comes back, the
    // count is real, and it still says nothing about endpoints that failed.
    // 207 is the only declared 2xx, so a complete-looking result is never
    // evidence that the assignment was complete.
    mockApi.use(http.post(ASSIGN, () => HttpResponse.json(CREATED_ROWS, { status: 207 })));
    const text = await assign();

    // NOT /2/: the prose contains the literal "207", so that matched
    // unconditionally and a mutant deleting the count entirely passed every
    // test in this file. Pin the sentence that carries the number.
    expect(text).toMatch(/2 job instance\(s\) are listed below as created/);
    expect(text).toMatch(/partial/i);
    expect(text).toMatch(/207/);
  });

  it('still carries the destructive-check disclosure', async () => {
    // The gate is unrelated to this fix and must not be lost in the rewrite:
    // v1.1 is not configured here, so the assignment proceeds UNCHECKED and
    // has to say so.
    mockApi.use(http.post(ASSIGN, () => HttpResponse.json(CREATED_ROWS, { status: 207 })));
    const text = await assign();
    expect(text).toMatch(/NOT CHECKED/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The floor can be zero, and three of the four routes were pinned by nothing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Found by adversarial review. The first cut hedged COMPLETENESS — "not every
 * member was assigned", "failures may be named" — which reads as "most of it
 * worked". The only 207 this project has ever captured from a real bMS
 * (phase3-rollback journals, 2026-07-28) created NOTHING: every endpoint came
 * back 403 "Missing rights". Wording that only admits partiality lets a floor
 * of zero pass as a mostly-good outcome, which is the same defect one level up.
 */
describe('a 207 that created nothing is not softened into a partial success', () => {
  it('says the count may be zero rather than only that it may be incomplete', async () => {
    mockApi.use(http.post(ASSIGN, () => HttpResponse.json(PROBLEM_DETAILS, { status: 207 })));
    const text = await assign();
    expect(text).toMatch(/may be ZERO|did NOT get the job/);
  });

  it('does not send the reader to a JobInstance[] body for failures it cannot hold', async () => {
    // An array body lists creations only. Telling a reader failures "may be
    // named" there sends them looking for something structurally absent, and
    // finding nothing reads as clean.
    mockApi.use(http.post(ASSIGN, () => HttpResponse.json(CREATED_ROWS, { status: 207 })));
    const text = await assign();
    expect(text).toMatch(/cannot show refusals|absence of an error here is not evidence/i);
  });

  it('reports a genuinely empty array as zero created, which is a fact', async () => {
    // The distinction the null branch exists to preserve: an empty ARRAY is the
    // server saying "none", and must read as zero. An absent array is the
    // server saying nothing, and must not.
    mockApi.use(http.post(ASSIGN, () => HttpResponse.json([], { status: 207 })));
    const text = await assign();
    expect(text).toMatch(/0 job instance\(s\) are listed below as created/);
    expect(text).not.toMatch(/cannot say how many/);
  });
});

/**
 * The commit's thesis is that ALL FOUR routes declare only 207 — and only the
 * logical-group arm was driven. Reverting the static, dynamic or
 * universal-dynamic arm to the old string reddened nothing anywhere.
 */
describe('all four assign arms report the same way', () => {
  const arms = [
    ['assign_job_to_static_group', 'StaticGroups', 'staticGroupId'],
    // `DynamicGroups`, not `WindowsDynamicGroups` — the METHOD is
    // assignJobDefinitionToWindowsDynamicGroup but the route segment is not.
    ['assign_job_to_dynamic_group', 'DynamicGroups', 'dynamicGroupId'],
    ['assign_job_to_universal_dynamic_group', 'UniversalDynamicGroups', 'universalDynamicGroupId'],
  ] as const;

  it.each(arms)('%s does not print a creation count from a ProblemDetails body', async (tool, segment, idArg) => {
    mockApi.use(
      http.post(`${BASE_URL}/jobs/v2.0/${segment}/:id/AssignJobDefinition`, () =>
        HttpResponse.json(PROBLEM_DETAILS, { status: 207 })),
    );
    const { server } = createServer({ apiKey: 'test-key', baseUrl: BASE_URL });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: 'assign-arms', version: '1.0.0' }, { capabilities: {} });
    await client.connect(ct);
    const res = await client.callTool({
      name: tool,
      arguments: { [idArg]: GROUP, jobDefinitionId: JOB },
    });
    const text = (res.content as Array<{ text: string }>)[0].text;

    expect(text).not.toMatch(/undefined/i);
    expect(text).not.toMatch(/Created \d+ job instances/);
    expect(text).toMatch(/207/);
  });
});
