/**
 * get_estate_risk_briefing, driven through the REAL tool handler.
 *
 * Not through `buildEstateRiskBriefing` directly: a unit test of a composite
 * proves nothing about whether the tool calls it, and this project has already
 * had a whole projection test file stay green while the dispatch arm that used
 * it was reverted. Everything below goes over InMemoryTransport with bConnect
 * mocked by msw, so the handler, the validator, the gate and the serialiser
 * are all in the path.
 *
 * The load-bearing behaviour is DEGRADE PER DIMENSION: four modules, and the
 * briefing must survive any of them failing while saying which one it lost.
 * That is asserted by failing each in turn, not by inspection.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../index.js";

const BASE = "http://bms.test.local/bconnect";
const BITLOCKER = `${BASE}/defensecontrol/v2.0/BitLocker/WindowsEndpoints`;
const DEFENDER = `${BASE}/defensecontrol/v2.0/MicrosoftDefender/WindowsEndpoints`;
const VULNS = `${BASE}/compliance/v2.0/DetectedVulnerabilities`;
const ENDPOINTS = `${BASE}/endpoints/v2.0/Endpoints`;

/**
 * Ages are relative to the REAL clock, because the code under test uses it.
 *
 * This was `Date.parse("2026-08-12T00:00:00Z")` — a frozen "now" chosen so ages
 * would be "arithmetic, not weather". It made them weather anyway, and the test
 * detonated on 2026-08-19: a definition written as `daysAgo(1)` was pinned to
 * 2026-08-11, and once real time passed the 7-day `staleDefinitionsAfterDays`
 * default it counted as stale, so `definitionsStale` went 1 → 2.
 *
 * The frozen constant only works when the code consuming it is ALSO frozen.
 * `buildEstateRiskBriefing` accepts an injected `now` for exactly that, but this
 * file drives the REAL tool handler on purpose — a unit test of the composite
 * proves nothing about whether the tool calls it — and the handler has no `now`
 * parameter, nor should it. So the fixture was anchored to one clock and read
 * against another, and the gap between them was time.
 *
 * Relative to `Date.now()`, every assertion below keeps the meaning it was
 * written with: `daysAgo(1)` is fresh forever and `daysAgo(400)` is ancient
 * forever, on any day the suite is ever run.
 */
const NOW = Date.now();
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const page = (rows: unknown[], totalItems = rows.length) => ({
  currentPage: 0, pageSize: 200, totalPages: 1, totalItems,
  hasPreviousPage: false, hasNextPage: false, data: rows,
});

const bitlockerRows = [
  { endpointName: "WIN11CLIENT1", tpmData: { tpmStatus: "Enabled" },
    storageMedia: [{ storageVolumes: [{ isSystemVolume: true, bitLockerVolumeData: { protectionStatus: "Protected" } }] }] },
  { endpointName: "WIN10CLIENT3", tpmData: { tpmStatus: "NotEnabled" },
    storageMedia: [{ storageVolumes: [{ isSystemVolume: true, bitLockerVolumeData: { protectionStatus: "Unprotected" } }] }] },
  { endpointName: "WIN10CLIENT4", tpmData: { tpmStatus: "Enabled" }, storageMedia: [{ storageVolumes: [] }] },
];

const defenderRows = [
  { endpointName: "WIN11CLIENT1", isMicrosoftDefenderActive: true,
    microsoftDefenderState: { antivirus: { isActive: true, definitionCreation: daysAgo(1), definitionVersion: "1.1" } } },
  { endpointName: "WIN10CLIENT3", isMicrosoftDefenderActive: false,
    microsoftDefenderState: { antivirus: { isActive: false, definitionCreation: daysAgo(400), definitionVersion: "1.0" } } },
];

const vulnRows = [
  { endpointName: "WIN10CLIENT3", cveId: "CVE-2026-1", ignored: false },
  { endpointName: "WIN10CLIENT3", cveId: "CVE-2026-2", ignored: false },
  { endpointName: "WIN11CLIENT1", cveId: "CVE-2026-1", ignored: false },
  { endpointName: "WIN11CLIENT1", cveId: "CVE-2026-9", ignored: true },
];

const endpointRows = [
  { displayName: "WIN11CLIENT1", lastSeen: daysAgo(1) },
  { displayName: "WIN10CLIENT3", lastSeen: daysAgo(120) },
  { displayName: "NEVERSEEN1", lastSeen: null },
];

/**
 * All four dimensions healthy. Individual tests override one at a time.
 *
 * totalItems matches the rows served: a fixture claiming 2,456 items while
 * serving 4 rows is the SHORT-SERVE shape (measured live 2026-08-12), which
 * now correctly breaks trust — estate-risk-shortfall.test.ts owns that case.
 * The estate-total-vs-sample distinction is asserted there too, with a fixture
 * that serves a FULL page of a larger set.
 */
const healthy = [
  http.get(BITLOCKER, () => HttpResponse.json(page(bitlockerRows))),
  http.get(DEFENDER, () => HttpResponse.json(page(defenderRows))),
  http.get(VULNS, () => HttpResponse.json(page(vulnRows))),
  http.get(ENDPOINTS, () => HttpResponse.json(page(endpointRows))),
];

const mockApi = setupServer(...healthy);
beforeAll(() => mockApi.listen({ onUnhandledRequest: "error" }));
afterAll(() => mockApi.close());
afterEach(() => mockApi.resetHandlers(...healthy));

async function brief(args: Record<string, unknown> = {}) {
  const { server } = createServer({ apiKey: "test-key", baseUrl: BASE });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "risk-probe", version: "1.0.0" }, { capabilities: {} });
  await client.connect(ct);
  const res = await client.callTool({ name: "get_estate_risk_briefing", arguments: args });
  const text = (res.content as Array<{ text: string }>)[0].text;
  return { text, json: JSON.parse(text) as Record<string, any>, isError: res.isError as boolean | undefined };
}

describe("the briefing answers all four dimensions in one call", () => {
  it("reads encryption, Defender, vulnerabilities and reporting together", async () => {
    const { json } = await brief();
    expect(json.encryption.available).toBe(true);
    expect(json.encryption.systemVolumeUnprotected).toBe(1);
    expect(json.encryption.systemVolumeProtected).toBe(1);
    expect(json.encryption.noBitLockerVolumeData).toBe(1);
    expect(json.encryption.tpmNotEnabled).toBe(1);

    expect(json.defender.inactive).toBe(1);
    expect(json.defender.definitionsStale).toBe(1);
    expect(json.defender.worstDefinitionAgeDays).toBeGreaterThan(390);

    // The estate-total-vs-sample distinction is asserted in
    // estate-risk-shortfall.test.ts with a full-page fixture.
    expect(json.vulnerabilities.detectionsInEstate).toBe(4);
    expect(json.vulnerabilities.detectionsExamined).toBe(4);
    expect(json.vulnerabilities.ignoredInSample).toBe(1);
    expect(json.vulnerabilities.endpointsAffectedInSample).toBe(2);

    expect(json.endpoints.notReporting).toBe(1);
    expect(json.endpoints.neverSeen).toBe(1);
    expect(json.endpoints.currentlyReporting).toBe(1);
  });

  it("is trustworthy and says so when every dimension was read", async () => {
    const { json } = await brief();
    expect(json.meta.resultTrustworthy).toBe(true);
    expect(json.meta.dimensionsRead).toBe(4);
    expect(json.meta.resultTrustworthyReasons).toEqual([]);
    expect(json.headline.join(" ")).not.toMatch(/INCOMPLETE/);
  });

  it("discloses the credential scope in the SERIALISED result, trustworthy or not", async () => {
    // Through the handler and the serialiser, not off the builder's return
    // value. `suite-credential-scope-disclosure` proves the module names the
    // constant; a field can still be named there and never reach the caller,
    // and this project has had a projection test stay green over a reverted
    // dispatch arm before.
    //
    // Asserted beside `resultTrustworthy: true` on purpose. That combination —
    // a green completeness flag over an estate the key was only partly shown —
    // is the entire defect: measured live, this tool answered "19 of 23
    // endpoints examined" to a full key and "9 of 9" to a scoped one, both
    // trustworthy. The disclosure has to be there in exactly the case that
    // looks fine.
    const { json, text } = await brief();
    expect(json.meta.resultTrustworthy).toBe(true);
    expect(json.meta.credentialScope).toMatch(/THIS API KEY MAY SEE/);
    expect(json.meta.credentialScope).toMatch(/never 'none exist'/);
    expect(text).toContain("THIS API KEY MAY SEE");
  });

  it("leads with plain sentences, because prose is what a model acts on", async () => {
    const { json } = await brief();
    expect(Array.isArray(json.headline)).toBe(true);
    expect(json.headline.join(" ")).toMatch(/unencrypted system volume/);
    expect(json.headline.join(" ")).toMatch(/Defender inactive/);
  });
});

describe("degrade per dimension, never fail whole", () => {
  const FAILURES: Array<[string, string, () => void]> = [
    ["encryption", BITLOCKER, () => mockApi.use(http.get(BITLOCKER, () => HttpResponse.json({}, { status: 500 })))],
    ["defender", DEFENDER, () => mockApi.use(http.get(DEFENDER, () => HttpResponse.json({}, { status: 500 })))],
    ["vulnerabilities", VULNS, () => mockApi.use(http.get(VULNS, () => HttpResponse.json({}, { status: 500 })))],
    ["endpoints", ENDPOINTS, () => mockApi.use(http.get(ENDPOINTS, () => HttpResponse.json({}, { status: 500 })))],
  ];

  for (const [dimension, , breakIt] of FAILURES) {
    it(`survives ${dimension} failing, and names it`, async () => {
      breakIt();
      const { json, isError } = await brief();

      // The whole point: a tool result, not an error, and the other three
      // dimensions still answered.
      expect(isError).toBeFalsy();
      expect(json[dimension].available).toBe(false);
      expect(json[dimension].reason).toBeTruthy();

      const others = ["encryption", "defender", "vulnerabilities", "endpoints"].filter((d) => d !== dimension);
      for (const other of others) {
        expect(json[other].available, `${other} must survive ${dimension} failing`).toBe(true);
      }

      // …and it must be impossible to read the result as an all-clear.
      expect(json.meta.resultTrustworthy).toBe(false);
      expect(json.meta.dimensionsRead).toBe(3);
      expect(json.meta.resultTrustworthyReasons.join(" ")).toContain(dimension);
      expect(json.headline[0]).toMatch(/^INCOMPLETE: 1 of 4 dimensions/);
      expect(json.headline[0]).toContain(dimension);
    });
  }

  it("survives a TRANSPORT failure, not just an HTTP error status", async () => {
    // Found by falsification: every other test here fails a dimension with an
    // HTTP status, and `validateStatus: () => true` means axios resolves those
    // rather than throwing — so readPage's try/catch, the branch that handles
    // a bMS that is simply unreachable, was never executed by any test. A
    // mutation making that catch rethrow left the whole file green.
    //
    // HttpResponse.error() is a genuine network failure, which is the shape a
    // DNS failure, a dropped VPN or a firewalled DMZ actually has.
    mockApi.use(http.get(DEFENDER, () => HttpResponse.error()));
    const { json, isError } = await brief();

    expect(isError).toBeFalsy();
    expect(json.defender.available).toBe(false);
    expect(json.defender.reason).toMatch(/could not be reached/);
    expect(json.encryption.available).toBe(true);
    expect(json.endpoints.available).toBe(true);
    expect(json.meta.resultTrustworthy).toBe(false);
  });

  it("reports a 403 as a scoped-away credential rather than an outage", async () => {
    // The state a least-privileged deployment is actually in: a key that may
    // read endpoints but not compliance. It must be legible as such.
    mockApi.use(http.get(VULNS, () => HttpResponse.json({}, { status: 403 })));
    const { json } = await brief();
    expect(json.vulnerabilities.available).toBe(false);
    expect(json.vulnerabilities.reason).toMatch(/may not read/);
    expect(json.vulnerabilities.reason).toMatch(/403/);
    expect(json.endpoints.available).toBe(true);
  });

  it("survives every dimension failing at once without throwing", async () => {
    for (const [, url] of FAILURES) {
      mockApi.use(http.get(url, () => HttpResponse.json({}, { status: 500 })));
    }
    const { json, isError } = await brief();
    expect(isError).toBeFalsy();
    expect(json.meta.dimensionsRead).toBe(0);
    expect(json.headline[0]).toMatch(/^INCOMPLETE: 4 of 4 dimensions/);
    expect(json.meta.resultTrustworthy).toBe(false);
  });
});

describe("counts are exact; name lists are capped and say so", () => {
  it("caps the names and discloses the cap", async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      endpointName: `WIN-${String(i).padStart(2, "0")}`,
      tpmData: { tpmStatus: "Enabled" },
      storageMedia: [{ storageVolumes: [{ isSystemVolume: true, bitLockerVolumeData: { protectionStatus: "Unprotected" } }] }],
    }));
    mockApi.use(http.get(BITLOCKER, () => HttpResponse.json(page(many))));

    const { json } = await brief({ maxNamed: 5 });
    // The count is exact...
    expect(json.encryption.systemVolumeUnprotected).toBe(25);
    // ...the list is not, and it says so rather than implying 5 is all of them.
    expect(json.encryption.unprotectedEndpoints.names).toHaveLength(5);
    expect(json.encryption.unprotectedEndpoints.namedShown).toBe(5);
    expect(json.encryption.unprotectedEndpoints.namedTotal).toBe(25);
    expect(json.encryption.unprotectedEndpoints.namedNote).toMatch(/capped at maxNamed=5/);
  });

  it("omits the cap disclosure when nothing was capped", async () => {
    // The vacuity guard: a note that always appears teaches a reader nothing.
    const { json } = await brief({ maxNamed: 50 });
    expect(json.encryption.unprotectedEndpoints.namedNote).toBeUndefined();
    expect(json.encryption.unprotectedEndpoints.namedTotal).toBeUndefined();
  });
});

describe("the tool refuses malformed questions before it touches bMS", () => {
  it("rejects an out-of-range pageSize", async () => {
    // pageSize is lowercase here, unlike the paged list tools' PageSize; the
    // rule is written out for exactly that reason and this is what proves it
    // is wired to the right parameter name.
    await expect(brief({ pageSize: 5000 })).rejects.toThrow(/pageSize/);
  });

  it("rejects a negative staleness window", async () => {
    await expect(brief({ staleEndpointAfterDays: -1 })).rejects.toThrow(/staleEndpointAfterDays/);
  });

  it("rejects a parameter it does not declare", async () => {
    await expect(brief({ nonsense: true })).rejects.toThrow();
  });
});

describe("estate text is sanitised on the way out", () => {
  it("strips control characters from an endpoint name", async () => {
    const hostile = `WIN​CLIENT‮X`;
    mockApi.use(http.get(BITLOCKER, () => HttpResponse.json(page([{
      endpointName: hostile, tpmData: { tpmStatus: "Enabled" },
      storageMedia: [{ storageVolumes: [{ isSystemVolume: true, bitLockerVolumeData: { protectionStatus: "Unprotected" } }] }],
    }]))));
    const { text, json } = await brief();
    expect(json.encryption.unprotectedEndpoints.names[0]).not.toMatch(/[​‮]/);
    expect(text).not.toContain("‮");
  });
});
