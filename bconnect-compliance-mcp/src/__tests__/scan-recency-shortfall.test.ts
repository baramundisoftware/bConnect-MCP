/**
 * scan-recency — the last totalItems-blind walk in the suite (census of
 * 2026-08-13 found every other estate walk covered).
 *
 * The job-history walk cast away `totalItems`, derived completeness from
 * pages alone, and fed the most consequential claim its module makes:
 * `neverScanned` — what an operator reads as "nobody has ever looked at these
 * machines". Under the live-measured empty-page-under-intact-header state the
 * walk completed untruncated, `neverScannedTrustworthy` stayed true, every
 * endpoint's note read "No scan evidence from either signal", and — worse —
 * the short-served history passed the pages-only cache validation and was
 * persisted as fact for the full 15-minute TTL.
 *
 * Controls pin: a genuinely empty history (totalItems 0 — an estate that has
 * never run a compliance scan job) stays clean and trustworthy, and a
 * page-cap truncation remains ONE condition with the cap's own wording.
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
  return mkdtempSync(join(tmpdir(), 'scan-recency-shortfall-test-'));
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, tmpdir: () => TEST_TMP }, tmpdir: () => TEST_TMP };
});

afterAll(() => {
  rmSync(TEST_TMP, { recursive: true, force: true });
});

const CVE_ID = '11111111-1111-1111-1111-111111111111';
const EP = (n: number) => `ENDPOINT-${String(n).padStart(5, '0')}`;
const EP_ID = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

interface Envelope {
  data: Array<Record<string, unknown>>;
  totalPages: number;
  totalItems: number;
}

const scanInstance = (n: number): Record<string, unknown> => ({
  endpointName: EP(n),
  endpointId: EP_ID(n),
  jobDefinitionName: 'SCAN: Weekly Security Scan',
  steps: [{ type: 'WindowsVulnerabilityScan', state: 'FinishedSuccessfully', lastAction: '2026-08-01T00:00:00Z' }],
});

const endpointRow = (n: number): Record<string, unknown> => ({
  id: EP_ID(n),
  displayName: EP(n),
  type: 'WindowsEndpoint',
  operatingSystem: 'Synthetic OS',
  lastSeen: new Date().toISOString(),
  activity: null,
});

function stubCompliance(): ComplianceModule {
  return {
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
        totalItems: 1,
        data: [{
          vulnerabilityId: CVE_ID, endpointName: EP(0), endpointId: EP_ID(0),
          detected: '2026-08-01T00:00:00Z', isIgnored: false,
        }],
      };
    },
  } as unknown as ComplianceModule;
}

function stubHttp(jobHistory: Envelope): AxiosInstance {
  return {
    async get(url: string) {
      if (url.includes('/JobInstances')) {
        return { data: { currentPage: 0, ...jobHistory } };
      }
      return { data: {
        currentPage: 0, totalPages: 1, totalItems: 2,
        data: [endpointRow(0), endpointRow(1)],
      } };
    },
  } as unknown as AxiosInstance;
}

async function runUnpatched(jobHistory: Envelope, opts: Record<string, unknown> = { refresh: true }) {
  vi.resetModules();
  rmSync(join(TEST_TMP, 'bconnect-mcp'), { recursive: true, force: true });
  const { getUnpatchedEndpoints } = await import('../modules/unpatched.js');
  return await getUnpatchedEndpoints(stubCompliance(), stubHttp(jobHistory), opts);
}

describe('the job-history walk — short-served but NOT truncated', () => {
  it('an empty history page under an intact header breaks trust and untrusts neverScanned', async () => {
    const res = await runUnpatched({ data: [], totalPages: 1, totalItems: 231 });

    const meta = res.meta as Record<string, unknown>;
    expect(meta.resultTrustworthy).toBe(false);
    expect((meta.resultTrustworthyReasons as string[]).join(' ')).toMatch(/231/);

    // The wiring unpatched already has for a bounded history must fire here
    // too: scanSource "none" means no evidence was READ, not never scanned.
    expect((res.caveats as string[]).join(' ')).toMatch(/no evidence was read/i);

    const scanRecency = res.scanRecency as Record<string, unknown>;
    expect(scanRecency.neverScannedTrustworthy).toBe(false);
    expect(String(scanRecency.neverScannedNote ?? '')).toMatch(/no evidence found/i);
  });

  it('a short-served history is NOT persisted: the next call refetches instead of serving the lie', async () => {
    // Run 1: short-served. Before the fix this walk passed the pages-only
    // cache validation and was written to disk as fact.
    vi.resetModules();
    rmSync(join(TEST_TMP, 'bconnect-mcp'), { recursive: true, force: true });
    let mod = await import('../modules/unpatched.js');
    await mod.getUnpatchedEndpoints(stubCompliance(), stubHttp({ data: [], totalPages: 1, totalItems: 231 }), { refresh: true });

    // Run 2: the server recovers. Fresh module registry, SAME disk cache dir,
    // no refresh — a poisoned cache would be served for its 15-minute TTL and
    // report zero scan evidence over a healthy history.
    vi.resetModules();
    mod = await import('../modules/unpatched.js');
    const res2 = await mod.getUnpatchedEndpoints(
      stubCompliance(),
      stubHttp({ data: [scanInstance(0), scanInstance(1)], totalPages: 1, totalItems: 2 }),
      {},
    );

    const meta2 = res2.meta as Record<string, unknown>;
    const scanAge = meta2.scanAge as Record<string, unknown>;
    expect(scanAge.jobInstancesExamined).toBe(2);
    expect(meta2.resultTrustworthy).toBe(true);
  });
});

describe('controls — the guard stays quiet where nothing is wrong', () => {
  it('a genuinely empty job history (totalItems 0) is an estate that never scanned, and stays trustworthy', async () => {
    const res = await runUnpatched({ data: [], totalPages: 1, totalItems: 0 });

    const meta = res.meta as Record<string, unknown>;
    expect(meta.resultTrustworthy).toBe(true);
    expect(meta.resultTrustworthyReasons).toEqual([]);
    const scanRecency = res.scanRecency as Record<string, unknown>;
    expect(scanRecency.neverScannedTrustworthy).toBe(true);
  });

  it('a fully-served history stays trustworthy with its evidence counted', async () => {
    const res = await runUnpatched({ data: [scanInstance(0)], totalPages: 1, totalItems: 1 });

    const meta = res.meta as Record<string, unknown>;
    expect(meta.resultTrustworthy).toBe(true);
    expect((meta.scanAge as Record<string, unknown>).jobInstancesExamined).toBe(1);
  });
});

describe('get_vulnerability_exposure meta — pagesFetched never travels alone (H1)', () => {
  it('scanAge carries totalPages, truncated and the incompleteness sentence beside pagesFetched', async () => {
    vi.resetModules();
    rmSync(join(TEST_TMP, 'bconnect-mcp'), { recursive: true, force: true });
    const { getVulnerabilityExposure } = await import('../modules/exposure.js');
    const res = await getVulnerabilityExposure(
      stubCompliance(),
      { includeScanAge: true, refreshLibrary: true } as never,
      stubHttp({ data: [scanInstance(0)], totalPages: 1, totalItems: 1 }),
    ) as Record<string, unknown>;

    const scanAge = (res.meta as Record<string, unknown>).scanAge as Record<string, unknown>;
    expect(scanAge).toBeDefined();
    expect(scanAge).toHaveProperty('historyTotalPages');
    expect(scanAge).toHaveProperty('historyTruncated');
    expect(scanAge).toHaveProperty('historyIncomplete');
  });
});
