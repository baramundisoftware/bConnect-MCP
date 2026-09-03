/**
 * get_endpoint_reach — driven through the REAL tool handler.
 *
 * ── The defect this tool is one bad line away from ──────────────────────────
 * It performs one membership read PER GROUP because bConnect has no
 * endpoint-to-groups direction. With 55 reads, some will fail on a real estate
 * — a 403 on a scoped credential, a short page, a timeout. A group whose
 * membership could not be read is NOT evidence the endpoint is outside it, and
 * reporting "in 15 groups" after 40 reads failed would be a floor presented as
 * a total, at larger scale than anywhere else in this suite.
 *
 * So the tests below spend most of their effort on the UNREAD paths, not the
 * happy one.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../index.js";

const BASE = "http://bms.reach.test/bconnect";
const EP = "e57a7e00-0000-4000-8000-000000000006";
const EP_ROUTE = `${BASE}/endpoints/v2.0/WindowsEndpoints/${EP}`;
const UDG_LIST = `${BASE}/universaldynamicgroups/v2.0/UniversalDynamicGroups`;
const UDG_MEMBERS = `${BASE}/endpoints/v2.0/UniversalDynamicGroups/:id/Endpoints`;
const JOBS = `${BASE}/jobs/v2.0/Endpoints/${EP}/JobInstances`;
const KIOSK = `${BASE}/jobs/v2.0/Endpoints/${EP}/KioskReleases`;

const page = (rows: unknown[], totalItems = rows.length) => ({
  currentPage: 0, pageSize: 1000, totalPages: 1, totalItems,
  hasPreviousPage: false, hasNextPage: false, data: rows,
});

const endpoint = {
  id: EP, displayName: "WIN10CLIENT4", hostName: "WIN10CLIENT4",
  lastSeen: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  logicalGroupId: "lg-1", logicalGroup: "Win10",
};
/** Three groups; the endpoint is in g1 only. */
const groups = [
  { id: "g1", name: "Patching Group: Production" },
  { id: "g2", name: "Kiosk Machines" },
  { id: "g3", name: "Unapproved Software" },
];
const membersOf: Record<string, unknown[]> = {
  g1: [{ id: EP }, { id: "other" }],
  g2: [{ id: "other" }],
  g3: [{ id: "other" }],
};

const handlers = [
  http.get(EP_ROUTE, () => HttpResponse.json(endpoint)),
  http.get(UDG_LIST, () => HttpResponse.json(page(groups))),
  http.get(UDG_MEMBERS, ({ params }) => HttpResponse.json(page(membersOf[params.id as string] ?? []))),
  http.get(JOBS, () => HttpResponse.json(page([
    { jobDefinitionName: "Deploy BMA", state: "FinishedSuccessfully" },
    { jobDefinitionName: "INVENTORY: (Daily)", state: "FinishedWithError" },
  ]))),
  http.get(KIOSK, () => HttpResponse.json(page([{ id: "k1" }]))),
];

const mockApi = setupServer(...handlers);
beforeAll(() => mockApi.listen({ onUnhandledRequest: "error" }));
afterAll(() => mockApi.close());
afterEach(() => mockApi.resetHandlers(...handlers));

async function call(args: Record<string, unknown> = {}) {
  const { server } = createServer({ apiKey: "test-key", baseUrl: BASE });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "reach", version: "1.0.0" }, { capabilities: {} });
  await client.connect(ct);
  const res = await client.callTool({ name: "get_endpoint_reach", arguments: { endpointId: EP, ...args } });
  const text = (res.content as Array<{ text: string }>)[0].text;
  return { text, json: JSON.parse(text) as Record<string, any>, bytes: Buffer.byteLength(text, "utf8") };
}

describe("the reverse lookup itself", () => {
  it("finds the groups the endpoint is actually in, and only those", async () => {
    const { json } = await call();

    expect(json.reach.universalDynamicGroupsMemberOfCount).toBe(1);
    expect(json.reach.universalDynamicGroups).toEqual(["Patching Group: Production"]);
    expect(json.reach.universalDynamicGroupsCheckedCount).toBe(3);
    expect(json.meta.resultTrustworthy).toBe(true);
  });

  it("matches membership whatever case the caller's GUID uses", async () => {
    // Measured live 2026-08-22: the same machine answered "in 19 of 55 groups"
    // to its lowercase id and "in 0 of 55 groups" to its uppercase one,
    // resultTrustworthy true both times. Every PATH route accepts either case
    // (the typed endpoint read, jobs and kiosk all answered 200 uppercase);
    // only the client-side membership compare was case-sensitive. PowerShell
    // prints GUIDs uppercase, so the input occurs in real estates.
    const upper = EP.toUpperCase();
    mockApi.use(
      http.get(`${BASE}/endpoints/v2.0/WindowsEndpoints/${upper}`, () => HttpResponse.json(endpoint)),
      http.get(`${BASE}/jobs/v2.0/Endpoints/${upper}/JobInstances`, () => HttpResponse.json(page([]))),
      http.get(`${BASE}/jobs/v2.0/Endpoints/${upper}/KioskReleases`, () => HttpResponse.json(page([]))),
    );
    const { json } = await call({ endpointId: upper });

    expect(json.reach.universalDynamicGroupsMemberOfCount).toBe(1);
    expect(json.reach.universalDynamicGroups).toEqual(["Patching Group: Production"]);
    expect(json.meta.resultTrustworthy).toBe(true);
  });

  it("reports the logical group WITHOUT a lookup — it is a field on the endpoint", async () => {
    const { json } = await call();
    expect(json.reach.logicalGroup).toBe("Win10");
    expect(json.reach.logicalGroupId).toBe("lg-1");
  });

  it("summarises what is assigned, and points elsewhere for the detail", async () => {
    const { json } = await call();
    expect(json.assigned.jobInstances).toBe(2);
    expect(json.assigned.currentlyFailing).toBe(1);
    expect(json.assigned.kioskReleases).toBe(1);
    expect(String(json.assigned.detailHint)).toMatch(/explain_job_failure/);
  });
});

describe("an unread group is never 'not a member'", () => {
  it("a 403 on one membership read makes it UNCHECKED, breaks trust, and floors the list", async () => {
    mockApi.use(http.get(UDG_MEMBERS, ({ params }) =>
      params.id === "g2"
        ? new HttpResponse(null, { status: 403 })
        : HttpResponse.json(page(membersOf[params.id as string] ?? []))));
    const { json } = await call();

    expect(json.reach.groupsNotCheckedCount).toBe(1);
    expect(json.reach.groupsNotChecked).toEqual(["Kiosk Machines"]);
    // The count of confirmed memberships must NOT silently absorb it.
    expect(json.reach.universalDynamicGroupsMemberOfCount).toBe(1);
    expect(json.meta.resultTrustworthy).toBe(false);
    expect(json.headline.join(" ")).toMatch(/INCOMPLETE/);
    expect(json.headline.join(" ")).toMatch(/FLOOR/);
    expect(json.headline.join(" ")).toMatch(/not evidence this endpoint is outside it/i);
  });

  it("a SHORT membership page cannot prove absence either", async () => {
    // The live-measured empty-page state, on a membership read: the server says
    // 50 members and serves 1, and the endpoint is not among the 1 served.
    mockApi.use(http.get(UDG_MEMBERS, ({ params }) =>
      params.id === "g3"
        ? HttpResponse.json(page([{ id: "other" }], 50))
        : HttpResponse.json(page(membersOf[params.id as string] ?? []))));
    const { json } = await call();

    expect(json.reach.groupsNotChecked).toEqual(["Unapproved Software"]);
    expect(json.meta.resultTrustworthy).toBe(false);
  });

  it("groups past maxGroupsChecked are reported unchecked, not assumed absent", async () => {
    const { json } = await call({ maxGroupsChecked: 1 });

    expect(json.reach.universalDynamicGroupsCheckedCount).toBe(1);
    expect(json.reach.groupsNotCheckedCount).toBe(2);
    expect(json.meta.resultTrustworthy).toBe(false);
    expect(json.meta.resultTrustworthyReasons.join(" ")).toMatch(/maxGroupsChecked=1/);
  });

  it("a short-served GROUP LIST is disclosed — groups nobody enumerated cannot be checked", async () => {
    mockApi.use(http.get(UDG_LIST, () => HttpResponse.json(page(groups, 55))));
    const { json } = await call();

    expect(json.meta.resultTrustworthy).toBe(false);
    expect(json.meta.resultTrustworthyReasons.join(" ")).toMatch(/55/);
  });

  it("an unreadable endpoint reports that it cannot answer, not an empty reach", async () => {
    mockApi.use(http.get(EP_ROUTE, () => new HttpResponse(null, { status: 404 })));
    const { json } = await call();

    expect(json.endpoint).toBeNull();
    expect(json.meta.resultTrustworthy).toBe(false);
    expect(json.headline.join(" ")).toMatch(/Cannot report reach/);
  });
});

describe("what it deliberately does not claim", () => {
  it("says static and dynamic groups are an API gap, not an absence", async () => {
    const { json } = await call();
    expect(String(json.meta.notCovered)).toMatch(/StaticGroups.*404|404.*StaticGroups/s);
    expect(String(json.meta.notCovered)).toMatch(/not a statement that this endpoint is in none/);
  });

  it("says the membership is a server-evaluated snapshot", async () => {
    const { json } = await call();
    expect(String(json.meta.snapshotNote)).toMatch(/snapshot/i);
    expect(String(json.meta.snapshotNote)).toMatch(/rule/i);
  });

  it("is a fraction of the hand-walk it replaces", async () => {
    const { bytes } = await call();
    expect(bytes).toBeLessThan(3_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The jobs and kiosk reads, which had no short-serve accounting at all
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The gap these close, found by an adversarial review of 2026-08-14.
 *
 * The header above says this file "spends most of its effort on the UNREAD
 * paths". That was true of the GROUP reads and false of the two reads beside
 * them. `jobs` was checked for `isUnavailable` and never for `truncated` or a
 * shortfall, and `kiosk` was not trust-accounted at all — not even the
 * unavailable arm. So `currentlyFailing` was computed over whatever rows the
 * server happened to serve and published with `resultTrustworthy: true`.
 *
 * The routine trigger is the dangerous one. An endpoint with more job instances
 * than `pageSize` produces a completely plausible headline — "1500 job
 * instance(s) across 2 definition(s), 1 currently in a failed state" — with a
 * silently undercounted failure figure and nothing anywhere saying so. The
 * empty-page variant at least looks odd. A wrong answer that looks reasonable
 * is the one that gets acted on.
 *
 * These assert the PROPERTY — the result must not claim to be trustworthy —
 * rather than any particular sentence, so a reworded reason does not go red.
 */
describe("a short-served jobs read cannot produce a trusted failure count", () => {
  it("does not report resultTrustworthy over an empty page under an intact header", async () => {
    // The state measured live on this estate: HTTP 200, data: [], real total.
    mockApi.use(http.get(JOBS, () => HttpResponse.json(page([], 40))));
    const { json } = await call();

    // Vacuity: the poisoned read really did reach the assigned block.
    expect(json.assigned.jobInstances).toBe(40);
    expect(json.assigned.jobDefinitions).toEqual([]);
    // The property: zero failures over zero rows served is not a clean bill.
    expect(json.meta.resultTrustworthy).toBe(false);
    expect((json.meta.resultTrustworthyReasons as string[]).join(" ")).toMatch(/job/i);
  });

  it("does not report resultTrustworthy when the page is merely truncated", async () => {
    // The ROUTINE trigger: more instances than pageSize. Rows are real, the
    // failure count is just incomplete — and that is what makes it dangerous.
    mockApi.use(http.get(JOBS, () => HttpResponse.json(page([
      { jobDefinitionName: "Deploy BMA", state: "FinishedSuccessfully" },
      { jobDefinitionName: "INVENTORY: (Daily)", state: "FinishedWithError" },
    ], 1500))));
    const { json } = await call();

    expect(json.assigned.jobInstances).toBe(1500);
    expect(json.assigned.jobInstancesExamined).toBe(2); // the two populations, side by side
    expect(json.assigned.currentlyFailing).toBe(1); // computed over 2 of 1500
    expect(json.meta.resultTrustworthy).toBe(false);
    // The contract for these reasons is that they say what was short AND BY HOW
    // MUCH. Matching only /job/i would pass a reason with every figure stripped.
    const reason = (json.meta.resultTrustworthyReasons as string[]).join(" ");
    expect(reason).toMatch(/job/i);
    expect(reason).toMatch(/2 of 1500/);
  });

  it("says so in the headline rather than only in meta", async () => {
    // A model summarising this reads the headline first; a caveat only a
    // careful reader finds in meta is the shape this repo keeps regretting.
    //
    // Asserting on "40" alone would NOT discriminate — the pre-fix headline
    // already printed the server's total. What has to be present is the
    // statement that the numbers beside it are incomplete.
    mockApi.use(http.get(JOBS, () => HttpResponse.json(page([], 40))));
    const { json } = await call();
    const headline = (json.headline as string[]).join(" ");
    expect(headline).toMatch(/incomplete/i);
    expect(headline).toMatch(/floor/i);
  });
});

describe("the kiosk read is trust-accounted, but only where it changes an answer", () => {
  it("flags an unreadable kiosk route instead of degrading silently to null", async () => {
    mockApi.use(http.get(KIOSK, () => new HttpResponse(null, { status: 403 })));
    const { json } = await call();

    expect(json.assigned.kioskReleases).toBeNull();
    // Before the fix this was `true`: a 403 became a null with no explanation.
    expect(json.meta.resultTrustworthy).toBe(false);
    expect((json.meta.resultTrustworthyReasons as string[]).join(" ")).toMatch(/kiosk/i);
  });

  it("does NOT drop trust for a truncated kiosk read, whose number is still exact", async () => {
    // The asymmetry with jobs is deliberate and this pins it. The only
    // kiosk-derived output is the server's own totalItems; the rows are never
    // read, so a short page costs this tool nothing. An earlier cut of this fix
    // flagged it — a false alarm on a correct number, with a test freezing it
    // in. That is the carriage-return marker mistake, and it is what this test
    // now prevents.
    mockApi.use(http.get(KIOSK, () => HttpResponse.json(page([{ id: "k1" }], 9))));
    const { json } = await call();
    expect(json.assigned.kioskReleases).toBe(9);
    expect(json.meta.resultTrustworthy).toBe(true);
  });
});

describe("the group picture says so when the LISTING itself fell short", () => {
  it("does not read as 'in no groups' when the listing could not be read", async () => {
    mockApi.use(http.get(UDG_LIST, () => new HttpResponse(null, { status: 403 })));
    const { json } = await call();

    expect(json.reach.universalDynamicGroupsCheckedCount).toBe(0);
    // `unchecked` is structurally empty here — nothing was ever listed — so the
    // pre-existing headline could not fire and "0 of 0 checked" read as a fact.
    expect((json.headline as string[]).join(" ")).toMatch(/incomplete/i);
    expect(json.meta.resultTrustworthy).toBe(false);
  });

  it("counts the groups it was never shown, not just the ones it could not read", async () => {
    // Three listed of fifty-five: the other 52 can never enter `unchecked`.
    mockApi.use(http.get(UDG_LIST, () => HttpResponse.json(page(groups, 55))));
    const { json } = await call();
    const headline = (json.headline as string[]).join(" ");
    expect(headline).toMatch(/incomplete/i);
    expect(headline).toMatch(/52/); // the number, not just the word
    expect(json.meta.resultTrustworthy).toBe(false);
  });
});

describe("the headline keeps the reach verdict first", () => {
  it("puts the group caveat above the jobs caveat when both fire", async () => {
    // This is a reach tool. headline[0] is pinned as THE verdict line across
    // four sibling suites, and an earlier cut of this fix unshifted the jobs
    // caveat on top of the group one — burying the tool's own product under a
    // footnote about a summary block that tells you to look elsewhere.
    mockApi.use(
      http.get(UDG_MEMBERS, ({ params }) =>
        params.id === "g2"
          ? new HttpResponse(null, { status: 403 })
          : HttpResponse.json(page(membersOf[params.id as string] ?? [])),
      ),
      http.get(JOBS, () => HttpResponse.json(page([{ jobDefinitionName: "Deploy BMA", state: "FinishedWithError" }], 1500))),
    );
    const { json } = await call();
    const headline = json.headline as string[];
    expect(headline[0]).toMatch(/group/i);
    expect(headline.join(" ")).toMatch(/1500/);
  });

  it("says something about jobs even when the read failed outright", async () => {
    // The severe case must not be quieter than the mild one: a 403 used to
    // produce no job sentence at all while a short serve shouted.
    mockApi.use(http.get(JOBS, () => new HttpResponse(null, { status: 403 })));
    const { json } = await call();
    expect((json.headline as string[]).join(" ")).toMatch(/jobs could not be read/i);
    expect(json.assigned.currentlyFailing).toBeNull();
  });
});

describe("the guard does not fire on healthy or degenerate-but-complete reads", () => {
  it("stays trustworthy when jobs and kiosk are both served whole", async () => {
    const { json } = await call();
    expect(json.meta.resultTrustworthy).toBe(true);
    expect(json.meta.resultTrustworthyReasons).toEqual([]);
    expect(json.assigned.currentlyFailing).toBe(1);
  });

  it("does not flag an envelope that omits totalItems", async () => {
    // `truncated` is false when totalItems is absent — there is nothing to
    // assert against. It must not guess, in either direction.
    mockApi.use(http.get(JOBS, () => HttpResponse.json({
      currentPage: 0, pageSize: 1000, totalPages: 1,
      hasPreviousPage: false, hasNextPage: false,
      data: [{ jobDefinitionName: "Deploy BMA", state: "FinishedSuccessfully" }],
    })));
    const { json } = await call();
    expect(json.meta.resultTrustworthy).toBe(true);
    expect(json.assigned.jobInstances).toBe(1);
  });

  it("does not flag a genuinely empty jobs read", async () => {
    // Zero rows AND zero claimed: complete, not short. The empty-page defect is
    // an intact header over an empty body, which is a different input.
    mockApi.use(http.get(JOBS, () => HttpResponse.json(page([], 0))));
    const { json } = await call();
    expect(json.meta.resultTrustworthy).toBe(true);
    expect(json.assigned.jobInstances).toBe(0);
    expect(json.assigned.currentlyFailing).toBe(0);
  });
});
