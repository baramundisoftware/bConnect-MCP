/**
 * exposure — detections-walk regression tests.
 *
 * Two properties, from two different findings, live on the same walk:
 *
 *  1. PER-14 — the pages fan out. They were issued strictly serially even
 *     though totalPages is known the moment page 0 returns and every remaining
 *     page is always needed. Measured live, the ~38-page CVE library cost
 *     3,085 ms cold against 98 ms warm — essentially the whole cold path.
 *  2. The rows are NEVER materialised. `loadDetected` used to accumulate every
 *     page into one array and hand it back whole; the walk is now folded into
 *     per-endpoint aggregates inside the page callback, so memory is
 *     O(endpoints) rather than O(detections). A revert to returning rows shows
 *     up here as an output that grows with the row count.
 *
 * Both would silently regress if someone reverted to a for-loop or hand-rolled
 * a fourth pagination idiom.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ComplianceModule } from '../modules/compliance.js';

let dir: string;

/**
 * Fresh module instance with its disk cache under an isolated directory: the
 * library is cached at module scope AND on disk, so without this a cache left
 * behind by another run would score these synthetic detections.
 */
async function analyzeExposure(
  ...args: Parameters<typeof import('../modules/exposure.js')['analyzeExposure']>
) {
  const mod = await import('../modules/exposure.js');
  return mod.analyzeExposure(...args);
}

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), 'exposure-pagination-'));
  vi.stubEnv('TMPDIR', dir);
  vi.stubEnv('TEMP', dir);
  vi.stubEnv('TMP', dir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A ComplianceModule stand-in that answers `pages` pages of detections and
 * records how many requests were in flight at once. The library answers one
 * page that scores every CVE the detections reference.
 */
function fakeCompliance(pages: number, opts: { holdMs?: number; rowsPerPage?: number; endpoints?: number } = {}) {
  const holdMs = opts.holdMs ?? 5;
  const rowsPerPage = opts.rowsPerPage ?? 1;
  const endpoints = opts.endpoints ?? Number.MAX_SAFE_INTEGER;
  const requested: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const module = {
    // The cache partitions on the identity of the CLIENT that fetched the
    // rows, not on ambient env vars, so a faithful fake must carry one.
    getHttpClient: () => ({
      defaults: { baseURL: 'https://bms-test.invalid/bconnect', headers: { common: { 'X-Api-Key': 'test-key' } } },
    }),
    async getAllVulnerabilities() {
      // One library entry that every detection below joins to, so the fold has
      // something to score with.
      return { totalItems: 1, totalPages: 1, data: [{ id: 'lib', cveId: 'CVE-X', cvssScore: 9.8, severity: 'critical' }] };
    },
    async getAllDetectedVulnerabilities(params: { Page?: number }) {
      const page = params.Page ?? 0;
      requested.push(page);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, holdMs));
      inFlight--;
      const data = Array.from({ length: rowsPerPage }, (_, i) => {
        const n = page * rowsPerPage + i;
        return {
          vulnerabilityId: 'lib',
          cveId: 'CVE-X',
          endpointName: `EP-${n % endpoints}`,
          detected: new Date(1_700_000_000_000 + n).toISOString(),
          ignored: false,
        };
      });
      return { totalItems: pages * rowsPerPage, totalPages: pages, data };
    },
  } as unknown as ComplianceModule;

  return { module, requested, get maxInFlight() { return maxInFlight; } };
}

describe('detections walk — pagination (PER-14)', () => {
  it('fetches every page exactly once', async () => {
    const fake = fakeCompliance(12);
    const analysis = await analyzeExposure(fake.module);

    expect(analysis.detections.rowsExamined).toBe(12);
    expect([...fake.requested].sort((a, b) => a - b)).toEqual([...Array(12).keys()]);
  });

  it('overlaps requests after page 0 rather than issuing them serially', async () => {
    const fake = fakeCompliance(12);
    await analyzeExposure(fake.module);

    // Page 0 must be alone — totalPages is unknown until it returns.
    expect(fake.requested[0]).toBe(0);
    // The rest fan out. Serial would leave this at 1, which is the defect.
    expect(fake.maxInFlight).toBeGreaterThan(1);
  });

  it('handles a single-page result without a second request', async () => {
    const fake = fakeCompliance(1);
    const analysis = await analyzeExposure(fake.module);

    expect(analysis.detections.rowsExamined).toBe(1);
    expect(fake.requested).toEqual([0]);
  });

  it('treats a null totalPages as a single page', async () => {
    let calls = 0;
    const module = {
    // The cache partitions on the identity of the CLIENT that fetched the
    // rows, not on ambient env vars, so a faithful fake must carry one.
    getHttpClient: () => ({
      defaults: { baseURL: 'https://bms-test.invalid/bconnect', headers: { common: { 'X-Api-Key': 'test-key' } } },
    }),
      async getAllVulnerabilities() {
        return { totalItems: 0, totalPages: 1, data: [] as unknown[] };
      },
      async getAllDetectedVulnerabilities() {
        calls++;
        return { totalPages: null, data: [{ cveId: 'only', endpointName: 'EP-0' }] };
      },
    } as unknown as ComplianceModule;

    const analysis = await analyzeExposure(module);
    expect(analysis.detections.rowsExamined).toBe(1);
    expect(calls).toBe(1);
  });
});

describe('detections walk — the rows are folded, never materialised', () => {
  it('holds one record per ENDPOINT, not one per detection', async () => {
    // 40 pages x 250 rows = 10,000 detections spread over 5 endpoints. The old
    // shape returned all 10,000 row objects to its caller and kept them for the
    // life of the call.
    const fake = fakeCompliance(40, { holdMs: 0, rowsPerPage: 250, endpoints: 5 });
    const analysis = await analyzeExposure(fake.module);

    expect(analysis.detections.rowsExamined).toBe(10_000);
    expect(analysis.detections.aboveThreshold).toBe(10_000);
    // The only per-row structure that survives the walk is one row per endpoint.
    expect(analysis.newestDetectionPerEndpoint).toHaveLength(5);
    expect(analysis.byEndpoint.size).toBe(5);
    // ...and the surviving row carries that endpoint's NEWEST detection, which
    // is the single fact the scan-age lookup reads out of the raw rows.
    const ep0 = analysis.newestDetectionPerEndpoint.find((r) => r.endpointName === 'EP-0');
    expect(ep0?.detected).toBe(new Date(1_700_000_000_000 + 9_995).toISOString());
  });
});
