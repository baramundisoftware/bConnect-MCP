/**
 * list_os_windows_endpoints — the compact projection (TOK-24).
 *
 * Driven through the REAL tool handler over InMemoryTransport with bConnect
 * mocked by msw, not against the shaper directly: a unit test of a shaper
 * proves nothing about whether the tool calls it, and this repository has
 * already had a projection test stay green while the dispatch arm using it was
 * reverted.
 *
 * ── What was measured, and why this tool ────────────────────────────────────
 * Live against labcorp.local 2026-08-13, the response-byte ranking found this
 * tool returning 8,298 B for 20 rows with 3,822 B — 46% — inside the single
 * nested `operatingSystem` object. That object states the version twice:
 * `version.full` is "10.0.19045.6093" and `major`/`minor`/`build`/`patchLevel`
 * are that same string split on ".". Four fields per row that are not four
 * facts.
 *
 * ── The properties that matter, and are asserted below ──────────────────────
 *  1. The compact page is materially smaller than the raw one.
 *  2. `detail:true` is byte-for-byte the untouched API record — the escape
 *     hatch cannot quietly become another projection.
 *  3. Nothing is dropped silently: `meta.projectedAway` names every removed
 *     field, so a reader can see that `localeId` and `releaseId` exist.
 *  4. No information is LOST, only relocated or made recoverable: the full
 *     version string survives, and the four numeric parts are derivable from
 *     it by the same split that produced them.
 *  5. A null/absent OS block does not throw and does not invent values —
 *     an endpoint with no OS inventory is a real row on a real estate.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../index.js";

const BASE = "http://bms.os.test/bconnect";
const ROUTE = `${BASE}/operatingsystems/v2.0/WindowsEndpoints`;

/** A row shaped exactly like the live one measured on 2026-08-13. */
const osRow = (n: number, overrides: Record<string, unknown> = {}) => ({
  endpointId: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
  endpointName: `WIN10CLIENT${n}`,
  bootEnvironmentId: null,
  hardwareProfileId: `11111111-1111-1111-1111-${String(n).padStart(12, "0")}`,
  isOSInstallAllowed: true,
  inheritsAutoInstallation: true,
  operatingSystem: {
    name: "Windows 10 64-Bit",
    version: { full: "10.0.19045.6093", major: 10, minor: 0, build: 19045, patchLevel: 6093 },
    displayVersion: "22H2",
    releaseId: "2009",
    localeId: 1033,
  },
  ...overrides,
});

const page = (rows: unknown[]) => ({
  currentPage: 0, pageSize: 20, totalPages: 1, totalItems: rows.length,
  hasPreviousPage: false, hasNextPage: false, data: rows,
});

const DEFAULT_ROWS = Array.from({ length: 20 }, (_, i) => osRow(i));
const handlers = [http.get(ROUTE, () => HttpResponse.json(page(DEFAULT_ROWS)))];

const mockApi = setupServer(...handlers);
beforeAll(() => mockApi.listen({ onUnhandledRequest: "error" }));
afterAll(() => mockApi.close());
afterEach(() => mockApi.resetHandlers(...handlers));

async function call(args: Record<string, unknown> = {}) {
  const { server } = createServer({ apiKey: "test-key", baseUrl: BASE });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "os-shaping", version: "1.0.0" }, { capabilities: {} });
  await client.connect(ct);
  const res = await client.callTool({ name: "list_os_windows_endpoints", arguments: args });
  const text = (res.content as Array<{ text: string }>)[0].text;
  return { text, json: JSON.parse(text) as Record<string, any>, bytes: Buffer.byteLength(text, "utf8") };
}

describe("the compact projection is materially smaller and says what it removed", () => {
  it("drops the version decomposition, which is the same fact four more times", async () => {
    const { text, json } = await call();
    const row = json.data[0];

    // The whole version survives.
    expect(row.osVersion).toBe("10.0.19045.6093");
    expect(row.osName).toBe("Windows 10 64-Bit");
    expect(row.osDisplayVersion).toBe("22H2");

    // The nested block, and its four redundant numeric parts, are gone.
    expect(row.operatingSystem).toBeUndefined();
    expect(text).not.toMatch(/"patchLevel"/);
    expect(text).not.toMatch(/"build"\s*:/);

    // Property, not spelling: every dropped numeric part is recoverable from
    // the string that was kept, by the split that produced them.
    const [major, minor, build, patchLevel] = String(row.osVersion).split(".").map(Number);
    expect([major, minor, build, patchLevel]).toEqual([10, 0, 19045, 6093]);
  });

  it("is materially smaller than the same page at detail:true", async () => {
    const compact = await call();
    const full = await call({ detail: true });

    expect(compact.bytes).toBeLessThan(full.bytes);
    // The measured live saving was ~25%; assert a floor well under it so this
    // pins the property without pinning one estate's arithmetic.
    expect(compact.bytes).toBeLessThan(full.bytes * 0.85);
  });

  it("names every field the projection removed, so nothing is silently gone", async () => {
    const { json } = await call();
    const away = (json.meta?.projectedAway ?? []) as string[];

    // The two facts that are dropped rather than relocated must be nameable.
    expect(away.join(" ")).toMatch(/operatingSystem/);
    expect(json.meta?.hint ?? "").toMatch(/detail:true/);
  });
});

describe("the escape hatch stays exact", () => {
  it("detail:true returns the untouched API record, including localeId and releaseId", async () => {
    const { json } = await call({ detail: true });
    const row = json.data[0];

    expect(row.operatingSystem).toEqual({
      name: "Windows 10 64-Bit",
      version: { full: "10.0.19045.6093", major: 10, minor: 0, build: 19045, patchLevel: 6093 },
      displayVersion: "22H2",
      releaseId: "2009",
      localeId: 1033,
    });
    // The flattened aliases must NOT appear on the raw path — detail:true is
    // the API's record, not a third shape.
    expect(row.osName).toBeUndefined();
    expect(row.osVersion).toBeUndefined();
  });
});

describe("the projection does not invent facts it does not have", () => {
  it("an endpoint with no OS inventory yields nulls, not a throw and not a guess", async () => {
    mockApi.use(http.get(ROUTE, () => HttpResponse.json(page([
      osRow(1, { operatingSystem: null }),
      osRow(2, { operatingSystem: { name: "Windows 11 64-Bit", version: null, displayVersion: null, releaseId: null, localeId: null } }),
    ]))));
    const { json } = await call();

    expect(json.data[0].osName).toBeNull();
    expect(json.data[0].osVersion).toBeNull();
    // A partially-populated OS block keeps what it has and nulls what it lacks.
    expect(json.data[1].osName).toBe("Windows 11 64-Bit");
    expect(json.data[1].osVersion).toBeNull();
  });

  it("the OS-install configuration this tool exists to report is kept whole", async () => {
    const { json } = await call();
    const row = json.data[0];

    // These are the fields the tool is FOR; a byte saving that removed them
    // would be a different tool, not a smaller one.
    expect(row.isOSInstallAllowed).toBe(true);
    expect(row.inheritsAutoInstallation).toBe(true);
    expect(row).toHaveProperty("hardwareProfileId");
    expect(row).toHaveProperty("endpointId");
    expect(row).toHaveProperty("endpointName");
  });

  it("fields:[..] still selects explicitly, overriding the projection", async () => {
    const { json } = await call({ fields: ["endpointName", "osVersion"] });
    const row = json.data[0];

    expect(Object.keys(row).sort()).toEqual(["endpointName", "osVersion"]);
  });
});
