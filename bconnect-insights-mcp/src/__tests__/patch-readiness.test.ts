/**
 * get_patch_readiness, through the REAL tool handler.
 *
 * Every behaviour asserted here exists because an INDEPENDENT AUDIT re-derived
 * the underlying claims and found four of six overstated. The tests are written
 * against the corrected facts, not the original ones.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../index.js";

const BASE = "http://bms.test.local/bconnect";
const UM = `${BASE}/updatemanagement/v2.0/WindowsEndpoints`;
const CVE = `${BASE}/compliance/v2.0/DetectedVulnerabilities`;
const JOBS = `${BASE}/jobs/v2.0/JobInstances`;
const EPS = `${BASE}/endpoints/v2.0/Endpoints`;

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const page = (rows: unknown[], totalItems = rows.length) => ({
  currentPage: 0, pageSize: 500, totalPages: 1, totalItems,
  hasPreviousPage: false, hasNextPage: false, data: rows,
});

const E1 = "11111111-1111-4111-8111-111111111111"; // current inventory, missing updates
const E2 = "22222222-2222-4222-8222-222222222222"; // STALE inventory, reports 0
const E3 = "33333333-3333-4333-8333-333333333333"; // current, clean

const healthy = [
  http.get(UM, () => HttpResponse.json(page([
    { endpointId: E1, endpointName: "PATCHME", updateState: "NonCompliant",
      lastInventory: daysAgo(1), missingCriticalUpdates: 4, missingSecurityUpdates: 2 },
    { endpointId: E2, endpointName: "STALEBOX", updateState: "InventoryOutdated",
      lastInventory: daysAgo(400), missingCriticalUpdates: 0, missingSecurityUpdates: 0 },
    { endpointId: E3, endpointName: "CLEANBOX", updateState: "Compliant",
      lastInventory: daysAgo(2), missingCriticalUpdates: 0, missingSecurityUpdates: 0 },
  ]))),
  http.get(CVE, () => HttpResponse.json(page([
    // Two `detected` values on one endpoint, OLDEST FIRST, so a first-row
    // reduction reports a 200-day-old scan where the data is 45 days old.
    { endpointId: E3, endpointName: "CLEANBOX", cveId: "CVE-2026-1", ignored: false, detected: daysAgo(200) },
    { endpointId: E3, endpointName: "CLEANBOX", cveId: "CVE-2026-2", ignored: false, detected: daysAgo(45) },
  ], 983))),
  http.get(JOBS, () => HttpResponse.json(page([
    // A real Microsoft patch job, on E1 only.
    { jobDefinitionName: "UPDATE: Microsoft Updates (Patch Profile)", endpointId: E1, endpointName: "PATCHME",
      state: "Rescheduled", steps: [{ type: "WindowsMicrosoftUpdateInstallation", state: "FinishedSuccessfully" }] },
    // A NAME that looks like patching but is a variable-setting job.
    { jobDefinitionName: "SETTING: Patching Active", endpointId: E2, endpointName: "STALEBOX",
      state: "FinishedSuccessfully", steps: [{ type: "WindowsRegistry", state: "FinishedSuccessfully" }] },
    // Third-party app updating — named PATCH, but not Microsoft patching.
    { jobDefinitionName: "PATCH: 3rd Party Patching (Weekly)", endpointId: E3, endpointName: "CLEANBOX",
      state: "FinishedSuccessfully", steps: [{ type: "WindowsManagedSoftware", state: "FinishedSuccessfully" }] },
    // An inventory step: measurement, not patching.
    { jobDefinitionName: "INVENTORY: MS Updates", endpointId: E3, endpointName: "CLEANBOX",
      state: "FinishedSuccessfully", steps: [{ type: "WindowsMicrosoftUpdateInventory", state: "FinishedSuccessfully" }] },
  ]))),
  http.get(EPS, () => HttpResponse.json(page([
    { id: E1, displayName: "PATCHME" }, { id: E2, displayName: "STALEBOX" },
    { id: E3, displayName: "CLEANBOX" }, { id: "44444444-4444-4444-8444-444444444444", displayName: "LINUXBOX" },
  ]))),
];

const mockApi = setupServer(...healthy);
beforeAll(() => mockApi.listen({ onUnhandledRequest: "error" }));
afterAll(() => mockApi.close());
afterEach(() => mockApi.resetHandlers(...healthy));

async function report(args: Record<string, unknown> = {}) {
  const { server } = createServer({ apiKey: "test-key", baseUrl: BASE });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "patch-probe", version: "1.0.0" }, { capabilities: {} });
  await client.connect(ct);
  const res = await client.callTool({ name: "get_patch_readiness", arguments: args });
  const text = (res.content as Array<{ text: string }>)[0].text;
  return { text, json: JSON.parse(text) as Record<string, any>, isError: res.isError as boolean | undefined };
}

describe("a zero from an un-inventoried endpoint is never reported as clean", () => {
  it("excludes a stale-inventory endpoint from the trustworthy counts and says why", async () => {
    // The audit's sharpest discovery: live, an endpoint reported
    // missingSecurityUpdates 0 with updateState InventoryOutdated and a
    // lastInventory a YEAR old. Counting that as clean manufactures exactly the
    // false all-clear this project has spent its history removing.
    const { json } = await report();
    expect(json.microsoftUpdates.countsTrustworthy).toBe(2);
    expect(json.microsoftUpdates.countsNotTrustworthy).toBe(1);
    const not = json.microsoftUpdates.notTrustworthy as Array<{ endpoint: string; why: string }>;
    expect(not[0].endpoint).toBe("STALEBOX");
    expect(not[0].why).toMatch(/updateState is InventoryOutdated/);
    expect(json.headline.join(" ")).toMatch(/zeros mean unmeasured, not clean/);
  });

  it("excludes an endpoint whose inventory is merely old, even with a usable state", async () => {
    mockApi.use(http.get(UM, () => HttpResponse.json(page([
      { endpointId: E1, endpointName: "OLDINV", updateState: "Compliant",
        lastInventory: daysAgo(200), missingCriticalUpdates: 0, missingSecurityUpdates: 0 },
    ]))));
    const { json } = await report();
    expect(json.microsoftUpdates.countsTrustworthy).toBe(0);
    expect((json.microsoftUpdates.notTrustworthy as Array<{ why: string }>)[0].why).toMatch(/inventory is (199|200) days old/);
  });
});

describe("the two patch signals are never summed", () => {
  it("keeps Microsoft update counts and CVE detections in separate fields", async () => {
    // Measured live: 0 missing critical updates estate-wide alongside 983 CVE
    // detections on one endpoint. They are different populations, and a reader
    // who adds them gets a number that means nothing.
    const { json, text } = await report();
    expect(json.microsoftUpdates.totalMissingCritical).toBe(4);
    expect(json.cveDetections.detectionsInEstate).toBe(983);
    expect(json.cveDetections.populationNote).toMatch(/never summed/i);
    // no combined field anywhere. Asserted on the RAW payload: `json` has no
    // `text` key, so the first version of this line checked "" and could never
    // fail — the exact bug found in the sibling test file.
    expect(text).not.toContain("totalUnpatched");
  });

  it("does not claim a CVSS severity the route cannot provide", async () => {
    const { json, text } = await report();
    expect(json.cveDetections.severityNote).toMatch(/no CVSS score/i);
    expect(text).not.toMatch(/cvssScore/);
  });
});

describe("patch jobs are identified by STEP TYPE, not by name", () => {
  it("counts the Microsoft install job and ignores the lookalike names", async () => {
    // 'SETTING: Patching Active' is a variable job; 'PATCH: 3rd Party Patching'
    // updates third-party apps. A name matcher flags both and misses the real
    // one, which is called 'UPDATE: Microsoft Updates'.
    const { json } = await report();
    expect(json.patchJobs.installJobInstances).toBe(1);
    expect(json.patchJobs.inventoryJobInstances).toBe(1);
    expect(json.patchJobs.identifiedBy).toMatch(/steps\[\]\.type/);
  });

  it("treats Rescheduled as success, because a recurring job re-arms", async () => {
    // The audit refuted the claim that Rescheduled means neither: it means the
    // last run succeeded and the job re-armed, which is the steady state of a
    // healthy recurring patch job. Treating it as unknown marks every healthy
    // one indeterminate.
    const { json } = await report();
    expect(json.patchJobs.notSucceeding).toBe(0);
    expect(json.headline.join(" ")).not.toMatch(/did not succeed/);
  });

  it("flags a job that reports success while one of its steps failed", async () => {
    // The operator-override case: state FinishedSuccessfully set by hand while
    // the underlying step failed.
    mockApi.use(http.get(JOBS, () => HttpResponse.json(page([
      { jobDefinitionName: "UPDATE: Microsoft Updates", endpointId: E1, endpointName: "PATCHME",
        state: "FinishedSuccessfully",
        steps: [{ type: "WindowsMicrosoftUpdateInstallation", state: "FinishedWithError" }] },
    ]))));
    const { json } = await report();
    expect(json.patchJobs.succeededButAStepFailed).toBe(1);
    expect(json.headline.join(" ")).toMatch(/report success while a step failed/);
    const failures = json.patchJobs.failures as Array<{ state: string }>;
    expect(failures[0].state).toMatch(/a step failed/);
  });

  it("counts RescheduledWithError as a failure", async () => {
    mockApi.use(http.get(JOBS, () => HttpResponse.json(page([
      { jobDefinitionName: "UPDATE: Microsoft Updates", endpointId: E1, endpointName: "PATCHME",
        state: "RescheduledWithError",
        steps: [{ type: "WindowsMicrosoftUpdateInstallation", state: "FinishedWithError" }] },
    ]))));
    const { json } = await report();
    expect(json.patchJobs.notSucceeding).toBe(1);
  });
});

describe("the join, and its holes", () => {
  it("names the endpoints missing updates that have no patch job", async () => {
    // This is the question. E1 has updates missing AND a patch job, so it is
    // not the answer; make one that has neither.
    mockApi.use(http.get(JOBS, () => HttpResponse.json(page([]))));
    const { json } = await report();
    expect(json.coverage.endpointsMissingUpdatesWithNoPatchJob).toBe(1);
    expect(json.coverage.examples).toEqual(["PATCHME"]);
    expect(json.headline[0]).toMatch(/missing Microsoft updates AND have no patch-installation job/);
  });

  it("reports endpoints with no update-management row without calling it a fault", async () => {
    // Non-Windows endpoints have no row at all; 4 endpoints, 3 UM rows.
    const { json } = await report();
    expect(json.coverage.endpointsInEstate).toBe(4);
    expect(json.coverage.endpointsWithoutUpdateManagement).toBe(1);
    expect(json.coverage.note).toMatch(/not by itself a fault/);
  });
});

describe("unread is never rendered as a finding (pre-commit review, 2026-08-12)", () => {
  it("does NOT accuse endpoints of having no patch job when the jobs read failed", async () => {
    // The most dangerous number in this report. With jobs unreadable the set of
    // endpoints-with-a-patch-job is empty, so EVERY exposed endpoint was
    // accused — an absence of DATA rendered as an absence of PATCHING. The
    // degrade test below already produced this output and asserted nothing
    // about it.
    mockApi.use(http.get(JOBS, () => HttpResponse.json({}, { status: 500 })));
    const { json } = await report();
    expect(json.coverage.endpointsMissingUpdatesWithNoPatchJob).toBeNull();
    expect(json.coverage.endpointsWithAPatchInstallJob).toBeNull();
    expect(json.coverage.examples).toEqual([]);
    expect(json.headline.join(" ")).not.toMatch(/have no patch-installation job/);
  });

  it("counts the endpoints source as a source, so its failure is not silent", async () => {
    // /endpoints is read but was excluded from the accounting: a 403 there gave
    // null coverage figures, no INCOMPLETE line, and resultTrustworthy TRUE.
    mockApi.use(http.get(EPS, () => HttpResponse.json({}, { status: 403 })));
    const { json } = await report();
    expect(json.meta.resultTrustworthy).toBe(false);
    expect(json.meta.dimensionsTotal).toBe(4);
    expect(json.headline[0]).toMatch(/^INCOMPLETE/);
    expect(json.headline[0]).toContain("endpoints");
    expect(json.meta.resultTrustworthyReasons.join(" ")).toMatch(/may not read/);
  });

  it("counts a Cancelled patch job as a failure, not as success", async () => {
    // The classifier enumerated only FinishedWithError/RescheduledWithError, so
    // Cancelled, RequirementsNotMet and SkippedDueToIncompatibility all read as
    // success: a cancelled patch programme reported zero problems. The
    // canonical classifier lives in mcp-core and this now uses it.
    //
    // This comment once claimed all three states were thereby fixed. Measured
    // 2026-08-26: the classifier caught only Cancelled — the one state this
    // test exercises. The other two are the not-executed bucket, tested below.
    mockApi.use(http.get(JOBS, () => HttpResponse.json(page([
      { jobDefinitionName: "UPDATE: Microsoft Updates", endpointId: E1, endpointName: "PATCHME",
        state: "Cancelled", steps: [{ type: "WindowsMicrosoftUpdateInstallation", state: "Cancelled" }] },
    ]))));
    const { json } = await report();
    expect(json.patchJobs.notSucceeding).toBe(1);
    expect(json.headline.join(" ")).toMatch(/did not succeed/);
  });

  it("surfaces RequirementsNotMet and SkippedDueToIncompatibility as not-executed, not as success or failure", async () => {
    // The two states the comment above claimed were caught and were not: a
    // patch-install instance in either state counted in NOTHING — not
    // notSucceeding (not a failure state), not succeededButAStepFailed, not
    // pastFailures (erroneousExecutions 0, the live-observed shape) — while
    // still marking its endpoint as "has a patch job". An endpoint whose only
    // patch job never executes read as fully healthy.
    //
    // The RequirementsNotMet row deliberately carries NO steps and no step of
    // its own could identify it: live, a never-executed instance has none
    // (measured 2026-08-26 — steps are runtime records). It is identified
    // through its step-bearing sibling of the same jobDefinitionId.
    const J1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    mockApi.use(http.get(JOBS, () => HttpResponse.json(page([
      { jobDefinitionId: J1, jobDefinitionName: "UPDATE: Microsoft Updates", endpointId: E3, endpointName: "CLEANBOX",
        state: "FinishedSuccessfully", erroneousExecutions: 0, successfulExecutions: 3,
        steps: [{ type: "WindowsMicrosoftUpdateInstallation", state: "FinishedSuccessfully" }] },
      { jobDefinitionId: J1, jobDefinitionName: "UPDATE: Microsoft Updates", endpointId: E1, endpointName: "PATCHME",
        state: "RequirementsNotMet", erroneousExecutions: 0, successfulExecutions: 0, steps: [] },
      { jobDefinitionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", jobDefinitionName: "UPDATE: MS Upgrades", endpointId: E2, endpointName: "STALEBOX",
        state: "SkippedDueToIncompatibility", erroneousExecutions: 0, successfulExecutions: 0,
        steps: [{ type: "WindowsMicrosoftUpdateInstallation", state: "SkippedDueToIncompatibility" }] },
    ]))));
    const { json } = await report();
    expect(json.patchJobs.notExecuted).toBe(2);
    expect(json.patchJobs.notSucceeding).toBe(0);
    expect(json.patchJobs.succeededButAStepFailed).toBe(0);
    const examples = json.patchJobs.notExecutedExamples as Array<{ endpoint: string; state: string }>;
    expect(examples.map((e) => e.state).sort()).toEqual(["RequirementsNotMet", "SkippedDueToIncompatibility"]);
    expect(json.headline.join(" ")).toMatch(/concluded without executing/);
    // Not failures: the failure headline stays silent.
    expect(json.headline.join(" ")).not.toMatch(/did not succeed/);
  });

  it("counts a patch job cancelled before its first execution — a stepless row — in notSucceeding", async () => {
    // The pre-existing hole the two-pass identification closes for the FAILURE
    // counter too: a never-executed instance carries no steps, so a patch job
    // cancelled while queued was not identified as a patch job at all and
    // vanished from notSucceeding. Its definition is proven by the sibling row.
    const J1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    mockApi.use(http.get(JOBS, () => HttpResponse.json(page([
      { jobDefinitionId: J1, jobDefinitionName: "UPDATE: Microsoft Updates", endpointId: E3, endpointName: "CLEANBOX",
        state: "FinishedSuccessfully", erroneousExecutions: 0, successfulExecutions: 3,
        steps: [{ type: "WindowsMicrosoftUpdateInstallation", state: "FinishedSuccessfully" }] },
      { jobDefinitionId: J1, jobDefinitionName: "UPDATE: Microsoft Updates", endpointId: E1, endpointName: "PATCHME",
        state: "Cancelled", erroneousExecutions: 0, successfulExecutions: 0, steps: [] },
    ]))));
    const { json } = await report();
    expect(json.patchJobs.installJobInstances).toBe(2);
    expect(json.patchJobs.notSucceeding).toBe(1);
    expect((json.patchJobs.failures as Array<{ endpoint: string }>)[0].endpoint).toBe("PATCHME");
  });

  it("still treats Rescheduled as success after switching to the shared classifier", async () => {
    // The X5 subtlety the shared classifier preserves: Rescheduled READS like a
    // failure and is not one. Asserted here because adopting a regex-based
    // classifier is exactly where that would regress.
    const { json } = await report();
    expect(json.patchJobs.notSucceeding).toBe(0);
  });

  it("does not trust a count when updateState is absent", async () => {
    // The gate blacklisted InventoryOutdated/Unknown, so an ABSENT updateState
    // (the field is optional) passed as trustworthy — a missing fact reading as
    // a good one. It now whitelists Compliant/NonCompliant.
    mockApi.use(http.get(UM, () => HttpResponse.json(page([
      { endpointId: E1, endpointName: "NOSTATE", lastInventory: daysAgo(1),
        missingCriticalUpdates: 0, missingSecurityUpdates: 0 },
    ]))));
    const { json } = await report();
    expect(json.microsoftUpdates.countsTrustworthy).toBe(0);
    expect((json.microsoftUpdates.notTrustworthy as Array<{ why: string }>)[0].why).toMatch(/updateState is absent/);
  });

  it("says so when bMS reported no counts at all", async () => {
    mockApi.use(http.get(UM, () => HttpResponse.json(page([
      { endpointId: E1, endpointName: "NOCOUNTS", updateState: "Compliant", lastInventory: daysAgo(1) },
    ]))));
    const { json } = await report();
    expect((json.microsoftUpdates.notTrustworthy as Array<{ why: string }>)[0].why).toMatch(/no update counts/);
  });
});

describe("a CVE count is a claim about scan time, not about now", () => {
  // Raised by the owner, and it is the same defect class in the other
  // direction. A detection says "at scan time T this endpoint was exposed".
  // Patch at T+1 and the detection is not updated — it is invalidated silently
  // and keeps reading as current exposure until something re-scans. Live on
  // this estate the median scan is 140 days old and the oldest is 848, so this
  // is the normal condition here, not an edge case.

  const cveRows = (rows: unknown[], total?: number) =>
    http.get(CVE, () => HttpResponse.json(page(rows, total ?? rows.length)));

  it("reports the scan date and age behind each endpoint's count", async () => {
    const { json } = await report();
    const worst = (json.cveDetections.mostAffected as Array<Record<string, unknown>>)[0];
    expect(worst.endpoint).toBe("CLEANBOX");
    expect(typeof worst.scannedAt).toBe("string");
    expect(worst.scanAgeDays as number).toBeGreaterThanOrEqual(44);
    expect(worst.scanAgeDays as number).toBeLessThanOrEqual(46);
  });

  it("takes the NEWEST detection per endpoint, whatever order the rows arrive in", async () => {
    // scan-recency.ts measured every endpoint's detections sharing one
    // timestamp, but max() is the safe reduction either way — and a first-row
    // or last-row reduction would report a scan 300 days older than it is.
    mockApi.use(cveRows([
      { endpointName: "MIXED", cveId: "CVE-1", detected: daysAgo(300), ignored: false },
      { endpointName: "MIXED", cveId: "CVE-2", detected: daysAgo(3), ignored: false },
      { endpointName: "MIXED", cveId: "CVE-3", detected: daysAgo(120), ignored: false },
    ]));
    const { json } = await report();
    const row = (json.cveDetections.mostAffected as Array<Record<string, unknown>>)[0];
    expect(row.scanAgeDays as number).toBeLessThanOrEqual(4);
    expect(row.scanIsStale).toBe(false);
  });

  it("marks a stale scan and says the count describes scan time, not today", async () => {
    mockApi.use(cveRows([
      { endpointName: "STALESCAN", cveId: "CVE-1", detected: daysAgo(197), ignored: false },
    ]));
    const { json } = await report();
    const row = (json.cveDetections.mostAffected as Array<Record<string, unknown>>)[0];
    expect(row.scanIsStale).toBe(true);
    expect(json.cveDetections.scanRecency.staleEndpoints).toBe(1);
    expect(json.headline.join(" ")).toMatch(/scan time, not today/i);
  });

  it("names BOTH directions of the error, not just the fixed-vulnerability one", async () => {
    // A stale scan holds a fixed vulnerability open (the obvious direction) AND
    // hides everything installed since (the dangerous one). Reporting only the
    // first tells a reader stale scans over-report, which would make them
    // discount the count rather than re-scan.
    const { json } = await report();
    expect(json.cveDetections.currencyNote).toMatch(/never been checked|not been checked/i);
  });

  it("does NOT report a fresh scan when the rows carry no detection date", async () => {
    // The whole point. No date must read as no date, never as recent.
    mockApi.use(cveRows([
      { endpointName: "NODATE", cveId: "CVE-1", ignored: false },
      { endpointName: "NODATE", cveId: "CVE-2", ignored: false },
    ]));
    const { json, text } = await report();
    const row = (json.cveDetections.mostAffected as Array<Record<string, unknown>>)[0];
    expect(row.scannedAt).toBeNull();
    expect(row.scanAgeDays).toBeNull();
    expect(row.scanIsStale).toBeNull();
    expect(json.cveDetections.scanRecency.endpointsWithScanDate).toBe(0);
    expect(json.cveDetections.scanRecency.endpointsWithoutScanDate).toBe(1);
    expect(json.cveDetections.scanRecency.newestScanAgeDays).toBeNull();
    expect(json.cveDetections.scanRecency.oldestScanAgeDays).toBeNull();
    expect(json.headline.join(" ")).toMatch(/no scan date/i);
    expect(text).not.toMatch(/scan time, not today/i);
  });

  it("treats a sentinel detection date as absent, not as a 700,000-day-old scan", async () => {
    // bConnect emits .NET DateTime.MinValue for "never happened". Read as a
    // date it becomes ~739,839 days — found live on a machine switched on
    // mid-session, after 32 tests had passed over it.
    mockApi.use(cveRows([
      { endpointName: "SENTINEL", cveId: "CVE-1", detected: "0001-01-01T00:00:00", ignored: false },
    ]));
    const { json } = await report();
    const row = (json.cveDetections.mostAffected as Array<Record<string, unknown>>)[0];
    expect(row.scanAgeDays).toBeNull();
    expect(json.cveDetections.scanRecency.oldestScanAgeDays).toBeNull();
  });

  it("summarises scan ages over the DETECTION population, not the estate", async () => {
    // An endpoint scanned clean has no detections and therefore no `detected`
    // timestamp, so this composite cannot see it. It must not imply estate-wide
    // scan coverage: the two counts have to account for exactly the endpoints
    // that appear in these rows, and nothing more.
    mockApi.use(cveRows([
      { endpointName: "A", cveId: "CVE-1", detected: daysAgo(10), ignored: false },
      { endpointName: "B", cveId: "CVE-2", detected: daysAgo(100), ignored: false },
      { endpointName: "C", cveId: "CVE-3", detected: daysAgo(200), ignored: false },
      { endpointName: "D", cveId: "CVE-4", ignored: false },
    ]));
    const { json } = await report();
    const r = json.cveDetections.scanRecency as Record<string, number>;
    expect(r.endpointsWithScanDate + r.endpointsWithoutScanDate)
      .toBe(json.cveDetections.endpointsAffectedInSample);
    expect(r.newestScanAgeDays).toBeLessThanOrEqual(11);
    expect(r.oldestScanAgeDays).toBeGreaterThanOrEqual(199);
    expect(r.medianScanAgeDays).toBeGreaterThanOrEqual(99);
    expect(r.medianScanAgeDays).toBeLessThanOrEqual(101);
  });

  it("does not treat a FUTURE-dated inventory as fresh", async () => {
    // Worth pinning: with a plain floor, a future lastInventory gave a NEGATIVE
    // age, and a negative is never "> staleAfterDays", so the endpoint passed
    // the freshness gate and its zeros were published as trustworthy. The
    // clock fix closes that as a side effect; this makes it deliberate.
    mockApi.use(http.get(UM, () => HttpResponse.json(page([
      { endpointId: E1, endpointName: "FUTUREINV", updateState: "Compliant",
        lastInventory: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        missingCriticalUpdates: 0, missingSecurityUpdates: 0 },
    ]))));
    const { json } = await report();
    expect(json.microsoftUpdates.countsTrustworthy).toBe(0);
    expect((json.microsoftUpdates.notTrustworthy as Array<{ why: string }>)[0].why).toMatch(/future|clock/i);
  });

  it("reads a detection dated seconds in the future as a 0-day scan, not -1", async () => {
    // Same skew, different field: scanAgeDays is printed unconditionally, so it
    // has the same exposure daysSinceSeen had.
    mockApi.use(cveRows([
      { endpointName: "SKEWED", cveId: "CVE-1", detected: new Date(Date.now() + 5_000).toISOString(), ignored: false },
    ]));
    const { json } = await report();
    const row = (json.cveDetections.mostAffected as Array<Record<string, unknown>>)[0];
    expect(row.scanAgeDays).toBe(0);
    expect(row.scanIsStale).toBe(false);
    expect(json.cveDetections.scanRecency.newestScanAgeDays).toBe(0);
  });

  it("treats a detection dated FAR in the future as undated, not as scanned today", async () => {
    mockApi.use(cveRows([
      { endpointName: "BADCLOCK", cveId: "CVE-1", detected: new Date(Date.now() + 3 * 86_400_000).toISOString(), ignored: false },
    ]));
    const { json } = await report();
    const row = (json.cveDetections.mostAffected as Array<Record<string, unknown>>)[0];
    expect(row.scanAgeDays).toBeNull();
    expect(json.cveDetections.scanRecency.endpointsWithoutScanDate).toBe(1);
  });

  it("does not carry the scan date over from a source that failed", async () => {
    mockApi.use(http.get(CVE, () => HttpResponse.json({}, { status: 500 })));
    const { json, text } = await report();
    expect(json.cveDetections.available).toBe(false);
    expect(text).not.toMatch(/scanRecency/);
  });
});

describe("degrade per source, and disclose truncation", () => {
  for (const [name, url] of [["microsoftUpdates", UM], ["cveDetections", CVE], ["patchJobs", JOBS]] as const) {
    it(`survives ${name} failing and still answers the rest`, async () => {
      mockApi.use(http.get(url, () => HttpResponse.json({}, { status: 500 })));
      const { json, isError } = await report();
      expect(isError).toBeFalsy();
      expect(json[name].available).toBe(false);
      expect(json.meta.resultTrustworthy).toBe(false);
      expect(json.headline[0]).toMatch(/^INCOMPLETE/);
      expect(json.headline[0]).toContain(name);
    });
  }

  it("marks the result untrustworthy when a source was only sampled", async () => {
    mockApi.use(http.get(CVE, () => HttpResponse.json(page([
      { endpointId: E3, endpointName: "CLEANBOX", cveId: "CVE-2026-1", ignored: false },
    ], 9999))));
    const { json } = await report();
    expect(json.meta.truncated).toContain("cveDetections");
    expect(json.meta.resultTrustworthy).toBe(false);
    expect(json.headline.join(" ")).toMatch(/only the first \d+ rows were read/i);
  });

  it("says a 404 does not mean zero", async () => {
    mockApi.use(http.get(UM, () => HttpResponse.json({}, { status: 404 })));
    const { json } = await report();
    expect(json.microsoftUpdates.available).toBe(false);
    expect(json.microsoftUpdates.reason).toMatch(/does NOT mean zero/i);
  });
});
