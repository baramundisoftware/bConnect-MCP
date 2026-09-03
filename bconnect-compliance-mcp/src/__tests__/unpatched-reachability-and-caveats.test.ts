/**
 * get_unpatched_endpoints — reachability, staleness and caveat branches
 * (F2 in phase4/optimization.md).
 *
 * `unpatched-endpoint-walk.test.ts` covers the endpoint-listing walk bound
 * (H4) thoroughly and already lifted this module from the audit's cited
 * 58.88%/9.52% to 88.67%/60.25% (statements/branches) by the time this file
 * was written — but every branch it left uncovered is a *join outcome*, not
 * a pagination detail: whether a row is judged reachable, whether a stale
 * scan gets flagged, whether the scan-recency lookup failing is disclosed,
 * whether `onlyReachable` actually drops rows before the caveats that
 * describe them are computed. This is exactly the "verdict" logic the
 * plausibility/truncation/cache-read-validation gap in the audit points at:
 * unpatched.ts is the module behind this project's worst known defect
 * (the SearchQuery/`validateParameters` finding lived one layer up, but this
 * is the tool `get_unpatched_endpoints` — the one a patch queue is read
 * from), so an untested verdict branch here is not an abstract coverage
 * number.
 *
 * `analyzeExposure` and `getScanRecency`/`summarizeScanRecency` are mocked
 * directly rather than driven through the disk cache and HTTP layers those
 * already-existing test files (`exposure-library-integrity.test.ts`,
 * `scan-recency-truncation.test.ts`) cover in depth — the subject here is
 * what `getUnpatchedEndpoints` DOES with their output, not how they produce
 * it. Only `loadEndpoints`' own HTTP call is stubbed for real.
 */

import { describe, expect, it, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import type { ComplianceModule } from '../modules/compliance.js';
import type { ExposureAnalysis } from '../modules/exposure.js';
import type { ScanRecencyIndex } from '../modules/scan-recency.js';

const analyzeExposureMock = vi.fn();
const getScanRecencyMock = vi.fn();
const summarizeScanRecencyMock = vi.fn((..._args: unknown[]) => ({ summarized: true }));

vi.mock('../modules/exposure.js', () => ({
  analyzeExposure: (...args: unknown[]) => analyzeExposureMock(...args),
}));
vi.mock('../modules/scan-recency.js', () => ({
  getScanRecency: (...args: unknown[]) => getScanRecencyMock(...args),
  summarizeScanRecency: (...args: unknown[]) => summarizeScanRecencyMock(...args),
}));

import { getUnpatchedEndpoints } from '../modules/unpatched.js';

const NOW = Date.now();
const isoDaysAgo = (days: number): string => new Date(NOW - days * 86_400_000).toISOString();

/** Minimal, valid ExposureAnalysis. Callers override just what the case needs. */
function analysis(overrides: Partial<ExposureAnalysis> = {}): ExposureAnalysis {
  return {
    library: new Map() as never,
    // Required since the trust flags became per-call values. It defaulted to
    // `undefined` here for a while and nothing caught it: this package's
    // tsconfig excludes `src/__tests__/**` and eslint runs without a `project`,
    // so no type-aware check reaches a test fixture. "Builds green, lint 0" does
    // not mean the test tier type-checks — worth knowing before trusting it.
    libraryFromCache: false,
    newestDetectionPerEndpoint: [],
    detections: {
      rowsExamined: 0,
      totalItems: 0,
      afterFilters: 0,
      aboveThreshold: 0,
      distinctCvesAboveThreshold: 0,
    },
    byEndpoint: new Map(),
    severityMix: {},
    unscored: 0,
    libraryUnavailable: null,
    detectionsIncomplete: null,
    ...overrides,
  };
}

/** One page of endpoints, served by loadEndpoints' own HTTP call. */
function stubHttp(rows: Array<Record<string, unknown>>): AxiosInstance {
  return {
    async get() {
      return { data: { totalPages: 1, totalItems: rows.length, data: rows } };
    },
  } as unknown as AxiosInstance;
}

const compliance = {} as unknown as ComplianceModule;

function emptyScanIndex(overrides: Partial<ScanRecencyIndex['meta']> = {}): ScanRecencyIndex {
  return {
    byEndpoint: new Map(),
    meta: {
      fromCache: false,
      loadMs: 0,
      cacheAgeSeconds: 0,
      instancesExamined: 0,
      pagesFetched: 0,
      historyTotalPages: 0,
      historyTotalItems: null,
      historyTruncated: false,
      historyOrderBy: 'x',
      historyIncomplete: null,
      historyBytes: 0,
      endpointsWithScanEvidence: 0,
      ...overrides,
    },
  };
}

describe('getUnpatchedEndpoints — scan-recency lookup failure is disclosed, not swallowed', () => {
  it('degrades gracefully when getScanRecency throws: caveat added, scan fields null, resultTrustworthy false', async () => {
    analyzeExposureMock.mockResolvedValue(
      analysis({ byEndpoint: new Map([['EP-1', { count: 2, max: 8.1, worst: new Set(['CVE-1']) }]]) })
    );
    getScanRecencyMock.mockRejectedValue(new Error('vulnerability library cache is corrupt'));

    const http = stubHttp([{ id: 'e1', displayName: 'EP-1', lastSeen: isoDaysAgo(0) }]);
    const res = await getUnpatchedEndpoints(compliance, http);

    expect(res.caveats).toContainEqual(
      expect.stringContaining('Scan age unavailable: vulnerability library cache is corrupt')
    );
    const row = (res.endpoints as Array<Record<string, unknown>>)[0];
    expect(row.lastScan).toBeNull();
    expect(row.scanAgeDays).toBeNull();
    expect(row.scanIsStale).toBeNull();
    expect(row.scanSource).toBeNull();
    const meta = res.meta as Record<string, unknown>;
    expect(meta.scanAge).toBeNull();
    expect(meta.resultTrustworthy).toBe(false);
    expect(meta.resultTrustworthyReasons).toEqual(
      expect.arrayContaining([expect.stringContaining('could not be built')])
    );
    // scanRecency top-level field also degrades to null rather than throwing.
    expect(res.scanRecency).toBeNull();
  });
});

describe('getUnpatchedEndpoints — reachability blockers', () => {
  it('flags a resolved endpoint with lastSeen null as "Never checked in", not "not reachable"', async () => {
    analyzeExposureMock.mockResolvedValue(
      analysis({ byEndpoint: new Map([['EP-1', { count: 1, max: 9.0, worst: new Set(['CVE-1']) }]]) })
    );
    getScanRecencyMock.mockResolvedValue(emptyScanIndex());

    const http = stubHttp([{ id: 'e1', displayName: 'EP-1', lastSeen: null }]);
    const res = await getUnpatchedEndpoints(compliance, http);

    const row = (res.endpoints as Array<Record<string, unknown>>)[0];
    expect(row.reachable).toBe(false);
    expect(row.offlineDays).toBeNull();
    expect((row.blockers as string[]).join(' ')).toMatch(/Never checked in/);
    expect((row.blockers as string[]).join(' ')).not.toMatch(/day\(s\) ago/);
  });

  it('flags an endpoint offline longer than reachableWithinDays as unreachable, with the day count', async () => {
    analyzeExposureMock.mockResolvedValue(
      analysis({ byEndpoint: new Map([['EP-1', { count: 1, max: 9.0, worst: new Set(['CVE-1']) }]]) })
    );
    getScanRecencyMock.mockResolvedValue(emptyScanIndex());

    const http = stubHttp([{ id: 'e1', displayName: 'EP-1', lastSeen: isoDaysAgo(10) }]);
    const res = await getUnpatchedEndpoints(compliance, http, { reachableWithinDays: 1 });

    const row = (res.endpoints as Array<Record<string, unknown>>)[0];
    expect(row.reachable).toBe(false);
    expect(row.patchable).toBe(false);
    expect(row.offlineDays).toBe(10);
    expect((row.blockers as string[]).join(' ')).toMatch(/Last seen 10 day\(s\) ago/);

    // Listed rather than hidden (default onlyReachable: false), and the
    // caveat names it.
    const caveats = (res.caveats as string[]).join(' ');
    expect(caveats).toMatch(/not reachable now/);
  });

  it('does not require a check-in TODAY to call an endpoint reachable', async () => {
    // The default used to be 1 day, which is a property of a lab of always-on
    // VMs, not of bMS. On a laptop fleet, or over a weekend, that default
    // labels healthy machines unreachable and reports the whole patch queue as
    // unactionable — a false negative on the question this tool exists to
    // answer, pointing the operator at a connectivity problem instead.
    analyzeExposureMock.mockResolvedValue(
      analysis({ byEndpoint: new Map([['WEEKEND', { count: 4, max: 9.1, worst: new Set(['CVE-1']) }]]) })
    );
    getScanRecencyMock.mockResolvedValue(emptyScanIndex());

    const http = stubHttp([{ id: 'e1', displayName: 'WEEKEND', lastSeen: isoDaysAgo(3) }]);
    const res = await getUnpatchedEndpoints(compliance, http);

    const row = (res.endpoints as Array<Record<string, unknown>>)[0];
    expect(row.reachable).toBe(true);
    expect(row.patchable).toBe(true);
    expect(row.blockers).toEqual([]);
    // The window that was applied is stated, not assumed.
    expect((res.query as Record<string, unknown>).reachableWithinDays).toBe(7);
  });

  it('reports the estate\'s own check-in ages and warns when the window is shorter than them', async () => {
    // The window is the one input here that no API states. When the estate's
    // own behaviour contradicts it, the tool has to say so rather than quietly
    // reporting a healthy fleet as dark.
    analyzeExposureMock.mockResolvedValue(
      analysis({ byEndpoint: new Map([['SLOW', { count: 1, max: 8.0, worst: new Set(['CVE-1']) }]]) })
    );
    getScanRecencyMock.mockResolvedValue(emptyScanIndex());

    const http = stubHttp([
      { id: 'e1', displayName: 'SLOW', lastSeen: isoDaysAgo(20) },
      { id: 'e2', displayName: 'SLOW-2', lastSeen: isoDaysAgo(24) },
      { id: 'e3', displayName: 'SLOW-3', lastSeen: isoDaysAgo(28) },
    ]);
    const res = await getUnpatchedEndpoints(compliance, http);

    const reachability = (res.meta as Record<string, unknown>).reachability as Record<string, unknown>;
    expect(reachability.windowDays).toBe(7);
    expect(reachability.endpointsWithCheckIn).toBe(3);
    expect(reachability.medianCheckInAgeDays).toBe(24);
    expect((res.caveats as string[]).join(' ')).toMatch(
      /window is 7 day\(s\), but half the endpoints read here last checked in 24 or more day\(s\) ago/
    );
  });

  it('a freshly-seen endpoint within reachableWithinDays is reachable, with no blocker', async () => {
    analyzeExposureMock.mockResolvedValue(
      analysis({ byEndpoint: new Map([['EP-1', { count: 1, max: 9.0, worst: new Set(['CVE-1']) }]]) })
    );
    getScanRecencyMock.mockResolvedValue(emptyScanIndex());

    const http = stubHttp([{ id: 'e1', displayName: 'EP-1', lastSeen: isoDaysAgo(0) }]);
    const res = await getUnpatchedEndpoints(compliance, http);

    const row = (res.endpoints as Array<Record<string, unknown>>)[0];
    expect(row.reachable).toBe(true);
    expect(row.patchable).toBe(true);
    expect(row.blockers).toEqual([]);
  });

  it('onlyReachable=true drops the unreachable row AND its caveat, rather than merely re-labelling it', async () => {
    analyzeExposureMock.mockResolvedValue(
      analysis({
        byEndpoint: new Map([
          ['REACHABLE', { count: 1, max: 9.0, worst: new Set(['CVE-1']) }],
          ['DARK', { count: 5, max: 9.9, worst: new Set(['CVE-2']) }],
        ]),
      })
    );
    getScanRecencyMock.mockResolvedValue(emptyScanIndex());

    const http = stubHttp([
      { id: 'e1', displayName: 'REACHABLE', lastSeen: isoDaysAgo(0) },
      { id: 'e2', displayName: 'DARK', lastSeen: isoDaysAgo(400) },
    ]);
    const res = await getUnpatchedEndpoints(compliance, http, { onlyReachable: true });

    const names = (res.endpoints as Array<Record<string, unknown>>).map((r) => r.endpointName);
    expect(names).toEqual(['DARK', 'REACHABLE'].filter((n) => n === 'REACHABLE'));
    expect(names).not.toContain('DARK');
    // The "not reachable now" caveat is gated on `!onlyReachable` — with every
    // unreachable row filtered out first, it must not fire even though DARK
    // existed in the unfiltered set.
    expect((res.caveats as string[]).join(' ')).not.toMatch(/not reachable now/);
  });
});

describe('getUnpatchedEndpoints — scan-age caveats', () => {
  it('flags a stale scan (older than staleAfterDays) and says the count may be undercounted', async () => {
    analyzeExposureMock.mockResolvedValue(
      analysis({ byEndpoint: new Map([['EP-1', { count: 3, max: 9.5, worst: new Set(['CVE-1']) }]]) })
    );
    const scanIndex = emptyScanIndex();
    scanIndex.byEndpoint.set('EP-1', {
      endpointName: 'EP-1',
      endpointId: 'e1',
      lastScan: isoDaysAgo(90),
      scanAgeDays: 90,
      scanSource: 'detections',
      scanInProgress: false,
      scanJob: null,
      jobHistoryOptimisticByDays: null,
      note: null,
    });
    getScanRecencyMock.mockResolvedValue(scanIndex);

    const http = stubHttp([{ id: 'e1', displayName: 'EP-1', lastSeen: isoDaysAgo(0) }]);
    const res = await getUnpatchedEndpoints(compliance, http, { staleAfterDays: 30 });

    const row = (res.endpoints as Array<Record<string, unknown>>)[0];
    expect(row.scanIsStale).toBe(true);
    expect((res.totals as Record<string, unknown>).staleScansReturned).toBe(1);
    expect((res.caveats as string[]).join(' ')).toMatch(/older\s*$|scan older than 30 days/);
  });

  it('flags a wide span between the freshest and stalest returned scan age as not directly comparable', async () => {
    analyzeExposureMock.mockResolvedValue(
      analysis({
        byEndpoint: new Map([
          ['FRESH', { count: 1, max: 7.0, worst: new Set(['CVE-1']) }],
          ['STALE', { count: 1, max: 7.0, worst: new Set(['CVE-2']) }],
        ]),
      })
    );
    const scanIndex = emptyScanIndex();
    scanIndex.byEndpoint.set('FRESH', {
      endpointName: 'FRESH', endpointId: 'e1', lastScan: isoDaysAgo(1), scanAgeDays: 1,
      scanSource: 'detections', scanInProgress: false, scanJob: null,
      jobHistoryOptimisticByDays: null, note: null,
    });
    scanIndex.byEndpoint.set('STALE', {
      endpointName: 'STALE', endpointId: 'e2', lastScan: isoDaysAgo(200), scanAgeDays: 200,
      scanSource: 'detections', scanInProgress: false, scanJob: null,
      jobHistoryOptimisticByDays: null, note: null,
    });
    getScanRecencyMock.mockResolvedValue(scanIndex);

    const http = stubHttp([
      { id: 'e1', displayName: 'FRESH', lastSeen: isoDaysAgo(0) },
      { id: 'e2', displayName: 'STALE', lastSeen: isoDaysAgo(0) },
    ]);
    const res = await getUnpatchedEndpoints(compliance, http, { staleAfterDays: 30 });

    expect((res.caveats as string[]).join(' ')).toMatch(/span 1 to 200 days/);
  });

  it('does not raise the span caveat when only one returned row has a known scan age', async () => {
    analyzeExposureMock.mockResolvedValue(
      analysis({ byEndpoint: new Map([['EP-1', { count: 1, max: 7.0, worst: new Set(['CVE-1']) }]]) })
    );
    getScanRecencyMock.mockResolvedValue(emptyScanIndex());
    const http = stubHttp([{ id: 'e1', displayName: 'EP-1', lastSeen: isoDaysAgo(0) }]);

    const res = await getUnpatchedEndpoints(compliance, http);

    expect((res.caveats as string[]).join(' ')).not.toMatch(/not directly comparable/);
  });

  it('flags an in-progress scan on a returned row', async () => {
    analyzeExposureMock.mockResolvedValue(
      analysis({ byEndpoint: new Map([['EP-1', { count: 1, max: 7.0, worst: new Set(['CVE-1']) }]]) })
    );
    const scanIndex = emptyScanIndex();
    scanIndex.byEndpoint.set('EP-1', {
      endpointName: 'EP-1', endpointId: 'e1', lastScan: null, scanAgeDays: null,
      scanSource: 'job-history', scanInProgress: true, scanJob: 'Weekly scan',
      jobHistoryOptimisticByDays: null, note: null,
    });
    getScanRecencyMock.mockResolvedValue(scanIndex);
    const http = stubHttp([{ id: 'e1', displayName: 'EP-1', lastSeen: isoDaysAgo(0) }]);

    const res = await getUnpatchedEndpoints(compliance, http);

    const row = (res.endpoints as Array<Record<string, unknown>>)[0];
    expect(row.scanInProgress).toBe(true);
    expect((res.caveats as string[]).join(' ')).toMatch(/scan is in progress/);
  });
});

describe('getUnpatchedEndpoints — neverScannedReachable', () => {
  it('lists a reachable endpoint with zero vulnerabilities and no scan evidence, and caveats it', async () => {
    // Not in byEndpoint at all — zero detections above threshold.
    analyzeExposureMock.mockResolvedValue(analysis());
    getScanRecencyMock.mockResolvedValue(emptyScanIndex());
    const http = stubHttp([{ id: 'e1', displayName: 'CLEAN-BUT-UNKNOWN', lastSeen: isoDaysAgo(0) }]);

    const res = await getUnpatchedEndpoints(compliance, http);

    const list = res.neverScannedReachable as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0].endpointName).toBe('CLEAN-BUT-UNKNOWN');
    expect((res.caveats as string[]).join(' ')).toMatch(/no vulnerability scan on record at all/);
  });

  it('does NOT list a reachable endpoint that has scan evidence but zero vulnerabilities', async () => {
    analyzeExposureMock.mockResolvedValue(analysis());
    const scanIndex = emptyScanIndex();
    scanIndex.byEndpoint.set('CLEAN-AND-SCANNED', {
      endpointName: 'CLEAN-AND-SCANNED', endpointId: 'e1', lastScan: isoDaysAgo(2), scanAgeDays: 2,
      scanSource: 'job-history', scanInProgress: false, scanJob: 'Weekly scan',
      jobHistoryOptimisticByDays: null, note: null,
    });
    getScanRecencyMock.mockResolvedValue(scanIndex);
    const http = stubHttp([{ id: 'e1', displayName: 'CLEAN-AND-SCANNED', lastSeen: isoDaysAgo(0) }]);

    const res = await getUnpatchedEndpoints(compliance, http);

    expect(res.neverScannedReachable).toEqual([]);
  });

  it('does not list an unreachable endpoint even with no scan evidence', async () => {
    analyzeExposureMock.mockResolvedValue(analysis());
    getScanRecencyMock.mockResolvedValue(emptyScanIndex());
    const http = stubHttp([{ id: 'e1', displayName: 'DARK-UNKNOWN', lastSeen: isoDaysAgo(400) }]);

    const res = await getUnpatchedEndpoints(compliance, http);

    expect(res.neverScannedReachable).toEqual([]);
  });
});

describe('getUnpatchedEndpoints — upstream incompleteness is surfaced as loud, first-position caveats', () => {
  it('THE DETECTIONS LISTING IS INCOMPLETE leads when detectionsIncomplete is set', async () => {
    analyzeExposureMock.mockResolvedValue(
      analysis({ detectionsIncomplete: 'detected-vulnerability walk truncated at 200 of 250 pages' })
    );
    getScanRecencyMock.mockResolvedValue(emptyScanIndex());
    const http = stubHttp([]);

    const res = await getUnpatchedEndpoints(compliance, http);

    expect((res.caveats as string[])[0]).toMatch(/THE DETECTIONS LISTING IS INCOMPLETE/);
  });

  it('THIS QUEUE IS NOT TRUSTWORTHY is the loudest caveat, ahead of an incomplete detections walk', async () => {
    analyzeExposureMock.mockResolvedValue(
      analysis({
        detectionsIncomplete: 'detected-vulnerability walk truncated',
        libraryUnavailable: 'CVE library fetch returned 503',
        detections: {
          rowsExamined: 2,
          totalItems: 2,
          afterFilters: 2,
          aboveThreshold: 0,
          distinctCvesAboveThreshold: 0,
        },
      })
    );
    getScanRecencyMock.mockResolvedValue(emptyScanIndex());
    const http = stubHttp([]);

    const res = await getUnpatchedEndpoints(compliance, http);

    const caveats = res.caveats as string[];
    expect(caveats[0]).toMatch(/THIS QUEUE IS NOT TRUSTWORTHY/);
    expect(caveats[0]).toContain('Cause: CVE library fetch returned 503');
    expect(caveats.some((c) => c.includes('THE DETECTIONS LISTING IS INCOMPLETE'))).toBe(true);
  });

  it('passes through the scan-history walk\'s own incompleteness note as a caveat', async () => {
    analyzeExposureMock.mockResolvedValue(analysis());
    getScanRecencyMock.mockResolvedValue(
      emptyScanIndex({ historyIncomplete: 'job history truncated at 25 of 40 pages' })
    );
    const http = stubHttp([]);

    const res = await getUnpatchedEndpoints(compliance, http);

    expect((res.caveats as string[]).join(' ')).toMatch(/job history truncated at 25 of 40 pages/);
    expect((res.caveats as string[]).join(' ')).toMatch(/scanSource of "none" below means no evidence was read/);
  });
});

describe('getUnpatchedEndpoints — defensive parsing of a malformed endpoint row', () => {
  it('tolerates a page with no data array, a null id, and a missing displayName', async () => {
    analyzeExposureMock.mockResolvedValue(analysis());
    getScanRecencyMock.mockResolvedValue(emptyScanIndex());
    const http = {
      async get() {
        // No `data` key at all, and `totalPages` omitted — both must fall
        // back rather than throw.
        return { data: { totalItems: 0 } };
      },
    } as unknown as AxiosInstance;

    const res = await getUnpatchedEndpoints(compliance, http);
    expect((res.totals as Record<string, unknown>).endpointsExamined).toBe(0);
  });

  it('carries a real activity string through rather than only ever nulling it', async () => {
    analyzeExposureMock.mockResolvedValue(
      analysis({ byEndpoint: new Map([['EP-1', { count: 1, max: 7.0, worst: new Set(['CVE-1']) }]]) })
    );
    getScanRecencyMock.mockResolvedValue(emptyScanIndex());
    const http = stubHttp([
      { id: 'e1', displayName: 'EP-1', lastSeen: isoDaysAgo(0), activity: 'Unable to reach client via ping' },
    ]);

    const res = await getUnpatchedEndpoints(compliance, http);
    const row = (res.endpoints as Array<Record<string, unknown>>)[0];
    expect(row.currentActivity).toBe('Unable to reach client via ping');
  });

  it('says the estate size is unknown, rather than a bare 0, when a truncated walk\'s first page never reported totalItems', async () => {
    analyzeExposureMock.mockResolvedValue(analysis());
    getScanRecencyMock.mockResolvedValue(emptyScanIndex());
    // No `totalItems` key on any page, and enough pages to trip the bound.
    const http = {
      async get(_url: string, config: { params: Record<string, unknown> }) {
        const page = Number(config.params.Page ?? 0);
        return { data: { totalPages: 40, data: [{ id: `e${page}`, displayName: `EP-${page}`, lastSeen: isoDaysAgo(0) }] } };
      },
    } as unknown as AxiosInstance;

    const res = await getUnpatchedEndpoints(compliance, http);

    expect((res.caveats as string[]).join(' ')).toMatch(/an unknown number of endpoint record\(s\)/);
    // totals.endpointsInEstate falls back to what was actually read (25 pages
    // x 1 row) when the server never states totalItems — a different, already
    // -covered fallback (`?? endpoints.length`) from the caveat prose above.
    expect((res.totals as Record<string, unknown>).endpointsInEstate).toBe(25);
  });

  it('carries a null id and a missing activity/displayName through as null/empty rather than "null" strings', async () => {
    analyzeExposureMock.mockResolvedValue(
      analysis({ byEndpoint: new Map([['', { count: 1, max: 7.0, worst: new Set(['CVE-1']) }]]) })
    );
    getScanRecencyMock.mockResolvedValue(emptyScanIndex());
    // id, activity and displayName all absent from the server row.
    const http = stubHttp([{ lastSeen: isoDaysAgo(0) }]);

    const res = await getUnpatchedEndpoints(compliance, http);
    // The row keys on displayName === '', which the analysis map also uses,
    // so it resolves rather than falling into the "no endpoint record" path.
    const row = (res.endpoints as Array<Record<string, unknown>>)[0];
    expect(row.endpointName).toBe('');
    expect(row.currentActivity).toBeNull();
  });
});

describe('getUnpatchedEndpoints — scan-recency failure surfaces a non-Error throw too', () => {
  it('stringifies a thrown non-Error value rather than crashing', async () => {
    analyzeExposureMock.mockResolvedValue(
      analysis({ byEndpoint: new Map([['EP-1', { count: 1, max: 7.0, worst: new Set(['CVE-1']) }]]) })
    );
     
    getScanRecencyMock.mockRejectedValue('disk full');
    const http = stubHttp([{ id: 'e1', displayName: 'EP-1', lastSeen: isoDaysAgo(0) }]);

    const res = await getUnpatchedEndpoints(compliance, http);

    expect((res.caveats as string[]).join(' ')).toContain('Scan age unavailable: disk full');
  });
});

describe('getUnpatchedEndpoints — endpointId falls back from the endpoint record to the scan index', () => {
  it('uses the scan index endpointId when the row has no matching endpoint record', async () => {
    // Truncated walk (2 of 40 pages) so the missing-endpoint branch reads as
    // "beyond the bound" rather than "renamed or deleted", and endpointId
    // has no `ep` to come from — it must fall back to scan.endpointId.
    analyzeExposureMock.mockResolvedValue(
      analysis({ byEndpoint: new Map([['GHOST', { count: 1, max: 7.0, worst: new Set(['CVE-1']) }]]) })
    );
    const scanIndex = emptyScanIndex();
    scanIndex.byEndpoint.set('GHOST', {
      endpointName: 'GHOST', endpointId: 'scan-known-id', lastScan: isoDaysAgo(5), scanAgeDays: 5,
      scanSource: 'detections', scanInProgress: false, scanJob: null,
      jobHistoryOptimisticByDays: null, note: null,
    });
    getScanRecencyMock.mockResolvedValue(scanIndex);
    // The one endpoint page returned has a different name, so GHOST resolves
    // to no `ep`.
    const http = {
      async get() {
        return { data: { totalPages: 40, totalItems: 80, data: [{ id: 'e1', displayName: 'OTHER', lastSeen: isoDaysAgo(0) }] } };
      },
    } as unknown as AxiosInstance;

    const res = await getUnpatchedEndpoints(compliance, http);

    const row = (res.endpoints as Array<Record<string, unknown>>).find((r) => r.endpointName === 'GHOST');
    expect(row?.endpointId).toBe('scan-known-id');
  });
});

describe('getUnpatchedEndpoints — meta.scanAge mirrors a successful scan-recency lookup', () => {
  it('populates meta.scanAge from the index when the lookup succeeds', async () => {
    analyzeExposureMock.mockResolvedValue(analysis());
    getScanRecencyMock.mockResolvedValue(
      emptyScanIndex({ pagesFetched: 3, historyTotalPages: 3, instancesExamined: 12 })
    );
    const http = stubHttp([]);

    const res = await getUnpatchedEndpoints(compliance, http);
    const meta = res.meta as Record<string, unknown>;
    const scanAge = meta.scanAge as Record<string, unknown>;

    expect(scanAge).not.toBeNull();
    expect(scanAge.jobInstancesExamined).toBe(12);
    expect(scanAge.historyPagesFetched).toBe(3);
    expect(res.scanRecency).toEqual({ summarized: true });
  });
});
