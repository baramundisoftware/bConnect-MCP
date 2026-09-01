/**
 * Composite tools must return a partial answer, not nothing at all.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * Every walk in this server was bounded by pages and by nothing else.
 * `BCONNECT_TIMEOUT_MS` bounds one request; a composite issuing hundreds of them
 * had no overall deadline, and the only clock that mattered belonged to the MCP
 * client. Past that ceiling the customer does not get a slow answer — the call is
 * killed and they get an error with nothing in it, on every analytical tool,
 * repeatedly. All the truncation-disclosure work in this server is wasted if the
 * response is never emitted.
 *
 * ── The property being pinned ───────────────────────────────────────────────
 * When the budget is spent the walk stops, the response still comes back, it
 * says it is partial and why, and — the part that matters most — the headline
 * count is still the server's own `totalItems` rather than the number of rows
 * that happened to be read. A short number wearing a total's field name is this
 * project's worst shipped defect and a time budget is a new way to produce one.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AxiosInstance } from "axios";
import type { ComplianceModule } from "../modules/compliance.js";

type Row = Record<string, unknown>;

const libRow = (i: number): Row => ({
  id: `id-${i}`,
  cveId: `CVE-2026-${1000 + i}`,
  cvssScore: 9.8,
  severity: "critical",
});

const detRow = (i: number): Row => ({
  vulnerabilityId: `id-${i}`,
  cveId: `CVE-2026-${1000 + i}`,
  endpointName: `EP-${i}`,
  detected: "2026-08-01T00:00:00Z",
  ignored: false,
});

/**
 * Detections span `pages`, and page 0 alone takes `page0Ms`. Making the FIRST
 * page slow is what keeps this deterministic: the budget is provably spent by
 * the time page 1 would be requested, so exactly one page is ever fetched.
 */
function fakeCompliance(pages: number, page0Ms: number) {
  const fetched: number[] = [];
  return {
    fetched,
    module: {
    // The cache partitions on the identity of the CLIENT that fetched the
    // rows, not on ambient env vars, so a faithful fake must carry one.
    getHttpClient: () => ({
      defaults: { baseURL: 'https://bms-test.invalid/bconnect', headers: { common: { 'X-Api-Key': 'test-key' } } },
    }),
      async getAllVulnerabilities() {
        return { totalItems: 1, totalPages: 1, data: [libRow(0)] };
      },
      async getAllDetectedVulnerabilities(params: { Page?: number }) {
        const page = params.Page ?? 0;
        fetched.push(page);
        if (page === 0) {
          await new Promise((resolve) => setTimeout(resolve, page0Ms));
        }
        return { totalItems: pages, totalPages: pages, data: [detRow(page)] };
      },
    } as unknown as ComplianceModule,
  };
}

/** An endpoint listing of `pages` pages whose first page takes `page0Ms`. */
function slowEndpointHttp(pages: number, page0Ms: number): AxiosInstance {
  return {
    async get(_url: string, config: { params: Record<string, unknown> }) {
      const page = Number(config.params?.Page ?? 0);
      if (page === 0) {
        await new Promise((resolve) => setTimeout(resolve, page0Ms));
      }
      return {
        data: {
          totalPages: pages,
          totalItems: pages,
          data: [{ id: `e${page}`, displayName: `EP-${page}`, lastSeen: new Date().toISOString() }],
        },
      };
    },
  } as unknown as AxiosInstance;
}

let dir: string;

async function freshExposure(): Promise<typeof import("../modules/exposure.js")> {
  vi.resetModules();
  return await import("../modules/exposure.js");
}

async function freshUnpatched(): Promise<typeof import("../modules/unpatched.js")> {
  return await import("../modules/unpatched.js");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "composite-budget-"));
  vi.stubEnv("TMPDIR", dir);
  vi.stubEnv("TEMP", dir);
  vi.stubEnv("TMP", dir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

// These two spend a wall-clock budget and were racing vitest's 5 s default at
// roughly 1 run in 3; the file came in at 4,930 ms on one gate run, 70 ms
// inside the limit. They carried a local 30 s pin, which is now the GLOBAL
// default in vitest.shared.ts — the measurement and the reasoning live there.
//
// The budget UNDER TEST is stubbed to 1,000 ms and is untouched by any of this:
// these assert what the composite SAYS when its budget is spent, never how long
// vitest is willing to wait.

describe("get_vulnerability_exposure under a spent time budget", () => {
  it("returns a partial answer that says so, instead of walking on past the client's timeout", async () => {
    vi.stubEnv("BCONNECT_COMPOSITE_BUDGET_MS", "1000");
    const exposure = await freshExposure();
    const fake = fakeCompliance(400, 1_200);

    const res = await exposure.getVulnerabilityExposure(fake.module, {});
    const meta = res.meta as Record<string, unknown>;
    const totals = res.totals as Record<string, unknown>;

    // The walk stopped rather than running 400 pages deep.
    expect(fake.fetched).toEqual([0]);
    // ...the answer still came back...
    expect(res.endpoints).toBeDefined();
    // ...labelled, with the cause named and the remedy stated.
    expect(meta.resultTrustworthy).toBe(false);
    const reasons = (meta.resultTrustworthyReasons as string[]).join(" ");
    expect(reasons).toMatch(/time budget/i);
    expect(reasons).toMatch(/BCONNECT_COMPOSITE_BUDGET_MS/);
    // ...and the estate-level count is the server's own, never the short read.
    expect(totals.detectedVulnerabilities).toBe(400);
    expect(totals.detectionsExamined).toBe(1);
    expect((meta.timeBudget as Record<string, unknown>).budgetMs).toBe(1_000);
  });

  it("flags nothing when the budget is ample", async () => {
    vi.stubEnv("BCONNECT_COMPOSITE_BUDGET_MS", "20000");
    const exposure = await freshExposure();
    const fake = fakeCompliance(4, 0);

    const res = await exposure.getVulnerabilityExposure(fake.module, {});
    const meta = res.meta as Record<string, unknown>;

    expect(fake.fetched.sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(meta.resultTrustworthy).toBe(true);
    expect(meta.resultTrustworthyReasons).toEqual([]);
  });
});

describe("get_unpatched_endpoints under a spent time budget", () => {
  it("caveats the endpoint walk loudly rather than reporting a short estate", async () => {
    vi.stubEnv("BCONNECT_COMPOSITE_BUDGET_MS", "1000");
    await freshExposure();
    const unpatched = await freshUnpatched();
    const fake = fakeCompliance(1, 0);

    const res = await unpatched.getUnpatchedEndpoints(
      fake.module,
      slowEndpointHttp(90, 1_200),
      {}
    );
    const caveats = (res.caveats as string[]).join(" ");
    const totals = res.totals as Record<string, unknown>;
    const meta = res.meta as Record<string, unknown>;

    expect(caveats).toMatch(/THE ENDPOINT LISTING IS INCOMPLETE/);
    expect(caveats).toMatch(/time budget/i);
    expect(meta.resultTrustworthy).toBe(false);
    // The server's own estate size survives the short walk.
    expect(totals.endpointsInEstate).toBe(90);
    expect(totals.endpointsExamined).toBe(1);
    expect((meta.endpointWalk as Record<string, unknown>).outOfTime).toBe(true);
  });
});
