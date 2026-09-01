/**
 * get_unpatched_endpoints — endpoint-walk completeness tests (audit finding H4).
 *
 * ── The defect these exist to catch ─────────────────────────────────────────
 * `loadEndpoints` was the hand-rolled do/while that `packages/mcp-core/src/
 * paginate.ts:11-15` names as its own reference implementation — and which was
 * never migrated. It read `totalPages`, threw it away, stopped at
 * `MAX_ENDPOINT_PAGES` (25) and returned a bare array whose length was then
 * published as `totals.endpointsInEstate`, with no `truncated` field and no
 * caveat.
 *
 * Past the bound the failure is not a missing row, it is a confident wrong
 * sentence. Every endpoint on an unread page loses its `lastSeen`, so it is
 * rendered `reachable: false` with the blocker:
 *
 *     "No endpoint record matches this name in the endpoints listing — the
 *      vulnerability rows key on display name only, so a renamed or deleted
 *      endpoint still carries detections."
 *
 * That is a specific, plausible, wrong explanation for a machine that exists.
 * It also silently shrinks `neverScannedReachable`, which iterates the same
 * truncated array.
 *
 * This module has the most rigorous `caveats` machinery in the repository — six
 * distinct conditions, each with plain-language prose — which is exactly what
 * made the omission invisible on review. `exposure-library-integrity.test.ts`
 * covers the library and detections walks thoroughly and does not touch
 * `loadEndpoints`.
 *
 * ── Isolation ───────────────────────────────────────────────────────────────
 * Both composites this exercises persist to `os.tmpdir()`, so `node:os` is
 * mocked to a per-run directory — otherwise these tests would overwrite the
 * developer's real vulnerability-library and scan-history caches.
 *
 * All names, ids and CVEs below are synthesised. This is heading for public
 * release; fixtures carry no real host or GUID.
 */

import { afterAll, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AxiosInstance } from 'axios';
import type { ComplianceModule } from '../modules/compliance.js';

const TEST_TMP = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  return mkdtempSync(join(tmpdir(), 'unpatched-walk-test-'));
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, tmpdir: () => TEST_TMP }, tmpdir: () => TEST_TMP };
});

afterAll(() => {
  rmSync(TEST_TMP, { recursive: true, force: true });
});

/** The module's own bound, restated so the stub can straddle it deliberately. */
const MAX_ENDPOINT_PAGES = 25;

/**
 * Rows the stub puts on a page.
 *
 * Deliberately tiny, and deliberately not the module's `PageSize: 1000`. The
 * subject here is page arithmetic — how many pages were read out of how many,
 * and which endpoints fell outside — and none of that depends on how full a
 * page is. A stub that returned 1,000 rows per page materialised 25,000 objects
 * per case and pushed these tests past vitest's 5 s timeout under parallel
 * load, which is a slow test, not a stronger one. A server returning fewer rows
 * than the requested PageSize is also perfectly legal.
 */
const ROWS_PER_PAGE = 2;

const endpointName = (n: number) => `ENDPOINT-${String(n).padStart(5, '0')}`;
const endpointId = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

interface Scenario {
  /** Pages the endpoints listing claims. */
  endpointPages: number;
  /** Endpoint indices that carry a detection, so they appear in the ranking. */
  detectedIndices: number[];
}

/**
 * A compliance server stand-in: a one-entry CVE library, and one detection per
 * requested endpoint index. Small on purpose — the library and detections walks
 * are already covered by `exposure-library-integrity.test.ts`; the subject here
 * is the endpoint walk.
 */
function stubCompliance(scenario: Scenario) {
  const CVE_ID = '11111111-1111-1111-1111-111111111111';
  const module = {
    // The cache partitions on the identity of the CLIENT that fetched the
    // rows, not on ambient env vars, so a faithful fake must carry one.
    getHttpClient: () => ({
      defaults: { baseURL: 'https://bms-test.invalid/bconnect', headers: { common: { 'X-Api-Key': 'test-key' } } },
    }),
    async getAllVulnerabilities() {
      return {
        totalPages: 1,
        totalItems: 1,
        data: [{ id: CVE_ID, cveId: 'CVE-0000-00001', cvssScore: 9.8, severity: 'Critical' }],
      };
    },
    async getAllDetectedVulnerabilities() {
      return {
        totalPages: 1,
        totalItems: scenario.detectedIndices.length,
        data: scenario.detectedIndices.map((n) => ({
          vulnerabilityId: CVE_ID,
          endpointName: endpointName(n),
          endpointId: endpointId(n),
          detected: '2026-08-01T00:00:00Z',
          isIgnored: false,
        })),
      };
    },
  } as unknown as ComplianceModule;
  return module;
}

interface Recorded {
  url: string;
  params: Record<string, unknown>;
}

/** An HTTP stand-in serving the endpoints listing and an empty job history. */
function stubHttp(scenario: Scenario) {
  const requests: Recorded[] = [];
  const http = {
    async get(url: string, config: { params: Record<string, unknown> }) {
      requests.push({ url, params: config.params });

      if (url.includes('/JobInstances')) {
        return { data: { totalPages: 1, totalItems: 0, data: [] } };
      }

      const page = Number(config.params.Page ?? 0);
      return {
        data: {
          currentPage: page,
          pageSize: ROWS_PER_PAGE,
          totalPages: scenario.endpointPages,
          totalItems: scenario.endpointPages * ROWS_PER_PAGE,
          data: Array.from({ length: ROWS_PER_PAGE }, (_, i) => {
            const n = page * ROWS_PER_PAGE + i;
            return {
              id: endpointId(n),
              displayName: endpointName(n),
              type: 'WindowsEndpoint',
              operatingSystem: 'Synthetic OS',
              lastSeen: new Date().toISOString(),
              activity: null,
            };
          }),
        },
      };
    },
  } as unknown as AxiosInstance;
  return { http, requests, endpointRequests: () => requests.filter((r) => r.url.includes('/Endpoints')) };
}

/** Fresh module registry per test — exposure and scan-recency hold module-scope caches. */
async function run(scenario: Scenario, opts: Record<string, unknown> = {}) {
  vi.resetModules();
  rmSync(join(TEST_TMP, 'bconnect-mcp'), { recursive: true, force: true });
  const { getUnpatchedEndpoints } = await import('../modules/unpatched.js');
  const http = stubHttp(scenario);
  const res = await getUnpatchedEndpoints(stubCompliance(scenario), http.http, {
    refresh: true,
    ...opts,
  });
  return { res, http };
}

describe('getUnpatchedEndpoints — the endpoint walk must not be presented as the estate (H4)', () => {
  it('reports the server-stated estate size, not the length of a bounded walk', async () => {
    // 40 pages against a 25-page bound.
    const { res } = await run({ endpointPages: 40, detectedIndices: [0] });
    const totals = res.totals as Record<string, unknown>;

    // Before the fix this was the truncated array's length (25 pages' worth),
    // published under a field name that says "in estate".
    expect(totals.endpointsInEstate).toBe(40 * ROWS_PER_PAGE);
    expect(totals.endpointsExamined).toBe(MAX_ENDPOINT_PAGES * ROWS_PER_PAGE);
    expect(totals.endpointWalkTruncated).toBe(true);
  });

  it('does not blame a missing endpoint record when the walk simply did not reach it', async () => {
    // The detection is on an endpoint that lives on page 39, past the bound.
    const beyond = 39 * ROWS_PER_PAGE + 1;
    const { res } = await run({ endpointPages: 40, detectedIndices: [beyond] });

    const rows = res.endpoints as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.endpointName === endpointName(beyond));
    expect(row, 'the endpoint must still be listed, labelled').toBeDefined();

    const blockers = (row?.blockers as string[]) ?? [];
    // The confident wrong explanation.
    expect(blockers.join(' ')).not.toMatch(/renamed or deleted endpoint/i);
    // The true one, carrying the numbers.
    expect(blockers.join(' ')).toMatch(/25 of 40/);
  });

  it('keeps the renamed-or-deleted explanation when the walk WAS complete', async () => {
    // One page, and a detection for a name that is genuinely not in the listing.
    const orphan = 999_999;
    const { res } = await run({ endpointPages: 1, detectedIndices: [orphan] });

    const rows = res.endpoints as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.endpointName === endpointName(orphan));
    const blockers = (row?.blockers as string[]) ?? [];
    expect(blockers.join(' ')).toMatch(/renamed or deleted endpoint/i);
    expect((res.totals as Record<string, unknown>).endpointWalkTruncated).toBe(false);
  });

  it('raises a caveat and clears resultTrustworthy when the endpoint walk is truncated', async () => {
    const { res } = await run({ endpointPages: 40, detectedIndices: [0] });

    const caveats = res.caveats as string[];
    expect(caveats.join(' ')).toMatch(/ENDPOINT LISTING IS INCOMPLETE/i);
    expect(caveats.join(' ')).toMatch(/25 of 40/);

    const meta = res.meta as Record<string, unknown>;
    expect(meta.resultTrustworthy).toBe(false);
    expect(meta.resultTrustworthyReasons).toEqual(
      expect.arrayContaining([expect.stringContaining('25 of 40')])
    );
  });

  it('warns that neverScannedReachable is itself short when the walk is truncated', async () => {
    const { res } = await run({ endpointPages: 40, detectedIndices: [0] });
    const caveats = res.caveats as string[];

    // The pre-existing caveat already names `neverScannedReachable`, so matching
    // the field name alone would pass against the unfixed build and prove
    // nothing. What has to be new is the statement that the LIST is short —
    // it is built by filtering the same truncated array.
    const about = caveats.filter((c) => c.includes('neverScannedReachable'));
    expect(about.join(' ')).toMatch(/25 of 40/);
    expect(about.join(' ')).toMatch(/incomplete|not exhaustive|short/i);
  });

  it('leaves resultTrustworthy true on a complete walk', async () => {
    const { res } = await run({ endpointPages: 1, detectedIndices: [3] });
    const meta = res.meta as Record<string, unknown>;
    expect(meta.resultTrustworthy).toBe(true);
    expect(meta.resultTrustworthyReasons).toEqual([]);
    expect((res.caveats as string[]).join(' ')).not.toMatch(/ENDPOINT LISTING IS INCOMPLETE/i);
  });
});

describe('getUnpatchedEndpoints — the endpoint walk must be ordered (H4)', () => {
  it('sends an explicit OrderBy on every endpoint page request', async () => {
    const { http } = await run({ endpointPages: 3, detectedIndices: [0] });
    const eps = http.endpointRequests();
    expect(eps.length).toBe(3);
    for (const r of eps) {
      // Measured live 2026-08-03 against 26R1: the default order of
      // /endpoints/v2.0/Endpoints is not sorted by anything, `DisplayName asc`
      // is honoured, and an unknown property answers HTTP 400.
      expect(r.params.OrderBy).toBe('DisplayName asc');
    }
    expect(eps.map((r) => r.params.Page)).toEqual([0, 1, 2]);
  });

  it('stops at the module bound rather than walking a runaway totalPages', async () => {
    const { http } = await run({ endpointPages: 400, detectedIndices: [0] });
    expect(http.endpointRequests().length).toBe(MAX_ENDPOINT_PAGES);
  });
});
