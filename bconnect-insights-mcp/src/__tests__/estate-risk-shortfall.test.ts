/**
 * Shortfall and dishonest-date regressions for get_estate_risk_briefing,
 * driven through the REAL tool handler (InMemoryTransport + msw), because a
 * unit test of the module proves nothing about whether the tool calls it.
 *
 * The inputs are not hypothetical:
 *
 *  - The bConnect API was MEASURED (live, 2026-08-12) answering HTTP 200 with
 *    `data: []` while the envelope header stayed intact (totalItems > 0), and
 *    claiming totals its stream never serves. Before the fix, that state made
 *    every warning silently vanish from the headline — 19 unencrypted
 *    machines, 17 stale AV definitions, 19 silent endpoints, all gone — while
 *    `resultTrustworthy` stayed true.
 *  - `definitionCreation: "0001-01-01T00:00:00"` was OBSERVED live when a
 *    machine powered on mid-session, and this module still reported it as a
 *    739,839-day-old definition: the exact defect class already fixed in
 *    endpoint-briefing and mcp-core, reappearing in the estate-wide briefing
 *    because this module never imported the helpers.
 *
 * The distinction the fix must hold: a SHORT-SERVED page (fewer rows than the
 * requested pageSize while totalItems says more exist — the empty page is the
 * extreme case) breaks trust; a SAMPLE BY DESIGN (exactly pageSize rows of a
 * larger set) is this tool's documented read model and must stay trustworthy,
 * disclosed via meta.truncated. And a genuinely empty estate (totalItems 0)
 * is clean, not suspicious — the controls pin both.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../index.js";

const BASE = "http://bms.shortfall.local/bconnect";
const BITLOCKER = `${BASE}/defensecontrol/v2.0/BitLocker/WindowsEndpoints`;
const DEFENDER = `${BASE}/defensecontrol/v2.0/MicrosoftDefender/WindowsEndpoints`;
const VULNS = `${BASE}/compliance/v2.0/DetectedVulnerabilities`;
const ENDPOINTS = `${BASE}/endpoints/v2.0/Endpoints`;

const DAY_MS = 86_400_000;

const page = (rows: unknown[], totalItems = rows.length) => ({
  currentPage: 0, pageSize: 200, totalPages: 1, totalItems,
  hasPreviousPage: false, hasNextPage: false, data: rows,
});

const emptyBut = (totalItems: number) => page([], totalItems);

/** Baseline: every dimension genuinely empty, so single-dimension tests can override one. */
const allEmpty = [
  http.get(BITLOCKER, () => HttpResponse.json(page([]))),
  http.get(DEFENDER, () => HttpResponse.json(page([]))),
  http.get(VULNS, () => HttpResponse.json(page([]))),
  http.get(ENDPOINTS, () => HttpResponse.json(page([]))),
];

const mockApi = setupServer(...allEmpty);
beforeAll(() => mockApi.listen({ onUnhandledRequest: "error" }));
afterAll(() => mockApi.close());
afterEach(() => mockApi.resetHandlers(...allEmpty));

async function brief(args: Record<string, unknown> = {}) {
  const { server } = createServer({ apiKey: "test-key", baseUrl: BASE });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "shortfall-probe", version: "1.0.0" }, { capabilities: {} });
  await client.connect(ct);
  const res = await client.callTool({ name: "get_estate_risk_briefing", arguments: args });
  const text = (res.content as Array<{ text: string }>)[0].text;
  return { text, json: JSON.parse(text) as Record<string, any> };
}

describe("an empty page under an intact header is an incident, not a clean estate", () => {
  it("breaks trust and says INCOMPLETE when every dimension is served 0 rows with totalItems > 0", async () => {
    mockApi.use(
      http.get(BITLOCKER, () => HttpResponse.json(emptyBut(23))),
      http.get(DEFENDER, () => HttpResponse.json(emptyBut(23))),
      http.get(VULNS, () => HttpResponse.json(emptyBut(2454))),
      http.get(ENDPOINTS, () => HttpResponse.json(emptyBut(26))),
    );
    const { json } = await brief();

    expect(json.meta.resultTrustworthy).toBe(false);
    // The reasons carry the disagreement itself: rows served vs the server's own count.
    expect(json.meta.resultTrustworthyReasons.join(" ")).toMatch(/23/);
    expect(json.meta.resultTrustworthyReasons.join(" ")).toMatch(/not read/);
    // The headline must lead with the incompleteness, not with silence.
    expect(json.headline.join(" ")).toMatch(/INCOMPLETE/);
    // And it must never render the all-clear sentence over unread data.
    expect(json.headline.join(" ")).not.toMatch(/No exposure found/);
  });

  it("breaks trust when a single dimension is short-served, and names that dimension", async () => {
    mockApi.use(http.get(BITLOCKER, () => HttpResponse.json(emptyBut(23))));
    const { json } = await brief();

    expect(json.meta.resultTrustworthy).toBe(false);
    expect(json.meta.resultTrustworthyReasons.join(" ")).toMatch(/encryption/);
  });

  it("a 200 whose body is not the paged envelope is a shape mismatch, not an empty page", async () => {
    mockApi.use(http.get(BITLOCKER, () => HttpResponse.json({ message: "maintenance" })));
    const { json } = await brief();

    expect(json.encryption.available).toBe(false);
    expect(json.meta.resultTrustworthy).toBe(false);
  });
});

describe("dates that are not ages are never reported as ages", () => {
  it("a sentinel definitionCreation is NOT a 739,839-day-old definition", async () => {
    mockApi.use(http.get(DEFENDER, () => HttpResponse.json(page([{
      endpointName: "SENTINEL-PC",
      isMicrosoftDefenderActive: true,
      microsoftDefenderState: { antivirus: { isActive: true, definitionCreation: "0001-01-01T00:00:00", definitionVersion: "0.0" } },
    }]))));
    const { json } = await brief();

    expect(json.defender.definitionAgeUnknown).toBe(1);
    expect(json.defender.definitionsStale).toBe(0);
    expect(json.defender.worstDefinitionAgeDays).toBeNull();
    // Nothing anywhere in the dimension may carry a multi-century age.
    expect(JSON.stringify(json.defender)).not.toMatch(/7398\d\d/);
  });

  it("a sentinel lastSeen is NEVER SEEN, not silent-for-739,839-days", async () => {
    mockApi.use(http.get(ENDPOINTS, () => HttpResponse.json(page([
      { displayName: "SENTINEL-EP", lastSeen: "0001-01-01T00:00:00" },
    ]))));
    const { json } = await brief();

    expect(json.endpoints.neverSeen).toBe(1);
    expect(json.endpoints.notReporting).toBe(0);
    expect(JSON.stringify(json.endpoints)).not.toMatch(/7398\d\d/);
  });

  it("a lastSeen days in the FUTURE is a clock fault with an UNKNOWN age, not a healthy check-in", async () => {
    mockApi.use(http.get(ENDPOINTS, () => HttpResponse.json(page([
      { displayName: "FUTURE-EP", lastSeen: new Date(Date.now() + 3 * DAY_MS).toISOString() },
    ]))));
    const { json } = await brief();

    expect(json.endpoints.currentlyReporting).toBe(0);
    expect(json.endpoints.ageUnknown).toBe(1);
    // The disagreement is stated, not absorbed.
    expect(json.headline.join(" ")).toMatch(/FUTURE|clock/i);
  });

  it("an unparseable lastSeen surfaces in the headline, not just in a body-level count", async () => {
    // NOT the bMS locale display string ("12.08.2026 11:41:54") — V8's lenient
    // parser reads that as a valid US-style date, which is a different fault
    // (it lands in futureSeen, with its own headline). This input is
    // deterministically NaN in every engine. The old code routed it into
    // neverSeen (which at least reached the headline); folding it silently into
    // ageUnknown let a machine whose reporting state is unknowable read as
    // absence of risk in the prose (adversarial review, M4).
    mockApi.use(http.get(ENDPOINTS, () => HttpResponse.json(page([
      { displayName: "GARBLED-EP", lastSeen: "seen at breakfast, probably" },
    ]))));
    const { json } = await brief();

    expect(json.endpoints.ageUnknown).toBe(1);
    expect(json.endpoints.futureSeen).toBe(0);
    expect(json.headline.join(" ")).toMatch(/cannot be read/);
    expect(json.headline.join(" ")).not.toMatch(/No exposure found/);
  });

  it("ordinary clock skew is absorbed: seconds in the future still counts as reporting", async () => {
    mockApi.use(http.get(ENDPOINTS, () => HttpResponse.json(page([
      { displayName: "SKEW-EP", lastSeen: new Date(Date.now() + 30_000).toISOString() },
    ]))));
    const { json } = await brief();

    expect(json.endpoints.currentlyReporting).toBe(1);
    expect(json.endpoints.ageUnknown).toBe(0);
  });
});

describe("a total that is absent or unreadable never silences the sample", () => {
  it("reports the examined detections when totalItems is ABSENT — a legal 200, the envelope requires no field", async () => {
    // Probed 2026-08-22 before the fix: detection rows in hand, total absent,
    // and the briefing said "No exposure found in any of the four dimensions
    // examined" with resultTrustworthy true — the only dimension whose
    // headline keyed on the API's TOTAL rather than the examined sample.
    mockApi.use(http.get(VULNS, () => HttpResponse.json({ data: [
      { endpointName: "EP1", cveId: "CVE-2026-1" },
      { endpointName: "EP2", cveId: "CVE-2026-2" },
    ] })));
    const { json } = await brief();

    expect(json.vulnerabilities.detectionsExamined).toBe(2);
    expect(json.headline.join(" ")).toMatch(/at least 2 vulnerability detection/);
    expect(json.headline.join(" ")).not.toMatch(/No exposure found/);
  });

  it("a STRING totalItems is a shape mismatch, loud — not a silent truncated:false", async () => {
    // Probed 2026-08-22 before the fix: 5 rows under totalItems "9" reported
    // truncated: false — present-but-unreadable absorbed as absent, the same
    // shape shortfallReason and paginateAll carried until 2026-08-19.
    mockApi.use(http.get(VULNS, () => HttpResponse.json({
      data: [{ endpointName: "EP1", cveId: "CVE-2026-1" }],
      totalItems: "27",
    })));
    const { json } = await brief();

    expect(json.vulnerabilities.available).toBe(false);
    expect(String(json.vulnerabilities.reason)).toMatch(/totalItems/);
    expect(json.meta.resultTrustworthy).toBe(false);
    expect(json.headline.join(" ")).toMatch(/INCOMPLETE/);
  });
});

describe("controls — the guard must stay quiet where nothing is wrong", () => {
  it("a genuinely empty estate (totalItems 0 everywhere) is clean and trustworthy", async () => {
    const { json } = await brief();

    expect(json.meta.resultTrustworthy).toBe(true);
    expect(json.meta.resultTrustworthyReasons).toEqual([]);
    expect(json.headline.join(" ")).toMatch(/No exposure found/);
  });

  it("a full page of a larger set is a SAMPLE, disclosed and still trustworthy", async () => {
    // Exactly pageSize rows arrive and totalItems says more exist: the tool got
    // everything it asked for. That is its documented read model, not a fault.
    const rows = Array.from({ length: 50 }, (_, i) => ({
      endpointName: `EP-${i}`, cveId: `CVE-2026-${i}`, ignored: false,
    }));
    mockApi.use(http.get(VULNS, () => HttpResponse.json({ ...page(rows, 2454), pageSize: 50 })));
    const { json } = await brief({ pageSize: 50 });

    expect(json.meta.resultTrustworthy).toBe(true);
    expect(json.vulnerabilities.detectionsInEstate).toBe(2454);
    expect(json.vulnerabilities.detectionsExamined).toBe(50);
    // Disclosed as a partial read, the same way the sibling composites do it.
    expect(json.meta.truncated).toContain("vulnerabilities");
  });
});
