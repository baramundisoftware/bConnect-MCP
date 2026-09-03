/**
 * get_deployment_coverage — driven through the REAL tool handler.
 *
 * Not against `buildDeploymentCoverage` directly: a unit test of a composite
 * proves nothing about whether the tool calls it, and this repository has had a
 * projection test stay green while the dispatch arm using it was reverted.
 *
 * ── What this tool must never do ────────────────────────────────────────────
 * Report a machine as lacking software when the truth is that nobody has ever
 * looked at it. Measured live: the `Win10` group has 9 members while the
 * installed-software listing spans 8 endpoints, so the ninth contributes no
 * rows at all. A naive join accuses it of a failed deployment.
 *
 * ── And what it must NOT do either, which is the corrected half ─────────────
 * Refuse to answer because the snapshot is old. The inventory is a snapshot
 * (verified: `lastFound` is a re-confirmation stamp, one value per endpoint per
 * scan), so on any endpoint that HAS an inventory, an absent row is a dated
 * fact — "not installed as of that scan" — and voiding it on an age threshold
 * discards something the estate actually knows. An earlier version of this file
 * asserted the opposite; the test below now pins the correction.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../index.js";

const BASE = "http://bms.deploy.test/bconnect";
const BUNDLE = "e57a7e00-0000-4000-8000-000000000003";
const GROUP = "e57a7e00-0000-4000-8000-000000000001";
const APP = "e57a7e00-0000-4000-8000-000000000014";

const APPS = `${BASE}/software/v2.0/Bundles/${BUNDLE}/BundleApplications`;
const MEMBERS = `${BASE}/endpoints/v2.0/LogicalGroups/${GROUP}/Endpoints`;
const INSTALLED = `${BASE}/software/v2.0/LogicalGroups/${GROUP}/InstalledWindowsSoftware`;

const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();

const page = (rows: unknown[], totalItems = rows.length) => ({
  currentPage: 0, pageSize: 1000, totalPages: 1, totalItems,
  hasPreviousPage: false, hasNextPage: false, data: rows,
});

const bundleApp = { applicationId: APP, applicationName: "KIOSKTEST", applicationVendor: "baramundi", applicationVersion: "" };
const member = (n: number, lastSeenDaysAgo = 1) => ({
  id: `ep-${n}`, displayName: `WIN10CLIENT${n}`, lastSeen: iso(lastSeenDaysAgo),
});
/** A software row. `lastFound` is the inventory-freshness signal. */
const sw = (epId: string, epName: string, appId: string, lastFoundDaysAgo = 1) => ({
  applicationId: appId, name: "KIOSKTEST", vendor: "baramundi", version: "1.0",
  installed: iso(lastFoundDaysAgo), lastFound: iso(lastFoundDaysAgo),
  endpointId: epId, endpointName: epName,
});

/** Default: 3 members. 1 has the app, 1 is inventoried without it, 1 reported nothing. */
const handlers = [
  http.get(APPS, () => HttpResponse.json(page([bundleApp]))),
  http.get(MEMBERS, () => HttpResponse.json(page([member(1), member(2), member(3)]))),
  http.get(INSTALLED, () => HttpResponse.json(page([
    sw("ep-1", "WIN10CLIENT1", APP),
    // ep-2 is inventoried (it reports OTHER software) but not this app.
    sw("ep-2", "WIN10CLIENT2", "some-other-app-id"),
    // ep-3 reports nothing at all — the live 9-vs-8 case.
  ]))),
];

const mockApi = setupServer(...handlers);
beforeAll(() => mockApi.listen({ onUnhandledRequest: "error" }));
afterAll(() => mockApi.close());
afterEach(() => mockApi.resetHandlers(...handlers));

async function call(args: Record<string, unknown> = {}) {
  const { server } = createServer({ apiKey: "test-key", baseUrl: BASE });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "deploy", version: "1.0.0" }, { capabilities: {} });
  await client.connect(ct);
  const res = await client.callTool({
    name: "get_deployment_coverage",
    arguments: { bundleId: BUNDLE, logicalGroupId: GROUP, ...args },
  });
  const text = (res.content as Array<{ text: string }>)[0].text;
  return { text, json: JSON.parse(text) as Record<string, any>, bytes: Buffer.byteLength(text, "utf8") };
}

describe("an absent row is a dated fact; only a never-scanned endpoint is unknown", () => {
  it("separates INSTALLED, NOT INSTALLED and NEVER INVENTORIED", async () => {
    const { json } = await call();

    expect(json.coverage.allApplicationsPresent).toBe(1);  // ep-1 has it
    expect(json.coverage.noneInstalled).toBe(1);           // ep-2 inventoried, lacks it
    expect(json.coverage.neverInventoried).toBe(1);        // ep-3 has never reported

    // The arithmetic that matters: an endpoint nothing has ever looked at is
    // NOT counted as lacking the software. Folding them would make this 2.
    expect(json.coverage.noneInstalled).not.toBe(2);

    const app = json.applications[0];
    expect(app.installedOn).toBe(1);
    expect(app.notInstalledOn).toBe(1);
    expect(app.neverInventoriedOn).toBe(1);
    expect(app.notInstalledEndpoints).toEqual(["WIN10CLIENT2"]);
    expect(app.neverInventoriedEndpoints).toEqual(["WIN10CLIENT3"]);
  });

  it("a 404 carries the MEASUREMENT declared at that call, not just the generic causes", async () => {
    // ARCH-1, 2026-08-14. These three reads sit in ONE Promise.all, so each
    // carries its own declaration as an argument to readRows — nothing scoped
    // to the statement or the function could tell them apart.
    //
    // This assertion is what stops that argument becoming decoration. It was
    // added because a mutation that dropped the measured reason from
    // paged-read.ts's 404 note SURVIVED the whole suite: the sibling assertion
    // in endpoint-briefing.test.ts only covers that file's own copy of
    // readRows, and this shared one had nothing watching it.
    mockApi.use(http.get(MEMBERS, () => HttpResponse.json({}, { status: 404 })));
    const { json } = await call();
    const text = JSON.stringify(json);
    expect(text).toMatch(/Measured for this route: Measured 2026-08-14/i);
    expect(text).toMatch(/19 of 19 logical groups answer 200/i);
    // Appended, not substituted — one estate's measurement retires no cause.
    expect(text).toMatch(/does NOT mean zero/i);
    expect(json.meta.resultTrustworthy).toBe(false);
  });

  it("says in the headline that a never-scanned endpoint is not a missing install", async () => {
    const { json } = await call();
    const headline = json.headline.join(" ");
    expect(headline).toMatch(/NEVER reported software inventory/i);
    expect(headline).toMatch(/never as "not installed"/i);
  });

  it("a STALE inventory still answers — the verdict stands, dated", async () => {
    // THE CORRECTION. ep-2 reports other software, last scanned 400 days ago.
    // The earlier design called this UNKNOWN and threw the answer away. The
    // snapshot says the app was not on that machine when it was last looked at,
    // which is a fact, so it is reported as notInstalled and dated.
    mockApi.use(http.get(INSTALLED, () => HttpResponse.json(page([
      sw("ep-1", "WIN10CLIENT1", APP),
      sw("ep-2", "WIN10CLIENT2", "some-other-app-id", 400),
    ]))));
    const { json } = await call();

    expect(json.coverage.noneInstalled).toBe(1);
    // Only ep-3, which has no inventory at all, is unknown.
    expect(json.coverage.neverInventoried).toBe(1);

    const ep2 = (json.endpoints as Array<Record<string, unknown>>).find((e) => e.endpoint === "WIN10CLIENT2")!;
    expect(ep2.verdicts).toEqual({ KIOSKTEST: "notInstalled" });
    // …and the age travels WITH the verdict, so nobody reads it as "today".
    expect(ep2.inventoryAgeDays).toBeGreaterThan(390);
    expect(ep2.inventoryAsOf).toBeTruthy();
    expect(String(ep2.inventoryEvidence)).toMatch(/as of then, not today/);
    // Counted as an old answer, not subtracted from the answers.
    expect(json.coverage.answersOlderThanThreshold).toBe(1);
    expect(json.headline.join(" ")).toMatch(/older than 30 days/);
  });

  it("the age threshold changes the LABEL, never the verdict", async () => {
    mockApi.use(http.get(INSTALLED, () => HttpResponse.json(page([
      sw("ep-1", "WIN10CLIENT1", APP),
      sw("ep-2", "WIN10CLIENT2", "some-other-app-id", 400),
    ]))));
    // Same data, a threshold that makes the 400-day snapshot "current".
    const { json } = await call({ inventoryStaleAfterDays: 3650 });

    expect(json.coverage.noneInstalled).toBe(1);          // unchanged
    expect(json.coverage.neverInventoried).toBe(1);       // unchanged
    expect(json.coverage.answersOlderThanThreshold).toBe(0); // only this moves
  });

  it("names WHY a never-inventoried endpoint is unknown rather than leaving a null", async () => {
    const { json } = await call();
    const ep3 = (json.endpoints as Array<Record<string, unknown>>).find((e) => e.endpoint === "WIN10CLIENT3");
    expect(String(ep3?.inventoryEvidence)).toMatch(/never reported software/i);
  });
});

describe("the join is on applicationId, not on name", () => {
  it("does not match a same-named application carrying a different id", async () => {
    mockApi.use(http.get(INSTALLED, () => HttpResponse.json(page([
      // Same display name, different application — a name match would call this installed.
      { ...sw("ep-1", "WIN10CLIENT1", "a-different-application-id"), name: "KIOSKTEST" },
    ]))));
    const { json } = await call();

    expect(json.coverage.allApplicationsPresent).toBe(0);
    expect(json.applications[0].installedOn).toBe(0);
  });
});

describe("a short-served read must not read as better coverage", () => {
  it("breaks trust when the member list is short — the denominator shrinks", async () => {
    // The live-measured empty-page state on the member read: server says 9,
    // serves 3. Coverage over 3 would look far better than reality.
    mockApi.use(http.get(MEMBERS, () => HttpResponse.json(page([member(1), member(2), member(3)], 9))));
    const { json } = await call();

    expect(json.meta.resultTrustworthy).toBe(false);
    expect(json.meta.resultTrustworthyReasons.join(" ")).toMatch(/9/);
    expect(json.headline.join(" ")).toMatch(/INCOMPLETE/);
    expect(json.headline.join(" ")).toMatch(/OVERSTATES/i);
  });

  it("breaks trust when the installed-software read is short", async () => {
    mockApi.use(http.get(INSTALLED, () => HttpResponse.json(page([sw("ep-1", "WIN10CLIENT1", APP)], 242))));
    const { json } = await call();
    expect(json.meta.resultTrustworthy).toBe(false);
  });

  it("a failed read reports that it cannot answer, NOT zero coverage", async () => {
    mockApi.use(http.get(MEMBERS, () => new HttpResponse(null, { status: 403 })));
    const { json } = await call();

    expect(json.coverage).toBeNull();
    expect(json.meta.resultTrustworthy).toBe(false);
    expect(json.headline.join(" ")).toMatch(/NOT a report of zero coverage/);
  });
});

describe("controls — a healthy deployment reads as healthy", () => {
  it("all members inventoried and holding the app: trustworthy, nothing undetermined", async () => {
    mockApi.use(http.get(INSTALLED, () => HttpResponse.json(page([
      sw("ep-1", "WIN10CLIENT1", APP),
      sw("ep-2", "WIN10CLIENT2", APP),
      sw("ep-3", "WIN10CLIENT3", APP),
    ]))));
    const { json } = await call();

    expect(json.coverage.allApplicationsPresent).toBe(3);
    expect(json.coverage.noneInstalled).toBe(0);
    expect(json.coverage.neverInventoried).toBe(0);
    expect(json.meta.resultTrustworthy).toBe(true);
    expect(json.meta.resultTrustworthyReasons).toEqual([]);
    expect(json.headline.join(" ")).not.toMatch(/INCOMPLETE/);
  });

  it("flags members that could not receive a redeployment anyway", async () => {
    mockApi.use(http.get(MEMBERS, () => HttpResponse.json(page([
      member(1, 1), member(2, 90), member(3, 1),
    ]))));
    const { json } = await call();

    expect(json.coverage.unreachable).toBe(1);
    expect(json.headline.join(" ")).toMatch(/queue rather than run/);
  });

  it("is a fraction of the hand-walk it replaces", async () => {
    const { bytes } = await call();
    // The live hand-walk measured 113,389 B. This fixture is far smaller than
    // the estate, so the assertion is on ORDER of magnitude, not the ratio.
    expect(bytes).toBeLessThan(4_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The empty bundle — the vacuity case
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `nInstalled === bundleApps.length` is TRUE for every member when the bundle
 * has no applications, so an empty bundle reported every endpoint as fully
 * covered. The arm directly above it carries an explicit `bundleApps.length > 0`
 * guard — someone thought about the empty case for `neverInventoried` and not
 * for its neighbour, which is what makes this an oversight rather than a
 * decision.
 *
 * The headline already said "nothing to verify", so a human reading top-down
 * was safe. The machine-readable block said 3-of-3 covered, and that is the
 * half a model summarises. "Nothing was checked" must not render as "everything
 * passed" — the rule this suite is built on.
 *
 * Two ways to reach it: a genuinely empty bundle, and a bundle whose rows all
 * lack `applicationId` (they are filtered out, so `bundleApps` empties while
 * `totalItems` still counts them — no shortfall fires either).
 */
describe("a bundle with no applications verifies nothing, and says so", () => {
  it("does not report every member as fully covered", async () => {
    mockApi.use(http.get(APPS, () => HttpResponse.json(page([]))));
    const { json } = await call();

    const coverage = json.coverage as Record<string, number>;
    // Vacuity: the members really are there, so this is not passing over an
    // empty group.
    expect(coverage.membersExamined).toBe(3);
    // The property: nothing was verified, so nothing may be reported as passing.
    expect(coverage.allApplicationsPresent).toBe(0);
    // ...and not silently reclassified as a failure either. "No applications to
    // install" is not "none of them are installed".
    expect(coverage.noneInstalled).toBe(0);
    expect(coverage.partiallyPresent).toBe(0);
  });

  it("still says plainly in the headline that there was nothing to verify", async () => {
    mockApi.use(http.get(APPS, () => HttpResponse.json(page([]))));
    const { json } = await call();
    expect((json.headline as string[]).join(" ")).toMatch(/nothing to verify/i);
  });

  it("treats a bundle whose rows carry no applicationId the same way", async () => {
    // `bundleApps` is filtered on `applicationId`, so these rows vanish while
    // the envelope still counts them — the shortfall guard cannot see it.
    mockApi.use(
      http.get(APPS, () => HttpResponse.json(page([{ name: "no id here" }, { name: "nor here" }]))),
    );
    const { json } = await call();

    const coverage = json.coverage as Record<string, number>;
    expect(coverage.membersExamined).toBe(3);
    expect(coverage.allApplicationsPresent).toBe(0);
  });
});
