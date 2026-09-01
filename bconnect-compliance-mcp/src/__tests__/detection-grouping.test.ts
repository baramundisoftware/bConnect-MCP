/**
 * list_detected_vulnerabilities — grouped by endpoint, driven through the REAL
 * tool handler.
 *
 * ── The claim this file has to hold ─────────────────────────────────────────
 * Grouping is LOSSLESS. It is not a projection: nothing is dropped, the
 * repeated identifiers are hoisted onto the endpoint they describe. So the
 * central test is a round-trip — reconstruct the flat rows from the grouped
 * response and assert they equal what `detail:true` returns. A byte saving that
 * quietly loses a field would pass every other assertion here.
 *
 * ── Why grouping rather than interning ──────────────────────────────────────
 * The re-rank found `endpointId`/`endpointName`/`detected` at 47% of this
 * payload. Interning them behind `"@1"` plus a lookup table saves the same
 * bytes and makes a model dereference; this project rates accuracy above
 * tokens. Grouping saves the same and reads better.
 *
 * Measured live before building: 4,431 -> 2,166 B at the default PageSize
 * (51/43/42/51% across four pages), 60.1% at PageSize 1000, and 0 of 17
 * endpoints carried more than one distinct `detected` — so hoisting the scan
 * date is safe, and the code still handles the case where it is not.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

let nextResult: unknown = null;
vi.mock("../modules/compliance.js", () => ({
  ComplianceModule: class {
    async getAllDetectedVulnerabilities() { return nextResult; }
  },
}));

import { createServer } from "../index.js";

const row = (ep: string, epId: string, cve: string, detected: string, ignored = false) => ({
  endpointId: epId, endpointName: ep, vulnerabilityId: `v-${cve}`, cveId: cve, detected, ignored,
});

const SCAN_A = "2026-03-31T18:29:10Z";
const SCAN_B = "2026-01-27T14:50:45Z";

const envelope = (rows: unknown[], totalItems = rows.length) => ({
  currentPage: 0, pageSize: 20, totalPages: 1, totalItems,
  hasPreviousPage: false, hasNextPage: false, data: rows,
});

const SCAN_C = "2025-02-14T21:03:08Z";

/**
 * 20 rows over 3 endpoints, INTERLEAVED — the shape the live API actually
 * returns (measured: 3-6 endpoints per 20-row page, rows not sorted by
 * endpoint). A small fixture would be misleading in both directions: the meta
 * block cannot amortise over five rows, and interleaving is what makes the
 * ordering question below real.
 */
const ROWS = Array.from({ length: 20 }, (_, i) => {
  const which = i % 3;
  if (which === 0) {return row("WIN11CLIENT4", "ep-a", `CVE-2025-${1000 + i}`, SCAN_A, i === 9);}
  if (which === 1) {return row("BMS-SRV1", "ep-b", `CVE-2026-${2000 + i}`, SCAN_B);}
  return row("WIN10CLIENT9", "ep-c", `CVE-2024-${3000 + i}`, SCAN_C);
});

async function call(args: Record<string, unknown> = {}) {
  const { server } = createServer({ apiKey: "k", baseUrl: "https://bms.test/bconnect" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "grp", version: "1.0.0" }, { capabilities: {} });
  await client.connect(ct);
  const res = await client.callTool({ name: "list_detected_vulnerabilities", arguments: args });
  const text = (res.content as Array<{ text: string }>)[0].text;
  return { text, json: JSON.parse(text) as Record<string, any>, bytes: Buffer.byteLength(text, "utf8") };
}

/** Rebuild the flat rows a grouped response encodes. */
function ungroup(json: Record<string, any>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const g of json.data as Array<Record<string, any>>) {
    for (const cve of g.cves as Array<Record<string, unknown>>) {
      out.push({
        endpointId: (g.endpoint as Record<string, unknown>).id,
        endpointName: (g.endpoint as Record<string, unknown>).name,
        vulnerabilityId: cve.vulnerabilityId,
        cveId: cve.cveId,
        // A CVE keeps its own date only when it disagrees with the group's.
        detected: "detected" in cve ? cve.detected : (g.endpoint as Record<string, unknown>).scannedAt,
        // Absence means false — the meta says so.
        ignored: cve.ignored === true,
      });
    }
  }
  return out;
}

beforeEach(() => { nextResult = envelope(ROWS); });

/** Row identity, so content can be compared without depending on sequence. */
const byIdentity = (rows: Array<Record<string, unknown>>) =>
  [...rows].sort((a, b) => `${a.endpointId}${a.cveId}`.localeCompare(`${b.endpointId}${b.cveId}`));

describe("grouping is lossless", () => {
  it("round-trips: every flat row is recoverable, field for field", async () => {
    const grouped = await call();
    const flat = await call({ detail: true });

    // Sorted, because grouping deliberately changes ORDER but must not change
    // CONTENT. The ordering change is asserted separately below.
    expect(byIdentity(ungroup(grouped.json))).toEqual(byIdentity(flat.json.data));
  });

  it("changes row ORDER, and says so rather than leaving it to be discovered", async () => {
    const grouped = await call();
    const flat = await call({ detail: true });

    // The fixture interleaves endpoints as the live API does, so the flat
    // sequence and the regrouped one genuinely differ.
    expect(ungroup(grouped.json)).not.toEqual(flat.json.data);
    expect(String(grouped.json.meta?.orderingNote)).toMatch(/OrderBy applies WITHIN/i);
    expect(String(grouped.json.meta?.orderingNote)).toMatch(/detail:true to sort globally/i);
  });

  it("hoists the endpoint and its scan date once instead of onto every row", async () => {
    const { json, text } = await call();

    expect(json.data).toHaveLength(3);
    const a = (json.data as Array<Record<string, any>>).find((g) => (g.endpoint as Record<string, unknown>).name === "WIN11CLIENT4")!;
    expect((a.endpoint as Record<string, unknown>).scannedAt).toBe(SCAN_A);
    expect(a.detections).toBe(7);
    // The hoisted keys must not survive on the CVE entries.
    for (const cve of a.cves as Array<Record<string, unknown>>) {
      expect(cve).not.toHaveProperty("endpointId");
      expect(cve).not.toHaveProperty("endpointName");
    }
    // Seven detections for that endpoint, but its name appears exactly once.
    expect(text.split("WIN11CLIENT4").length - 1).toBe(1);
  });

  it("is materially smaller than the flat record", async () => {
    const grouped = await call();
    const flat = await call({ detail: true });
    // Live measured 51% at this shape; assert a floor well under it so the
    // property is pinned without pinning one estate's arithmetic.
    expect(grouped.bytes).toBeLessThan(flat.bytes * 0.8);
  });
});

describe("the honest edges", () => {
  it("a row whose scan date disagrees with its endpoint keeps its own", async () => {
    // Measured 0 of 17 endpoints today, but the code must not depend on that.
    nextResult = envelope([
      row("WIN11CLIENT4", "ep-a", "CVE-1", SCAN_A),
      row("WIN11CLIENT4", "ep-a", "CVE-2", "2020-01-01T00:00:00Z"),
    ]);
    const grouped = await call();
    const flat = await call({ detail: true });

    const cves = (grouped.json.data as Array<Record<string, any>>)[0].cves as Array<Record<string, unknown>>;
    expect(cves.find((c) => c.cveId === "CVE-2")?.detected).toBe("2020-01-01T00:00:00Z");
    expect(cves.find((c) => c.cveId === "CVE-1")).not.toHaveProperty("detected");
    // And it still round-trips.
    expect(ungroup(grouped.json)).toEqual(flat.json.data);
  });

  it("carries `ignored` only when true, and says so", async () => {
    const { json } = await call();
    const a = (json.data as Array<Record<string, any>>).find((g) => (g.endpoint as Record<string, unknown>).name === "WIN11CLIENT4")!;
    const ignored = (a.cves as Array<Record<string, unknown>>).filter((c) => c.ignored === true);
    expect(ignored).toHaveLength(1);
    expect(String(json.meta?.ignoredNote)).toMatch(/absence means false/i);
  });

  it("states that data[] counts endpoints while totalItems counts detections", async () => {
    nextResult = envelope(ROWS, 2454);
    const { json } = await call();

    expect(json.data).toHaveLength(3);          // endpoints
    expect(json.totalItems).toBe(2454);         // detections, untouched
    expect(json.meta?.endpointsInPage).toBe(3);
    expect(json.meta?.detectionRowsInPage).toBe(20);
    expect(json.meta?.detectionsInEstate).toBe(2454);
    expect(String(json.meta?.countsNote)).toMatch(/do not read data\.length as a detection count/i);
  });

  it("leaves the paging envelope untouched — it is how a caller pages", async () => {
    nextResult = envelope(ROWS, 2454);
    const { json } = await call();
    expect(json.currentPage).toBe(0);
    expect(json.pageSize).toBe(20);
    expect(json.totalPages).toBe(1);
  });

  it("detail:true is the flat record, with no grouping meta bolted on", async () => {
    const { json } = await call({ detail: true });
    expect(json.data).toHaveLength(20);
    expect((json.data as Array<Record<string, unknown>>)[0]).toHaveProperty("endpointId");
    expect(json.meta).toBeUndefined();
  });

  it("an empty page groups to nothing without inventing an endpoint", async () => {
    nextResult = envelope([], 2454);
    const { json } = await call();
    expect(json.data).toEqual([]);
    expect(json.meta?.endpointsInPage).toBe(0);
    // The estate total is still reported — an empty page is not an empty estate.
    expect(json.meta?.detectionsInEstate).toBe(2454);
  });
});
