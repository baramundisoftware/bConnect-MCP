/**
 * get_endpoint_briefing, through the REAL tool handler.
 *
 * The behaviours worth guarding are not "does it return fields" — they are the
 * five traps this composite was built to avoid, each verified live before the
 * code was written, plus the finding that shaped the output: a machine whose
 * every job reads "successful" can be carrying 27 failed executions.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../index.js";

const BASE = "http://bms.test.local/bconnect";
const ID = "e57a7e00-0000-4000-8000-000000000027";
const OTHER = "E57A7E00-0000-4000-8000-000000000004";

const TYPED = `${BASE}/endpoints/v2.0/WindowsEndpoints/${ID}`;
const UNTYPED = `${BASE}/endpoints/v2.0/Endpoints/${ID}`;
const LIST = `${BASE}/endpoints/v2.0/Endpoints`;
const BL = `${BASE}/defensecontrol/v2.0/BitLocker/WindowsEndpoints/${ID}`;
const DEF = `${BASE}/defensecontrol/v2.0/MicrosoftDefender/WindowsEndpoints/${ID}`;
const VULN = `${BASE}/compliance/v2.0/WindowsEndpoints/${ID}/DetectedVulnerabilities`;
const JOBS = `${BASE}/jobs/v2.0/Endpoints/${ID}/JobInstances`;
const SW = `${BASE}/software/v2.0/WindowsEndpoints/${ID}/InstalledWindowsSoftware`;
const VARS = `${BASE}/variables/v2.0/Endpoints/${ID}/VariableInstances`;

/**
 * Ages are relative to the RUN, not to a fixed date.
 *
 * A hardcoded `NOW = 2026-08-12` looked deterministic and was a time bomb: the
 * composite reads real `Date.now()`, so `daysAgo(1)` would silently cross the
 * 7-day stale-definition threshold a week later and `daysAgo(0)` the 30-day
 * staleness threshold a month later, changing the payload — and the byte
 * budget measured against it — with no code change. Found in review.
 */
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const page = (rows: unknown[], totalItems = rows.length) => ({
  currentPage: 0, pageSize: 100, totalPages: 1, totalItems,
  hasPreviousPage: false, hasNextPage: false, data: rows,
});

/** Healthy-looking machine: every CURRENT job state is a success. */
const healthy = [
  http.get(TYPED, () => HttpResponse.json({
    displayName: "WORKSTATION1", hostName: "WORKSTATION1", operatingSystem: "Windows 11",
    osVersionString: "10.0.26200", lastSeen: daysAgo(0), activity: "Successfully finished.",
    clientAgentState: "Running", clientAgentVersion: "26.1.161.0", logicalGroup: "Win11",
    isDeactivated: false,
  })),
  http.get(LIST, () => HttpResponse.json(page([
    { id: ID, displayName: "WORKSTATION1", hostName: "WORKSTATION1" },
    { id: OTHER, displayName: "WIN10CLIENT1", hostName: "WIN10CLIENT1" },
  ]))),
  http.get(BL, () => HttpResponse.json({
    tpmData: { tpmStatus: "Enabled" },
    storageMedia: [{ storageVolumes: [
      { isSystemVolume: false, name: "BOOT", bitLockerVolumeData: null },
      { isSystemVolume: true, bitLockerVolumeData: { protectionStatus: "Protected", conversionStatus: "FullyEncrypted" } },
    ] }],
  })),
  http.get(DEF, () => HttpResponse.json({
    isMicrosoftDefenderActive: true,
    microsoftDefenderState: { antivirus: { definitionCreation: daysAgo(1), definitionVersion: "1.457.113.0" } },
  })),
  http.get(VULN, () => HttpResponse.json(page([]))),
  http.get(JOBS, () => HttpResponse.json(page([
    { jobDefinitionName: "INVENTORY: (Daily)", jobDefinitionId: "job-1", state: "Rescheduled",
      successfulExecutions: 16, erroneousExecutions: 18 },
    { jobDefinitionName: "SCAN: Weekly", jobDefinitionId: "job-2", state: "FinishedSuccessfully",
      successfulExecutions: 9, erroneousExecutions: 3 },
    { jobDefinitionName: "PATCH: Monthly", jobDefinitionId: "job-3", state: "FinishedSuccessfully",
      successfulExecutions: 5, erroneousExecutions: 0 },
  ]))),
  // The row counts MATCH the totals. These two used to serve 4 rows under
  // totalItems 99 and 2 under 20 — which is exactly the short-served state the
  // trust rule now flags, so the "healthy" baseline was quietly modelling an
  // incident. Filler rows keep the narrative (a 99-product catalogue, 20
  // variables) without the contradiction.
  http.get(SW, () => HttpResponse.json(page([
    { name: "Calculator", vendor: "Microsoft", version: "1.0", installed: null },
    { name: "StickyNotes", vendor: "Microsoft", version: "1.0", installed: null },
    { name: "iTunes", vendor: "Apple", version: "12.13", installed: daysAgo(150) },
    { name: "Management Suite", vendor: "baramundi", version: "26R1", installed: daysAgo(14) },
    ...Array.from({ length: 95 }, (_, i) => ({
      name: `Inventoried-${i}`, vendor: "Various", version: "1.0", installed: null,
    })),
  ]))),
  http.get(VARS, () => HttpResponse.json(page([
    { name: "Patching Enabled", value: "T", scope: "Endpoint" },
    { name: "API KEY", value: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", scope: "Endpoint" },
    ...Array.from({ length: 18 }, (_, i) => ({ name: `VAR-${i}`, value: "x", scope: "Endpoint" })),
  ]))),
];

const mockApi = setupServer(...healthy);
beforeAll(() => mockApi.listen({ onUnhandledRequest: "error" }));
afterAll(() => mockApi.close());
afterEach(() => mockApi.resetHandlers(...healthy));

async function brief(args: Record<string, unknown>) {
  const { server } = createServer({ apiKey: "test-key", baseUrl: BASE });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "brief-probe", version: "1.0.0" }, { capabilities: {} });
  await client.connect(ct);
  const res = await client.callTool({ name: "get_endpoint_briefing", arguments: args });
  const text = (res.content as Array<{ text: string }>)[0].text;
  return { text, json: JSON.parse(text) as Record<string, any>, isError: res.isError as boolean | undefined };
}

describe("the finding this tool exists for: current state hides job history", () => {
  it("reports past failures on a machine whose every job currently reads successful", async () => {
    // Measured on the real WORKSTATION1: every state is FinishedSuccessfully or
    // Rescheduled, and the same rows carry 27 erroneousExecutions. A briefing
    // that reads state and stops is confidently wrong about this machine.
    const { json } = await brief({ endpointId: ID });
    expect(json.jobs.currentlyFailing).toBe(0);
    expect(json.jobs.totalErroneousExecutions).toBe(21);
    expect(json.jobs.jobsWithPastErrors).toBe(2);
    expect(json.headline.join(" ")).toMatch(/21 failed job execution/);
    expect(json.headline.join(" ")).toMatch(/INVENTORY: \(Daily\)/);
    expect(json.headline.join(" ")).toMatch(/Current state alone does not show this/);
  });

  it("keeps the job id for flagged jobs only, so drill-down needs no extra lookup", async () => {
    // Dropping every GUID would force a second round trip to re-find exactly
    // the job the briefing just named; keeping them all would be bulk.
    //
    // The bulk half of this assertion was VACUOUS until an adversarial review
    // caught it: it read `json.text`, and `json` is the parsed briefing with no
    // `text` key — so it asserted that "" does not contain "job-3" and could
    // never fail. `text` is the raw payload, and it is the sibling binding.
    const { json, text } = await brief({ endpointId: ID });
    const troubled = json.jobs.troubled as Array<{ job: string; jobDefinitionId: string }>;
    expect(troubled.map((t) => t.jobDefinitionId)).toEqual(["job-1", "job-2"]);
    expect(text).toContain("job-1");
    expect(text, "the clean job's id is bulk and must not travel").not.toContain("job-3");
  });
});

describe("the five traps, each verified live before the code was written", () => {
  it("TRAP 1: reads the TYPED endpoint route, not the untyped subset", async () => {
    // The untyped route answers 200 with a plausible object that omits
    // isDeactivated and clientAgentState — exactly the health fields.
    let untypedHits = 0;
    mockApi.use(http.get(UNTYPED, () => { untypedHits++; return HttpResponse.json({}); }));
    const { json } = await brief({ endpointId: ID });
    expect(untypedHits).toBe(0);
    expect(json.identity.agentState).toBe("Running");
  });

  it("TRAP 2: a DataUnavailable envelope is never read as zero vulnerabilities", async () => {
    // compliance answers 404 for 2 of 23 real Windows endpoints here, meaning
    // "never scanned". The module converts it to data:null + dataAvailable:false.
    // Reading `.data` alone yields undefined and would be summarised as none.
    mockApi.use(http.get(VULN, () => HttpResponse.json({
      data: null, totalItems: null, dataAvailable: false,
      note: "A 404 here does NOT mean zero.",
    })));
    const { json } = await brief({ endpointId: ID });
    expect(json.vulnerabilities.available).toBe(false);
    expect(json.vulnerabilities.detected).toBeUndefined();
    expect(json.meta.resultTrustworthy).toBe(false);
    expect(json.headline[0]).toMatch(/^INCOMPLETE/);
    expect(json.headline[0]).toContain("vulnerabilities");
  });

  it("TRAP 3: reads the SYSTEM volume, not whichever volume comes first", async () => {
    // bitLockerVolumeData is null on BOOT/Recovery. Taking vols[0] would report
    // "no BitLocker data" on a fully encrypted machine.
    const { json } = await brief({ endpointId: ID });
    expect(json.encryption.systemVolumeProtection).toBe("Protected");
    expect(json.headline.join(" ")).not.toMatch(/not encrypted/);
  });

  it("TRAP 4: names CVEs by cveId, never by the internal vulnerabilityId", async () => {
    mockApi.use(http.get(VULN, () => HttpResponse.json(page([
      { cveId: "CVE-2024-13176", vulnerabilityId: "e57a7e00-0000-4000-8000-000000000021", ignored: false },
      { cveId: "CVE-2025-14017", vulnerabilityId: "e57a7e00-0000-4000-8000-000000000022", ignored: true },
    ]))));
    const { json, text } = await brief({ endpointId: ID });
    expect(json.vulnerabilities.exampleCves).toEqual(["CVE-2024-13176"]);
    expect(json.vulnerabilities.ignored).toBe(1);
    expect(text).not.toContain("8f14e45f");
  });

  it("TRAP 5: never implies a severity the route does not carry", async () => {
    // Asserting only that the note says "no severity" is tautological — it
    // checks a hardcoded string against itself and would pass while the payload
    // ALSO emitted a severity field. The risk is emitting one, so assert its
    // absence.
    mockApi.use(http.get(VULN, () => HttpResponse.json(page([
      // A row carrying severity-shaped keys the route does not really have:
      // if the composite ever starts copying rows through, this catches it.
      { cveId: "CVE-2026-1", ignored: false, severity: "Critical", cvssScore: 9.8 },
    ]))));
    const { json, text } = await brief({ endpointId: ID });
    expect(json.vulnerabilities.severityNote).toMatch(/no severity or CVSS/i);
    expect(text).not.toMatch(/"severity"/);
    expect(text).not.toMatch(/cvssScore/);
    // 9.8 as a VALUE, not as the tail of a timestamp. The bare substring form
    // matched `"installed":"2026-07-29T15:35:49.833Z"` — the "9.8" inside
    // "49.833" — so this guard failed about 1 run in 100 on the clock alone,
    // which makes it flaky rather than wrong. A guard that fires on good code
    // is the failure mode this repo treats as worst.
    expect(text).not.toMatch(/(?<![\d.])9\.8(?!\d)/);
  });
});

describe("a clock ahead of ours is skew or a fault, never a negative age", () => {
  // bConnect sends UTC with an explicit Z on every real timestamp (verified
  // live across endpoints, defender and update-management, including the
  // .9846557Z .NET-tick form), so this is NOT a timezone-parsing problem —
  // endpoints carry their own `timeZone` field but the wire is normalised.
  // It is ordinary clock skew between whatever stamps `lastSeen` and whatever
  // supplies `now`, and Math.floor turns any future instant into -1.

  const identityAt = (lastSeen: () => string) =>
    http.get(TYPED, () => HttpResponse.json({
      displayName: "WORKSTATION1", hostName: "WORKSTATION1", operatingSystem: "Windows 11",
      osVersionString: "10.0.26200", lastSeen: lastSeen(), activity: "Successfully finished.",
      clientAgentState: "Running", clientAgentVersion: "26.1.161.0", logicalGroup: "Win11",
      isDeactivated: false,
    }));

  it("reads a check-in seconds in the future as 0 days, not -1", async () => {
    mockApi.use(identityAt(() => new Date(Date.now() + 5_000).toISOString()));
    const { json } = await brief({ endpointId: ID });
    expect(json.identity.daysSinceSeen).toBe(0);
  });

  it("does not report a NEGATIVE age for any endpoint", async () => {
    // The property, not the spelling: whatever the clocks are doing, no age
    // this tool prints may be below zero.
    mockApi.use(identityAt(() => new Date(Date.now() + 5_000).toISOString()));
    const { json } = await brief({ endpointId: ID });
    const ages = JSON.stringify(json).match(/"[a-zA-Z]*[Dd]ays?[a-zA-Z]*":(-?\d+)/g) ?? [];
    expect(ages.length).toBeGreaterThan(0);
    for (const a of ages) {expect(Number(a.split(":")[1])).toBeGreaterThanOrEqual(0);}
  });

  it("refuses to call a FAR-future check-in 'today' — it says the clocks disagree", async () => {
    // Clamping every negative to 0 would be the false all-clear in miniature:
    // a machine whose timestamp is three days out is a data or clock fault, and
    // "seen today" is a fact nobody measured. Unknown, and say why.
    mockApi.use(identityAt(() => new Date(Date.now() + 3 * 86_400_000).toISOString()));
    const { json } = await brief({ endpointId: ID });
    expect(json.identity.daysSinceSeen).toBeNull();
    expect(json.headline.join(" ")).toMatch(/future|clock/i);
  });

  it("still reports a normal past check-in unchanged", async () => {
    // Stamped ONCE here rather than per request: generated inside the handler
    // it lands a few ms short of 40 days and floors to 39 — the same
    // sub-boundary arithmetic this whole block is about, arriving in the test
    // itself.
    const past = daysAgo(40);
    mockApi.use(identityAt(() => past));
    const { json } = await brief({ endpointId: ID });
    expect(json.identity.daysSinceSeen).toBe(40);
    expect(json.headline.join(" ")).toMatch(/Not seen for 40 days/);
  });
});

describe("a name is resolved here, and ambiguity is refused rather than guessed", () => {
  it("accepts a display name and briefs that endpoint", async () => {
    const { json } = await brief({ endpointName: "WORKSTATION1" });
    expect(json.endpoint.id).toBe(ID);
    expect(json.meta.dimensionsRead).toBe(7);
  });

  it("refuses an ambiguous name instead of briefing the wrong machine", async () => {
    mockApi.use(http.get(LIST, () => HttpResponse.json(page([
      { id: ID, displayName: "SHARED", hostName: "A" },
      { id: OTHER, displayName: "SHARED", hostName: "B" },
    ]))));
    const { json } = await brief({ endpointName: "SHARED" });
    expect(json.endpoint).toBeNull();
    expect(json.headline[0]).toMatch(/matches 2 endpoints/);
    expect(json.meta.resultTrustworthy).toBe(false);
  });

  it("says so when no endpoint has that name", async () => {
    const { json } = await brief({ endpointName: "NOSUCHBOX" });
    expect(json.headline[0]).toMatch(/no endpoint is named/i);
    expect(json.meta.dimensionsRead).toBe(0);
  });

  it("requires one of the two, and says which to pass", async () => {
    await expect(brief({})).rejects.toThrow(/endpointId.*endpointName/s);
  });
});

describe("a missing fact never reads as a good fact (adversarial review, 2026-08-12)", () => {
  it("identity DEGRADES when the typed route fails — it is not rebuilt from the untyped list row", async () => {
    // THE defect this whole tool exists to avoid, found inside it. The name
    // path had a fallback to the /Endpoints list row, which is the strict
    // SUBSET of trap 1: no isDeactivated, no clientAgentState. Rebuilding from
    // it gave available:true, isDeactivated:false (from undefined===true),
    // agentState:null, dimensionsRead:7 and resultTrustworthy:TRUE — a
    // deactivated machine reported as fine, with the trust flag endorsing it.
    mockApi.use(http.get(TYPED, () => HttpResponse.json({}, { status: 404 })));
    const { json } = await brief({ endpointName: "WORKSTATION1" });
    expect(json.identity.available).toBe(false);
    expect(json.meta.resultTrustworthy).toBe(false);
    expect(json.meta.dimensionsRead).toBe(6);
    expect(json.headline[0]).toMatch(/^INCOMPLETE/);
    expect(json.headline[0]).toContain("identity");
    // and the same endpoint by GUID must behave identically
    const byId = await brief({ endpointId: ID });
    expect(byId.json.identity.available).toBe(false);
  });

  it("a 404 carries the MEASUREMENT declared at that call, not just the generic causes", async () => {
    // ARCH-1, 2026-08-14. Each of these reads passes its own 404 declaration to
    // readRows as an argument, because this function holds four of them and no
    // scope-based attribution could tell them apart.
    //
    // This is what stops the argument from rotting into decoration: drop it at
    // the jobs call and the note loses the measurement, while the generic
    // four-cause sentence — which every route shares — still reads fine.
    mockApi.use(http.get(JOBS, () => HttpResponse.json({}, { status: 404 })));
    const { json } = await brief({ endpointId: ID });
    expect(json.jobs.available).toBe(false);
    expect(json.jobs.reason).toMatch(/Measured for this route: Measured 2026-08-14/i);
    expect(json.jobs.reason).toMatch(/26 of 26 endpoints answer 200/i);
    // The enumerated causes are APPENDED to, never replaced: one estate's
    // measurement does not retire a possibility.
    expect(json.jobs.reason).toMatch(/does NOT mean zero/i);
    expect(json.jobs.reason).toMatch(/no data yet/i);
    expect(json.meta.resultTrustworthy).toBe(false);
  });

  it("a 404 on the vulnerabilities route says it does NOT mean zero", async () => {
    // The envelope the first version tested for is minted in compliance's OWN
    // module layer; this composite holds the raw axios client, so what actually
    // arrives is a bare 404. The tested branch was not the shipping branch.
    mockApi.use(http.get(VULN, () => HttpResponse.json({}, { status: 404 })));
    const { json } = await brief({ endpointId: ID });
    expect(json.vulnerabilities.available).toBe(false);
    expect(json.vulnerabilities.reason).toMatch(/does NOT mean zero/i);
    expect(json.vulnerabilities.reason).toMatch(/no data yet/i);
    expect(json.meta.resultTrustworthy).toBe(false);
  });

  it("a job row with no execution counters is counted as unknown, not as zero errors", async () => {
    mockApi.use(http.get(JOBS, () => HttpResponse.json(page([
      { jobDefinitionName: "No counters", jobDefinitionId: "j-x", state: "FinishedSuccessfully" },
    ]))));
    const { json } = await brief({ endpointId: ID });
    expect(json.jobs.errorCountUnknown).toBe(1);
    expect(json.jobs.totalErroneousExecutions).toBe(0);
    expect(json.headline.join(" ")).toMatch(/no execution counters/);
    // The vacuity that matters: it must NOT print the all-clear over it.
    expect(json.headline.join(" ")).not.toMatch(/Nothing wrong found/);
  });

  it("refuses to resolve a name when the endpoint list is truncated", async () => {
    // A duplicate outside the read window made an ambiguous name look unique,
    // which defeats the refusal this function exists for.
    mockApi.use(http.get(LIST, () => HttpResponse.json(page(
      [{ id: ID, displayName: "WORKSTATION1", hostName: "WORKSTATION1" }], 5000,
    ))));
    const { json } = await brief({ endpointName: "WORKSTATION1" });
    expect(json.endpoint).toBeNull();
    expect(json.headline[0]).toMatch(/5000 endpoints/);
    expect(json.headline[0]).toMatch(/Pass endpointId instead/);
  });

  it("discloses which dimensions were only sampled", async () => {
    // Estate totals sat beside page-derived aggregates with nothing saying so:
    // "250 assigned" next to an error sum over the first 100, stated absolutely.
    // A FULL page of a larger set — the server delivered everything asked for.
    // (This fixture used to serve 1 row under totalItems 250, which is the
    // short-served state, a different disclosure — tested separately below.)
    const rows = Array.from({ length: 100 }, (_, i) => ({
      jobDefinitionName: `J-${i}`, jobDefinitionId: `j-${i}`, state: "FinishedSuccessfully",
      successfulExecutions: 1, erroneousExecutions: 0,
    }));
    mockApi.use(http.get(JOBS, () => HttpResponse.json(page(rows, 250))));
    const { json } = await brief({ endpointId: ID });
    expect(json.jobs.assigned).toBe(250);
    expect(json.jobs.rowsExamined).toBe(100);
    expect(json.meta.truncated).toContain("jobs");
    expect(json.headline.join(" ")).toMatch(/only the first .* rows were read/i);
    expect(json.meta.resultTrustworthy).toBe(true);
  });

  it("reports absent encryption data as UNKNOWN, not as unencrypted", async () => {
    mockApi.use(http.get(BL, () => HttpResponse.json({
      tpmData: { tpmStatus: "Enabled" },
      storageMedia: [{ storageVolumes: [{ isSystemVolume: false, bitLockerVolumeData: null }] }],
    })));
    const { json } = await brief({ endpointId: ID });
    expect(json.headline.join(" ")).toMatch(/UNKNOWN, not known-good/);
    expect(json.headline.join(" ")).not.toMatch(/is not encrypted/);
  });

  it("treats a .NET MinValue date as never-reported, not as 739,839 days old", async () => {
    // Found on a LIVE machine, not by a fixture: the endpoint was powered on
    // mid-session and Defender came back with definitionCreation
    // "0001-01-01T00:00:00" and version "0.0" — .NET's DateTime.MinValue used
    // as a "no value yet" sentinel. The briefing reported "Antivirus
    // definitions are 739839 days old". Every one of 32 tests passed, because
    // every fixture used a plausible date. A sentinel is an ABSENT fact.
    mockApi.use(http.get(DEF, () => HttpResponse.json({
      isMicrosoftDefenderActive: true,
      microsoftDefenderState: { antivirus: { isActive: true, definitionCreation: "0001-01-01T00:00:00", definitionVersion: "0.0" } },
    })));
    const { json, text } = await brief({ endpointId: ID });
    expect(json.antivirus.definitionAgeDays).toBeNull();
    expect(json.antivirus.definitionsNeverReported).toBe(true);
    expect(json.antivirus.definitionVersion).toBeNull();
    expect(json.headline.join(" ")).toMatch(/NEVER been reported/);
    expect(text).not.toContain("739839");
    expect(json.headline.join(" ")).not.toMatch(/definitions are \d+ days old/);
  });

  it("does not report Defender as active when its antivirus subsystem is not", async () => {
    // Observed live on the same freshly-booted machine: the top-level flag said
    // true while antivirus.isActive said false. Reading only the top-level flag
    // reports protection that is not running.
    mockApi.use(http.get(DEF, () => HttpResponse.json({
      isMicrosoftDefenderActive: true,
      microsoftDefenderState: { antivirus: { isActive: false, definitionCreation: daysAgo(1), definitionVersion: "1.1" } },
    })));
    const { json } = await brief({ endpointId: ID });
    expect(json.antivirus.defenderActive).toBe(false);
    expect(json.antivirus.defenderReportedActive).toBe(true);
    expect(json.antivirus.antivirusSubsystemActive).toBe(false);
    expect(json.headline.join(" ")).toMatch(/ANTIVIRUS subsystem reports INACTIVE/);
  });

  it("reports a missing Defender flag as UNKNOWN, not as inactive", async () => {
    mockApi.use(http.get(DEF, () => HttpResponse.json({ microsoftDefenderState: { antivirus: {} } })));
    const { json } = await brief({ endpointId: ID });
    expect(json.antivirus.defenderActive).toBeNull();
    expect(json.headline.join(" ")).toMatch(/Defender activity is UNKNOWN/);
    expect(json.headline.join(" ")).not.toMatch(/reports INACTIVE/);
  });

  it("does not call an unrecognised patching value 'disabled'", async () => {
    mockApi.use(http.get(VARS, () => HttpResponse.json(page([
      { name: "Patching Enabled", value: "Yes", scope: "Endpoint" },
    ], 1))));
    const { json } = await brief({ endpointId: ID });
    expect(json.configuration.patchingEnabled).toBe(true);
    expect(json.headline.join(" ")).not.toMatch(/Patching is disabled/);
  });

  it("prefers the endpoint-scoped variable over a group-scoped duplicate", async () => {
    // A Map keyed by name kept whichever row came LAST, so a group-scoped "T"
    // could mask an endpoint-scoped "F": patching off, headline silent.
    mockApi.use(http.get(VARS, () => HttpResponse.json(page([
      { name: "Patching Enabled", value: "F", scope: "Endpoint" },
      { name: "Patching Enabled", value: "T", scope: "LogicalGroup" },
    ], 2))));
    const { json } = await brief({ endpointId: ID });
    expect(json.configuration.patchingEnabled).toBe(false);
    expect(json.headline.join(" ")).toMatch(/Patching is disabled/);
  });

  it("treats an endpoint that has never checked in as never seen", async () => {
    mockApi.use(http.get(TYPED, () => HttpResponse.json({
      displayName: "NEWBOX", hostName: "NEWBOX", operatingSystem: "Windows 11",
      lastSeen: null, clientAgentState: "Running", isDeactivated: false,
    })));
    const { json } = await brief({ endpointId: ID });
    expect(json.headline.join(" ")).toMatch(/never checked in/);
  });

  it("does not treat an unrecognised 200 body as an empty page", async () => {
    mockApi.use(http.get(SW, () => HttpResponse.json([{ name: "bare array" }])));
    const { json } = await brief({ endpointId: ID });
    expect(json.software.available).toBe(false);
    expect(json.software.reason).toMatch(/shape not understood/);
  });

  it("degrades identity on a 403 as well as a 404", async () => {
    mockApi.use(http.get(TYPED, () => HttpResponse.json({}, { status: 403 })));
    const { json } = await brief({ endpointId: ID });
    expect(json.identity.available).toBe(false);
    expect(json.identity.reason).toMatch(/may not read/);
  });
});

describe("disclosure and bulk", () => {
  it("never returns a variable VALUE, credential or otherwise", async () => {
    // The estate's `API KEY` variable holds a 64-hex credential inherited by
    // all 19 logical groups. Values are withheld wholesale rather than
    // filtered, because a filter is a guess about which values are secret.
    const { text, json } = await brief({ endpointId: ID });
    expect(text).not.toContain("0123456789abcdef");
    expect(json.configuration.variableCount).toBe(20);
    expect(json.configuration.patchingEnabled).toBe(true);
    expect(json.configuration.valuesWithheld).toMatch(/values are not returned/i);
  });

  it("lists only real installs, and counts the rest", async () => {
    // `installed` is null on OS-bundled/AppX rows and set on real deployment
    // events, so it separates signal from a 99-product catalogue.
    const { json } = await brief({ endpointId: ID });
    expect(json.software.installedCount).toBe(99);
    const names = (json.software.recentInstalls as Array<{ name: string }>).map((r) => r.name);
    expect(names).toEqual(["Management Suite", "iTunes"]); // newest first
    expect(names).not.toContain("Calculator");
  });

  it("stays far below the 23,738 B it replaces", async () => {
    const { text } = await brief({ endpointId: ID });
    expect(Buffer.byteLength(text)).toBeLessThan(6_000);
  });
});

describe("a short-served page breaks trust — the sibling rule, migrated 2026-08-22", () => {
  it("an EMPTY vulnerabilities page under an intact header is an incident, not a quiet sample", async () => {
    // The live-observed state (2026-08-12, this API): HTTP 200, data: [],
    // totalItems intact. Probed 2026-08-22 before this rule migrated from
    // estate-risk: resultTrustworthy stayed true, the vulnerability headline
    // stayed silent while `detected: 27` sat in the body, and the truncation
    // line claimed "the first 100 rows were read" when zero arrived.
    mockApi.use(http.get(VULN, () => HttpResponse.json(page([], 27))));
    const { json } = await brief({ endpointId: ID });

    expect(json.meta.resultTrustworthy).toBe(false);
    expect(json.meta.resultTrustworthyReasons.join(" ")).toMatch(/vulnerabilities/);
    expect(json.headline.join(" ")).toMatch(/INCOMPLETE/);
    expect(json.headline.join(" ")).not.toMatch(/only the first .* rows were read/i);
    expect(json.meta.truncated).not.toContain("vulnerabilities");
  });

  it("a STRING totalItems is a shape mismatch, loud — not a silent null", async () => {
    // Probed 2026-08-22: this module's own reader nulled a present-but-
    // unreadable total, switching the short-serve accounting off — the same
    // shape shortfallReason and paginateAll carried until 2026-08-19.
    mockApi.use(http.get(VULN, () => HttpResponse.json({ data: [{ cveId: "CVE-2026-1" }], totalItems: "27" })));
    const { json } = await brief({ endpointId: ID });

    expect(json.vulnerabilities.available).toBe(false);
    expect(String(json.vulnerabilities.reason)).toMatch(/totalItems/);
    expect(json.meta.resultTrustworthy).toBe(false);
  });
});

describe("degrade per dimension", () => {
  for (const [name, url] of [["encryption", BL], ["antivirus", DEF], ["jobs", JOBS], ["software", SW], ["configuration", VARS]] as const) {
    it(`survives ${name} failing and still answers the rest`, async () => {
      mockApi.use(http.get(url, () => HttpResponse.json({}, { status: 500 })));
      const { json, isError } = await brief({ endpointId: ID });
      expect(isError).toBeFalsy();
      expect(json[name].available).toBe(false);
      expect(json.identity.available).toBe(true);
      expect(json.meta.resultTrustworthy).toBe(false);
      expect(json.headline[0]).toContain(name);
    });
  }

  it("survives a transport failure, not just an HTTP status", async () => {
    mockApi.use(http.get(DEF, () => HttpResponse.error()));
    const { json, isError } = await brief({ endpointId: ID });
    expect(isError).toBeFalsy();
    expect(json.antivirus.available).toBe(false);
    expect(json.antivirus.reason).toMatch(/could not be reached/);
  });
});
