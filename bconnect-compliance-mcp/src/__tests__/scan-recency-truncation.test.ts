/**
 * scan-recency — truncation, ordering and cache-honesty tests (audit finding H1).
 *
 * ── The defect these exist to catch ─────────────────────────────────────────
 * `loadComplianceScanHistory` read `totalPages` off the envelope and then threw
 * it away. The walk stopped at `MAX_HISTORY_PAGES` (25) and the truncated
 * reduction was written to `%TEMP%/bconnect-mcp/compliance-scan-history.json`
 * **unconditionally**, then served as fact for a 15-minute TTL. Demonstrated at
 * 25 of 40 pages:
 *
 *     meta       : {"instancesExamined":25,"pagesFetched":25,...}   no totalPages, no truncated
 *     HOST-P39   : {"scanSource":"none",
 *                   "note":"No scan evidence from either signal. ..."}
 *     disk cache written with the truncated history? true
 *
 * The note is the defect. The module asserted "no scan evidence from either
 * signal" when the true statement was "we stopped reading at page 25 of 40" —
 * and that flows into `get_unpatched_endpoints`'s `neverScannedReachable`, the
 * field whose entire purpose is to say "nobody has ever looked at this machine".
 *
 * Ordering made it worse. The walk sent no `OrderBy`, and the server's default
 * order was measured to be neither ascending nor descending, so a 25-page cap
 * read an *arbitrary* 25,000 instances — non-deterministic between runs, then
 * frozen on disk for 15 minutes.
 *
 * Before this file, `grep -rl "scan-recency\|loadComplianceScanHistory"`
 * returned four source files and ZERO test files.
 *
 * ── Isolation ───────────────────────────────────────────────────────────────
 * The module computes its cache path from `os.tmpdir()` at import time and the
 * path is fixed and shared, so `node:os` is mocked to a per-run temp directory.
 * Without that these tests would overwrite the real cache on the developer's
 * machine — which is finding H2 in miniature, and is exactly what the audit's
 * own probe did.
 *
 * Endpoint names are synthesised. This is heading for public release; fixtures
 * carry no real host.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fingerprintFromHttpClient, fingerprintedCacheName } from '@bconnect/mcp-core';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir as realTmpdir } from 'node:os';
import type { AxiosInstance } from 'axios';

const TEST_TMP = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  return mkdtempSync(join(tmpdir(), 'scan-recency-test-'));
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, tmpdir: () => TEST_TMP }, tmpdir: () => TEST_TMP };
});

const CACHE_DIR = join(TEST_TMP, 'bconnect-mcp');
// Per-TENANT filename (H2). A fixed path let two configurations under one OS
// user read each other's scan history — and this module keys by endpoint
// DISPLAY NAME, which collides across estates.
/** The identity every stub in this file presents to the cache. */
const STUB_CLIENT_DEFAULTS = {
  baseURL: 'https://bms-truncation.example.invalid/bconnect',
  headers: { common: { 'X-Api-Key': 'truncation-test-key' } },
};
const STUB_FINGERPRINT = fingerprintFromHttpClient({ defaults: STUB_CLIENT_DEFAULTS });
const CACHE_FILE = join(
  CACHE_DIR,
  fingerprintedCacheName('compliance-scan-history.json', STUB_FINGERPRINT)
);

afterAll(() => {
  rmSync(TEST_TMP, { recursive: true, force: true });
});

/** The module's own bound. Kept here so the stub can straddle it deliberately. */
const MAX_HISTORY_PAGES = 25;
const PAGE_SIZE = 1000;

interface Recorded {
  params: Record<string, unknown>;
}

/**
 * A job-history server stand-in.
 *
 * Every page carries one instance with a successful `WindowsComplianceScan` for
 * `ENDPOINT-P<page>`, so "which endpoints are visible" is exactly "which pages
 * were read" — the property the truncation tests turn on.
 */
function stubHistory(totalPages: number) {
  const requests: Recorded[] = [];
  const http = {
    // The cache fingerprints the CLIENT (since 2026-08-14), so a stub without
    // `defaults` hashes the empty-input constant — which is not this tenant and
    // only matched the old env-based path by coincidence.
    defaults: STUB_CLIENT_DEFAULTS,
    async get(_url: string, config: { params: Record<string, unknown> }) {
      requests.push({ params: config.params });
      const page = Number(config.params.Page ?? 0);
      return {
        data: {
          currentPage: page,
          pageSize: PAGE_SIZE,
          totalPages,
          totalItems: totalPages,
          data: [
            {
              endpointName: `ENDPOINT-P${page}`,
              endpointId: `00000000-0000-0000-0000-${String(page).padStart(12, '0')}`,
              jobDefinitionName: 'Synthetic Compliance Scan',
              lastAction: `2026-0${(page % 9) + 1}-01T00:00:00Z`,
              steps: [
                {
                  type: 'WindowsComplianceScan',
                  state: 'FinishedSuccessfully',
                  lastAction: `2026-0${(page % 9) + 1}-01T00:00:00Z`,
                },
              ],
            },
          ],
        },
      };
    },
  } as unknown as AxiosInstance;
  return { http, requests };
}

/** A fresh module registry per test — the module holds cache state at module scope. */
async function freshModule() {
  vi.resetModules();
  rmSync(CACHE_DIR, { recursive: true, force: true });
  return import('../modules/scan-recency.js');
}

beforeEach(() => {
  rmSync(CACHE_DIR, { recursive: true, force: true });
});

describe('loadComplianceScanHistory — a bounded walk must say it was bounded (H1)', () => {
  it('reports totalPages and truncated, not just pagesFetched', async () => {
    const mod = await freshModule();
    const stub = stubHistory(40);
    const index = await mod.getScanRecency(stub.http, []);

    expect(index.meta.pagesFetched).toBe(MAX_HISTORY_PAGES);
    // `pagesFetched: 25` alone is indistinguishable from "the history was 25
    // pages long". These two are what make it readable.
    expect(index.meta.historyTotalPages).toBe(40);
    expect(index.meta.historyTruncated).toBe(true);
    expect(index.meta.historyIncomplete).toEqual(expect.stringContaining('25'));
    expect(index.meta.historyIncomplete).toEqual(expect.stringContaining('40'));
  });

  it('does not claim "no scan evidence" for an endpoint whose scan sits beyond the bound', async () => {
    const mod = await freshModule();
    const stub = stubHistory(40);
    const index = await mod.getScanRecency(stub.http, [], {
      extraEndpoints: [{ name: 'ENDPOINT-P39', id: null }],
    });

    const row = index.byEndpoint.get('ENDPOINT-P39');
    expect(row).toBeDefined();
    expect(row?.scanSource).toBe('none');
    // The wrong sentence. It is a claim about the estate made from a partial read.
    expect(row?.note ?? '').not.toMatch(/No scan evidence from either signal/i);
    // The right one names the bound.
    expect(row?.note ?? '').toMatch(/page 25 of 40/i);
    expect(row?.note ?? '').toMatch(/not evidence/i);
  });

  it('leaves the plain "no scan evidence" note intact when the walk was complete', async () => {
    const mod = await freshModule();
    const stub = stubHistory(3);
    const index = await mod.getScanRecency(stub.http, [], {
      extraEndpoints: [{ name: 'ENDPOINT-NEVER', id: null }],
    });

    expect(index.meta.historyTruncated).toBe(false);
    expect(index.meta.historyIncomplete).toBeNull();
    const row = index.byEndpoint.get('ENDPOINT-NEVER');
    expect(row?.note ?? '').toMatch(/No scan evidence from either signal/i);
  });
});

describe('loadComplianceScanHistory — the walk must be ordered (H1)', () => {
  it('sends an explicit OrderBy on every page request', async () => {
    const mod = await freshModule();
    const stub = stubHistory(4);
    await mod.getScanRecency(stub.http, []);

    expect(stub.requests.length).toBe(4);
    for (const r of stub.requests) {
      // Measured live 2026-08-03 against 26R1: the default order is neither
      // ascending nor descending, `LastAction desc` is honoured, and lastAction
      // is populated on 229 of 229 instances while `start` is blank on 29 —
      // which is why this is LastAction and not the Start the audit suggested.
      expect(r.params.OrderBy).toBe('LastAction desc');
    }
  });
});

describe('loadComplianceScanHistory — a truncated walk must not be cached as fact (H1)', () => {
  it('refuses to write a truncated history to disk', async () => {
    const mod = await freshModule();
    const stub = stubHistory(40);
    await mod.getScanRecency(stub.http, []);

    expect(existsSync(CACHE_FILE)).toBe(false);
  });

  it('still writes a complete history to disk, recording its own completeness', async () => {
    const mod = await freshModule();
    const stub = stubHistory(3);
    await mod.getScanRecency(stub.http, []);

    expect(existsSync(CACHE_FILE)).toBe(true);
    const raw = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Record<string, unknown>;
    expect(raw.truncated).toBe(false);
    expect(raw.totalPages).toBe(3);
    expect(raw.pagesFetched).toBe(3);
  });

  it('refuses a cache payload that does not record its own completeness (legacy format)', async () => {
    const mod = await freshModule();

    // Exactly the shape a pre-fix build wrote: no `truncated`, no `totalPages`.
    // A poisoned copy of one of those is already sitting in %TEMP% on any host
    // that ran the old build, so it must self-heal rather than be trusted.
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(
      CACHE_FILE,
      JSON.stringify({
        // Correct provenance on purpose: without it the payload guard added
        // 2026-08-14 rejects this plant first, and the assertion below would
        // pass while no longer testing completeness at all.
        provenance: STUB_FINGERPRINT,
        fetchedAt: Date.now(),
        entries: [
          [
            'ENDPOINT-STALE',
            {
              endpointId: null,
              lastAttempt: '2020-01-01T00:00:00Z',
              lastSuccess: '2020-01-01T00:00:00Z',
              stepState: 'FinishedSuccessfully',
              jobName: 'Legacy',
              inProgress: false,
            },
          ],
        ],
        instancesExamined: 25,
        pagesFetched: 25,
        bytes: 4873,
      }),
      'utf8'
    );

    const stub = stubHistory(2);
    const index = await mod.getScanRecency(stub.http, []);

    // Refetched, not served from the legacy file.
    expect(index.meta.fromCache).toBe(false);
    expect(stub.requests.length).toBe(2);
    expect(index.byEndpoint.has('ENDPOINT-STALE')).toBe(false);
  });

  it('refuses a cache payload that records itself as truncated', async () => {
    const mod = await freshModule();

    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(
      CACHE_FILE,
      JSON.stringify({
        // Correct provenance on purpose: without it the payload guard added
        // 2026-08-14 rejects this plant first, and the assertion below would
        // pass while no longer testing completeness at all.
        provenance: STUB_FINGERPRINT,
        fetchedAt: Date.now(),
        entries: [],
        instancesExamined: 25,
        pagesFetched: 25,
        bytes: 10,
        totalPages: 40,
        truncated: true,
        orderBy: 'LastAction desc',
      }),
      'utf8'
    );

    const stub = stubHistory(2);
    const index = await mod.getScanRecency(stub.http, []);
    expect(index.meta.fromCache).toBe(false);
    expect(stub.requests.length).toBe(2);
  });
});

describe('summarizeScanRecency — neverScanned must not be presented as fact over a partial walk (H1)', () => {
  it('flags neverScanned as untrustworthy and says why when the history was truncated', async () => {
    const mod = await freshModule();
    const stub = stubHistory(40);
    const index = await mod.getScanRecency(stub.http, [], {
      extraEndpoints: [{ name: 'ENDPOINT-P39', id: null }],
    });

    const summary = mod.summarizeScanRecency(index, 30);
    expect(summary.neverScanned).toEqual(expect.arrayContaining(['ENDPOINT-P39']));
    expect(summary.neverScannedTrustworthy).toBe(false);
    expect(String(summary.neverScannedNote ?? '')).toMatch(/page 25 of 40/i);
  });

  it('marks neverScanned trustworthy when the walk covered the history', async () => {
    const mod = await freshModule();
    const stub = stubHistory(2);
    const index = await mod.getScanRecency(stub.http, [], {
      extraEndpoints: [{ name: 'ENDPOINT-NEVER', id: null }],
    });

    const summary = mod.summarizeScanRecency(index, 30);
    expect(summary.neverScanned).toEqual(['ENDPOINT-NEVER']);
    expect(summary.neverScannedTrustworthy).toBe(true);
    expect(summary.neverScannedNote).toBeNull();
  });
});

// Guard against the isolation itself silently failing: if `node:os` were not
// mocked, every test above would be reading and writing the developer's real
// cache and the truncation assertions would pass for the wrong reason.
describe('test isolation', () => {
  it('points the cache at a per-run temp directory, not the shared one', async () => {
    // `node:os` is mocked for this file, so `tmpdir()` here is the mocked one
    // too — which is the point: the module under test resolves the same path.
    expect(realTmpdir()).toBe(TEST_TMP);
    expect(CACHE_DIR.startsWith(TEST_TMP)).toBe(true);
    expect(TEST_TMP).toMatch(/scan-recency-test-/);

    // And prove it end to end: a complete walk must leave its file inside the
    // per-run directory. If the mock ever stops applying, this fails rather
    // than quietly clobbering the developer's real cache.
    const mod = await freshModule();
    await mod.getScanRecency(stubHistory(1).http, []);
    expect(existsSync(CACHE_FILE)).toBe(true);
    expect(mkdtempSync).toBeTypeOf('function');
  });
});
