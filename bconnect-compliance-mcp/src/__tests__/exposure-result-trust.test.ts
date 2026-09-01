/**
 * get_vulnerability_exposure — the shared `resultTrustworthy` contract (audit M4).
 *
 * ── What this pins ──────────────────────────────────────────────────────────
 * `exposure.ts` is where `resultTrustworthy` was invented, and until now it was
 * still the hand-rolled original:
 *
 *     resultTrustworthy: libraryUnavailable == null && detectionsIncomplete == null
 *
 * A bare boolean, computed inline, emitting **no reasons**. A caller who saw
 * `false` had to reconstruct why from prose buried in `meta.note` — and a caller
 * who did not read `note` had a flag with no content at all. Meanwhile
 * `unpatched.ts` (H4) and `security-posture.ts` (C2) had already migrated to the
 * shared contract in `@bconnect/mcp-core`, so the field's own
 * birthplace was the last producer still speaking a different dialect.
 *
 * `exposure-library-integrity.test.ts` already pins the boolean thoroughly. It
 * does not assert `resultTrustworthyReasons` anywhere, because before this
 * change the field did not exist here. That is the gap these tests close.
 *
 * ── What this deliberately does NOT assert ──────────────────────────────────
 * That `resultTrustworthy: false` implies `isError`. It does not, by design —
 * see the recommendation in the report. These responses carry real data and the
 * suite's error channel is for calls that failed.
 *
 * All CVEs, ids and endpoint names are synthesised.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  endpointName: "ENDPOINT-00001",
  detected: "2026-08-01T00:00:00Z",
  ignored: false,
});

interface FakeOptions {
  libraryPages: Row[][];
  libraryTotalItems?: number;
  libraryTotalPages?: number;
  detections?: Row[];
  detectionsTotalPages?: number;
}

function fakeCompliance(opts: FakeOptions): ComplianceModule {
  return {
    // The cache partitions on the identity of the CLIENT that fetched the
    // rows, not on ambient env vars, so a faithful fake must carry one.
    getHttpClient: () => ({
      defaults: { baseURL: 'https://bms-test.invalid/bconnect', headers: { common: { 'X-Api-Key': 'test-key' } } },
    }),
    async getAllVulnerabilities(params: { Page?: number }) {
      const page = params.Page ?? 0;
      return {
        totalItems: opts.libraryTotalItems,
        totalPages: opts.libraryTotalPages ?? opts.libraryPages.length,
        data: opts.libraryPages[page] ?? [],
      };
    },
    async getAllDetectedVulnerabilities(params: { Page?: number }) {
      const page = params.Page ?? 0;
      if (opts.detectionsTotalPages != null) {
        return { totalPages: opts.detectionsTotalPages, data: [detRow(page)] };
      }
      return { totalPages: 1, data: page === 0 ? (opts.detections ?? []) : [] };
    },
  } as unknown as ComplianceModule;
}

let dir: string;

async function freshExposure(): Promise<typeof import("../modules/exposure.js")> {
  vi.resetModules();
  return await import("../modules/exposure.js");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "exposure-trust-"));
  vi.stubEnv("TMPDIR", dir);
  vi.stubEnv("TEMP", dir);
  vi.stubEnv("TMP", dir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("get_vulnerability_exposure speaks the shared completeness contract (M4)", () => {
  it("emits resultTrustworthyReasons, not just a bare boolean, when the library is short", async () => {
    const exposure = await freshExposure();
    // The API says 37,571 rows exist; the walk absorbs 3 — the live 2026-08-02 shape.
    const res = await exposure.getVulnerabilityExposure(
      fakeCompliance({
        libraryPages: [[libRow(0), libRow(1), libRow(2)]],
        libraryTotalItems: 37571,
        detections: [detRow(100)],
      }),
      {}
    );
    const meta = res.meta as Record<string, unknown>;

    expect(meta.resultTrustworthy).toBe(false);
    // The field that did not exist before this change.
    const reasons = meta.resultTrustworthyReasons as string[];
    expect(Array.isArray(reasons)).toBe(true);
    // A reason must carry the numbers, so the caller need not parse `note`.
    expect(reasons.join(" ")).toMatch(/37571/);
    expect(reasons.join(" ")).toMatch(/\b3\b/);
  });

  it("names the detections walk as the cause when the library itself is fine", async () => {
    const exposure = await freshExposure();
    const res = await exposure.getVulnerabilityExposure(
      fakeCompliance({
        libraryPages: [Array.from({ length: 250 }, (_, i) => libRow(i))],
        libraryTotalItems: 250,
        // Past MAX_DETECTION_PAGES (2,000) — the detections bound is its own
        // constant now, reasoned from detection density rather than borrowed
        // from the CVE library's row count.
        detectionsTotalPages: 2_050,
      }),
      {}
    );
    const meta = res.meta as Record<string, unknown>;

    expect(meta.libraryUnavailable).toBeNull();
    expect(meta.resultTrustworthy).toBe(false);
    const reasons = meta.resultTrustworthyReasons as string[];
    // Exactly one condition applies, and it is the detections one — a contract
    // that lumped every failure into one opaque `false` could not show this.
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/detection/i);
  });

  it("returns an empty reasons array — never undefined — when everything is complete", async () => {
    const exposure = await freshExposure();
    const res = await exposure.getVulnerabilityExposure(
      fakeCompliance({
        libraryPages: [[libRow(0), libRow(1), libRow(2)]],
        libraryTotalItems: 3,
        detections: [detRow(0)],
      }),
      {}
    );
    const meta = res.meta as Record<string, unknown>;

    expect(meta.resultTrustworthy).toBe(true);
    // An absent array and an empty one must not read the same to a caller.
    expect(meta.resultTrustworthyReasons).toEqual([]);
  });

  it("keeps resultTrustworthy false and isError unset — the flag is not the error channel", async () => {
    const exposure = await freshExposure();
    const res = await exposure.getVulnerabilityExposure(
      fakeCompliance({
        libraryPages: [[libRow(0)]],
        libraryTotalItems: 500,
        detections: [detRow(100)],
      }),
      {}
    );
    const meta = res.meta as Record<string, unknown>;

    expect(meta.resultTrustworthy).toBe(false);
    // Deliberate: the response still carries real data (the detections are
    // returned and counted), so it is not routed to the fault channel. This
    // assertion exists so that decision is explicit and a future change to it
    // has to be a decision rather than an accident.
    expect(res.isError).toBeUndefined();
    expect((res.totals as Record<string, unknown>).detectedVulnerabilities).toBe(1);
  });
});
