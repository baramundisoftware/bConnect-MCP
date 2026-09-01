/**
 * exposure — library completeness tests for finding P0-NEW.
 *
 * Reproduced live 2026-08-02: `get_unpatched_endpoints` served
 * `meta.libraryEntries: 3` with `resultTrustworthy: true` and ranked zero
 * endpoints above CVSS 7, on an estate whose Vulnerabilities route reported
 * `totalItems: 37571` and which had 1,522 detections above the threshold.
 * B10 hardened the *empty* library case, but the guard was `byId.size === 0`
 * — no floor above zero — so a 3-entry partial fetch was accepted as fact,
 * written to the disk cache, and served as a clean estate for the whole TTL.
 *
 * The fix is exact, not a heuristic: the envelope's own `totalItems` (page 0
 * is the authority) is compared against the rows actually absorbed, the
 * expected total is recorded in the disk cache and validated on read, and a
 * walk that could not cover `totalPages` is never persisted. These tests pin
 * each of those properties, plus the two behaviours that must NOT change:
 * a genuinely complete small library still caches (no magic minimum), and
 * the B10 empty-library outage semantics still hold.
 *
 * Module state (in-memory cache, last-error) and the disk cache path are both
 * module-scoped, so every test stubs the temp-dir env vars to an isolated
 * directory and re-imports the module fresh.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fingerprintFromHttpClient, fingerprintedCacheName } from "@bconnect/mcp-core";
import { join } from "node:path";
import type { AxiosInstance } from "axios";
import type { ComplianceModule } from "../modules/compliance.js";

type Row = Record<string, unknown>;

function libRow(i: number): Row {
  return { id: `id-${i}`, cveId: `CVE-2026-${1000 + i}`, cvssScore: 9.8, severity: "critical" };
}

function detRow(i: number, endpointName = "WIN11CLIENT1"): Row {
  return {
    vulnerabilityId: `id-${i}`,
    cveId: `CVE-2026-${1000 + i}`,
    endpointName,
    detected: "2026-08-01T00:00:00Z",
    ignored: false,
  };
}

interface FakeOptions {
  /** Rows per library page; a page not listed answers []. */
  libraryPages: Row[][];
  /** The envelope's totalItems — the API's own row count. Omit to leave it off the envelope. */
  libraryTotalItems?: number;
  /** The envelope's totalPages (default: libraryPages.length). */
  libraryTotalPages?: number;
  /** Single-page detections (default: none). */
  detections?: Row[];
  /** Force a multi-page detections walk: every page answers one detRow(page). */
  detectionsTotalPages?: number;
}

function fakeCompliance(opts: FakeOptions) {
  const state = { vulnCalls: 0, detCalls: 0 };
  const module = {
    // The cache partitions on the identity of the CLIENT that fetched the
    // rows, not on ambient env vars, so a faithful fake must carry one.
    getHttpClient: () => ({
      defaults: { baseURL: 'https://bms-test.invalid/bconnect', headers: { common: { 'X-Api-Key': 'test-key' } } },
    }),
    async getAllVulnerabilities(params: { Page?: number }) {
      state.vulnCalls++;
      const page = params.Page ?? 0;
      return {
        totalItems: opts.libraryTotalItems,
        totalPages: opts.libraryTotalPages ?? opts.libraryPages.length,
        data: opts.libraryPages[page] ?? [],
      };
    },
    async getAllDetectedVulnerabilities(params: { Page?: number }) {
      state.detCalls++;
      const page = params.Page ?? 0;
      if (opts.detectionsTotalPages != null) {
        // One row per page, so totalItems and totalPages agree — the envelope's
        // own count is what a bounded walk must still be able to report.
        return {
          totalItems: opts.detectionsTotalPages,
          totalPages: opts.detectionsTotalPages,
          data: [detRow(page)],
        };
      }
      return {
        totalItems: (opts.detections ?? []).length,
        totalPages: 1,
        data: page === 0 ? (opts.detections ?? []) : [],
      };
    },
  } as unknown as ComplianceModule;
  return { module, state };
}

/** An AxiosInstance stand-in that answers every list route with an empty page. */
const emptyHttp = {
  get: async () => ({ data: { data: [], totalPages: 1 } }),
} as unknown as AxiosInstance;

/**
 * The client shape every fake in this file reports.
 *
 * The cache now fingerprints the CLIENT rather than process.env, because
 * `resolveClientConfig` takes the base URL and key from injected gateway
 * credentials or `__SUFFIX` scoped variables before it ever reads the ambient
 * environment — so an env fingerprint cannot separate two gateway tenants.
 */
const FAKE_CLIENT = {
  defaults: { baseURL: 'https://bms-test.invalid/bconnect', headers: { common: { 'X-Api-Key': 'test-key' } } },
};

let dir: string;

/**
 * Where the module under test will put its disk cache, given the stubbed tmpdir.
 *
 * The name carries a per-TENANT fingerprint (H2): a fixed path meant two MCP
 * configurations under one OS user, pointing at two bMS servers, read each
 * other's library. Computed the same way the module computes it, so the test
 * cannot silently drift onto a path nothing writes.
 */
function cacheFile(): string {
  return join(
    dir,
    "bconnect-mcp",
    fingerprintedCacheName("vulnerability-library.json", fingerprintFromHttpClient(FAKE_CLIENT))
  );
}

/**
 * Fresh module instance: fresh in-memory cache, fresh last-error state, and a
 * CACHE_DIR recomputed under the isolated temp directory.
 */
async function freshExposure() {
  vi.resetModules();
  return await import("../modules/exposure.js");
}

async function freshUnpatched() {
  // NOTE: no resetModules here — call freshExposure() first so unpatched and
  // exposure come from the same registry generation.
  return await import("../modules/unpatched.js");
}

async function freshDiskCache() {
  return await import("../modules/secure-disk-cache.js");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "exposure-integrity-"));
  // os.tmpdir() reads TMPDIR (POSIX) or TEMP/TMP (Windows) on every call, but
  // exposure.ts computes CACHE_DIR once at module load — hence freshExposure().
  vi.stubEnv("TMPDIR", dir);
  vi.stubEnv("TEMP", dir);
  vi.stubEnv("TMP", dir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("library completeness (P0-NEW)", () => {
  it("refuses to cache a library that absorbed fewer rows than the API's totalItems", async () => {
    const exposure = await freshExposure();
    // The API says 10 rows exist; the single page carries only 3.
    const fake = fakeCompliance({
      libraryPages: [[libRow(0), libRow(1), libRow(2)]],
      libraryTotalItems: 10,
      detections: [detRow(0)],
    });

    const analysis = await exposure.analyzeExposure(fake.module);

    expect(analysis.libraryUnavailable).not.toBeNull();
    expect(analysis.libraryUnavailable).toMatch(/3\b/);
    expect(analysis.libraryUnavailable).toMatch(/10\b/);
    // Never persisted: not to disk...
    expect(existsSync(cacheFile())).toBe(false);
    // ...and not in memory — the next call must refetch, not serve the partial.
    const callsAfterFirst = fake.state.vulnCalls;
    await exposure.analyzeExposure(fake.module);
    expect(fake.state.vulnCalls).toBeGreaterThan(callsAfterFirst);
  });

  it("reports the observed case (totalItems=37571, 3 rows absorbed) as an outage, not a clean estate", async () => {
    const exposure = await freshExposure();
    const fake = fakeCompliance({
      libraryPages: [[libRow(0), libRow(1), libRow(2)]],
      libraryTotalItems: 37571,
      // Detections reference entries the truncated library does not contain —
      // exactly the live shape: every one unscored, every count collapses to 0.
      detections: [detRow(100), detRow(101), detRow(102)],
    });

    const res = await exposure.getVulnerabilityExposure(fake.module, {});
    const meta = res.meta as Record<string, unknown>;
    const totals = res.totals as Record<string, unknown>;

    // The arithmetic still honestly says 0 above threshold...
    expect(totals.aboveThreshold).toBe(0);
    // ...but the result must say why, and must not claim to be trustworthy.
    expect(meta.resultTrustworthy).toBe(false);
    expect(String(meta.libraryUnavailable)).toMatch(/37571/);
    expect(String(meta.note)).toMatch(/NOT because nothing was found/);
    expect(existsSync(cacheFile())).toBe(false);
  });

  it("never persists a walk truncated at MAX_LIBRARY_PAGES as fact", async () => {
    const exposure = await freshExposure();
    // 250 pages of 1 row each against MAX_LIBRARY_PAGES=200: the walk cannot
    // cover totalPages, so whatever it absorbed must not become the cache.
    const pages: Row[][] = Array.from({ length: 250 }, (_, i) => [libRow(i)]);
    const fake = fakeCompliance({
      libraryPages: pages,
      libraryTotalItems: 250,
      detections: [detRow(0)],
    });

    const analysis = await exposure.analyzeExposure(fake.module);

    expect(analysis.libraryUnavailable).not.toBeNull();
    expect(existsSync(cacheFile())).toBe(false);
  });

  it("discards a poisoned on-disk cache whose size is below its recorded expected total", async () => {
    const exposure = await freshExposure();
    const diskCache = await freshDiskCache();

    // Plant a fresh-looking cache that records 37571 expected but holds 3 —
    // the state a pre-fix build left behind in the wild.
    const entries = [libRow(0), libRow(1), libRow(2)].map(
      (r) => [String(r.id), { cveId: r.cveId, cvssScore: r.cvssScore, severity: r.severity }] as const
    );
    diskCache.writeCacheFileSync(
      join(dir, "bconnect-mcp"),
      cacheFile(),
      JSON.stringify({
        // Correct provenance on purpose: without it the new payload check
        // rejects the plant first, and these tests would pass while no longer
        // exercising the completeness rules they were written for.
        provenance: fingerprintFromHttpClient(FAKE_CLIENT),
        fetchedAt: Date.now(),
        entries,
        cveEntries: entries.map(([, e]) => [e.cveId, e]),
        expectedTotal: 37571,
      })
    );

    // The API now answers a complete 5-row library.
    const fake = fakeCompliance({
      libraryPages: [[libRow(0), libRow(1), libRow(2), libRow(3), libRow(4)]],
      libraryTotalItems: 5,
      detections: [detRow(3)],
    });

    const analysis = await exposure.analyzeExposure(fake.module);

    // The poisoned cache must be discarded and refetched, not served.
    expect(fake.state.vulnCalls).toBeGreaterThan(0);
    expect(analysis.library.size).toBe(5);
    expect(analysis.libraryUnavailable).toBeNull();
  });

  it("discards a legacy on-disk cache that carries no expected total", async () => {
    const exposure = await freshExposure();
    const diskCache = await freshDiskCache();

    // The pre-fix on-disk shape has no expectedTotal at all, so a poisoned one
    // is indistinguishable from a complete one. Refusing the whole legacy
    // format (one refetch, once) is what lets an already-poisoned estate heal.
    const entries = [libRow(0), libRow(1), libRow(2)].map(
      (r) => [String(r.id), { cveId: r.cveId, cvssScore: r.cvssScore, severity: r.severity }] as const
    );
    diskCache.writeCacheFileSync(
      join(dir, "bconnect-mcp"),
      cacheFile(),
      JSON.stringify({
        // Correct provenance on purpose: without it the new payload check
        // rejects the plant first, and these tests would pass while no longer
        // exercising the completeness rules they were written for.
        provenance: fingerprintFromHttpClient(FAKE_CLIENT),
        fetchedAt: Date.now(),
        entries,
        cveEntries: entries.map(([, e]) => [e.cveId, e]),
      })
    );

    const fake = fakeCompliance({
      libraryPages: [[libRow(0), libRow(1), libRow(2), libRow(3), libRow(4)]],
      libraryTotalItems: 5,
      detections: [detRow(3)],
    });

    const analysis = await exposure.analyzeExposure(fake.module);

    expect(fake.state.vulnCalls).toBeGreaterThan(0);
    expect(analysis.library.size).toBe(5);
  });

  it("caches a genuinely complete small library — the check is exact, not a magic minimum", async () => {
    const exposure = await freshExposure();
    // 3 rows, and the API says 3 rows exist. Small is not suspicious.
    const fake = fakeCompliance({
      libraryPages: [[libRow(0), libRow(1), libRow(2)]],
      libraryTotalItems: 3,
      detections: [detRow(0)],
    });

    const analysis = await exposure.analyzeExposure(fake.module);

    expect(analysis.libraryUnavailable).toBeNull();
    expect(analysis.library.size).toBe(3);
    expect(analysis.detections.aboveThreshold).toBe(1);
    expect(existsSync(cacheFile())).toBe(true);
    const onDisk = JSON.parse(readFileSync(cacheFile(), "utf8")) as { expectedTotal?: number };
    expect(onDisk.expectedTotal).toBe(3);

    // And it is served from memory on the next call — cached, not re-walked.
    const callsAfterFirst = fake.state.vulnCalls;
    await exposure.analyzeExposure(fake.module);
    expect(fake.state.vulnCalls).toBe(callsAfterFirst);
  });

  it("caches a complete library when the envelope omits totalItems (legacy envelope shape)", async () => {
    const exposure = await freshExposure();
    // totalItems is optional in the envelope type. Without it there is nothing
    // exact to assert against, so a fully-covered walk still caches — the fix
    // must not turn an absent field into a permanent outage.
    const fake = fakeCompliance({
      libraryPages: [[libRow(0), libRow(1)]],
      detections: [detRow(0)],
    });

    const analysis = await exposure.analyzeExposure(fake.module);

    expect(analysis.libraryUnavailable).toBeNull();
    expect(analysis.library.size).toBe(2);
    expect(existsSync(cacheFile())).toBe(true);
  });

  it("still treats an empty library as an outage (B10)", async () => {
    const exposure = await freshExposure();
    const fake = fakeCompliance({
      libraryPages: [[]],
      libraryTotalItems: 0,
      detections: [detRow(0)],
    });

    const analysis = await exposure.analyzeExposure(fake.module);

    expect(analysis.libraryUnavailable).toMatch(/reported as success/);
    expect(analysis.libraryUnavailable).toMatch(/not a clean estate/);
    // ...and it cites no internal finding id, which a caller cannot resolve.
    expect(analysis.libraryUnavailable).not.toMatch(/\bB10\b/);
    // The detection side still reports — a caller told "the API errored" can
    // act, one told "0 vulnerabilities" cannot.
    expect(analysis.detections.rowsExamined).toBe(1);
    expect(existsSync(cacheFile())).toBe(false);
  });

  it("still reports a thrown library fetch without failing the query (B10), and does not cache the partial", async () => {
    const exposure = await freshExposure();
    let calls = 0;
    const module = {
    // The cache partitions on the identity of the CLIENT that fetched the
    // rows, not on ambient env vars, so a faithful fake must carry one.
    getHttpClient: () => ({
      defaults: { baseURL: 'https://bms-test.invalid/bconnect', headers: { common: { 'X-Api-Key': 'test-key' } } },
    }),
      async getAllVulnerabilities() {
        calls++;
        throw new Error("socket hang up");
      },
      async getAllDetectedVulnerabilities() {
        return { totalPages: 1, data: [detRow(0)] };
      },
    } as unknown as ComplianceModule;

    const analysis = await exposure.analyzeExposure(module);

    expect(calls).toBeGreaterThan(0);
    expect(analysis.libraryUnavailable).toMatch(/socket hang up/);
    expect(analysis.detections.rowsExamined).toBe(1);
    expect(existsSync(cacheFile())).toBe(false);
  });
});

describe("detections completeness (P0-NEW, same reasoning as the library walk)", () => {
  it("marks the result untrustworthy when the detections walk is truncated", async () => {
    const exposure = await freshExposure();
    const fake = fakeCompliance({
      libraryPages: [Array.from({ length: 250 }, (_, i) => libRow(i))],
      libraryTotalItems: 250,
      // Past MAX_DETECTION_PAGES (2,000): the walk cannot cover it.
      detectionsTotalPages: 2_050,
    });

    const res = await exposure.getVulnerabilityExposure(fake.module, {});
    const meta = res.meta as Record<string, unknown>;
    const totals = res.totals as Record<string, unknown>;

    // The library itself is fine — this must not be blamed on it...
    expect(meta.libraryUnavailable).toBeNull();
    // ...but an undercount presented as a total is not trustworthy.
    expect(meta.resultTrustworthy).toBe(false);
    expect(String(meta.note)).toMatch(/detection/i);
    // And the headline count is still the server's own figure, not the number
    // of rows that happened to be read — the shape of this project's worst
    // shipped defect is a short number wearing a total's field name.
    expect(totals.detectedVulnerabilities).toBe(2_050);
    expect(totals.detectionsExamined).toBe(2_000);
  });

  it("does not stop a detections walk at the CVE library's page ceiling", async () => {
    const exposure = await freshExposure();
    // 250 pages of detections. The library's own ceiling is 200 pages, sized
    // from a 37.5k-row vendor catalogue; detections scale with the estate and
    // sharing that constant cut a mid-size estate off at 200,000 rows and
    // called it a total.
    const fake = fakeCompliance({
      libraryPages: [[libRow(0)]],
      libraryTotalItems: 1,
      detectionsTotalPages: 250,
    });

    const res = await exposure.getVulnerabilityExposure(fake.module, {});
    const meta = res.meta as Record<string, unknown>;
    const totals = res.totals as Record<string, unknown>;

    expect(meta.resultTrustworthy).toBe(true);
    expect(totals.detectionsExamined).toBe(250);
  });

  it("stays trustworthy when the detections walk covers every page", async () => {
    const exposure = await freshExposure();
    const fake = fakeCompliance({
      libraryPages: [[libRow(0), libRow(1), libRow(2)]],
      libraryTotalItems: 3,
      detectionsTotalPages: 3,
    });

    const res = await exposure.getVulnerabilityExposure(fake.module, {});
    const meta = res.meta as Record<string, unknown>;

    expect(meta.resultTrustworthy).toBe(true);
  });
});

describe("get_unpatched_endpoints (P0-NEW, the tool that served the false all-clear)", () => {
  it("reports an incomplete library as untrustworthy with the loudest caveat first", async () => {
    const exposure = await freshExposure();
    const unpatched = await freshUnpatched();
    void exposure;

    const fake = fakeCompliance({
      libraryPages: [[libRow(0), libRow(1), libRow(2)]],
      libraryTotalItems: 37571,
      detections: [detRow(100), detRow(101), detRow(102)],
    });

    const res = await unpatched.getUnpatchedEndpoints(fake.module, emptyHttp, {});
    const meta = res.meta as Record<string, unknown>;
    const caveats = res.caveats as string[];

    expect(meta.libraryEntries).toBe(3);
    expect(meta.resultTrustworthy).toBe(false);
    expect(String(meta.libraryUnavailable)).toMatch(/37571/);
    expect(caveats[0]).toMatch(/NOT TRUSTWORTHY/);
  });
});
