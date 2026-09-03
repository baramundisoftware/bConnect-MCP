/**
 * scan-recency.ts — the load flags were MODULE state, and two calls shared them.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * `lastLoadWasCacheHit` and `lastLoadMs` lived at module scope.
 * `lastLoadWasCacheHit = false` was written BEFORE the history walk began, and
 * `getScanRecency` read it at the end of its own flow — with the whole walk in
 * between. A second call that hit the memory cache during that window set the
 * flag back to `true`, and the WALKING call then published `fromCache: true`.
 *
 * Its own header had recorded this as "known, deferred" on a severity judgement
 * that said it "should be checked rather than trusted". Checked, 2026-08-23,
 * against the in-repo mock with fault injection slowing the walk:
 *
 *     Y did a real 914 ms walk and reported  fromCache: true
 *
 * `meta.scanAge.historyFromCache` is a freshness disclosure in the module whose
 * entire subject is how current the data is — so the wrong value is exactly the
 * kind a reader would act on. `scripts/probe-composite-concurrency.mjs` is the
 * live reproduction; this is the deterministic one.
 *
 * ── Why the harness asserts its own interleaving ────────────────────────────
 * `exposure-concurrency.test.ts` records the trap: a concurrency test whose
 * gate silently fails to park anything passes while proving nothing, and a
 * broken harness looks exactly like a fixed defect from the outside. So the
 * test below asserts that call A really was still in flight when call B
 * finished — by counting the fake's HTTP calls — before it asserts anything
 * about the values.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AxiosInstance } from 'axios';

let dir: string;

beforeEach(() => {
  // Isolated tmpdir, stubbed BEFORE the module is imported: scan-recency
  // computes CACHE_DIR once at load.
  dir = mkdtempSync(join(tmpdir(), 'scan-recency-race-'));
  vi.stubEnv('TMPDIR', dir);
  vi.stubEnv('TEMP', dir);
  vi.stubEnv('TMP', dir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function freshModule() {
  vi.resetModules();
  return await import('../modules/scan-recency.js');
}

const instance = (endpoint: string) => ({
  id: 'i0000000-0000-0000-0000-000000000001',
  endpointId: 'e0000000-0000-0000-0000-000000000001',
  endpointName: endpoint,
  jobDefinitionName: 'SCAN: Weekly',
  state: 'FinishedSuccessfully',
  lastAction: '2026-08-01T00:00:00Z',
  steps: [
    { type: 'WindowsComplianceScan', state: 'FinishedSuccessfully', lastAction: '2026-08-01T00:00:00Z' },
  ],
});

/**
 * A fake axios whose history read can be parked. `tenant` changes the baseURL
 * so the two clients fingerprint to different cache keys — which is what makes
 * one of them a miss while the other hits.
 */
function fakeClient(
  tenant: string,
  calls: { n: number },
  gate?: Promise<void>
): AxiosInstance {
  return {
    defaults: { baseURL: `https://${tenant}.invalid/bconnect`, headers: { common: { 'X-Api-Key': `key-${tenant}` } } },
    get: async () => {
      calls.n += 1;
      if (gate) {await gate;}
      return {
        status: 200,
        data: {
          currentPage: 0, pageSize: 1000, totalPages: 1, totalItems: 1,
          hasPreviousPage: false, hasNextPage: false,
          data: [instance('WIN10-01')],
        },
      };
    },
  } as unknown as AxiosInstance;
}

/** Spin until `predicate` holds, so the test observes real state, not a guess. */
async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 2_000; i += 1) {
    if (predicate()) {return;}
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`waitFor timed out: ${label}`);
}

describe('two concurrent calls do not swap their load provenance', () => {
  it('vacuity: a lone walking call reports fromCache false, and a lone repeat reports true', async () => {
    const scan = await freshModule();
    const calls = { n: 0 };
    const http = fakeClient('solo', calls);

    const first = await scan.getScanRecency(http, []);
    expect(first.meta.fromCache, 'a cold call must be a miss, or the test below proves nothing').toBe(false);
    expect(calls.n).toBeGreaterThan(0);

    const second = await scan.getScanRecency(http, []);
    expect(second.meta.fromCache, 'a repeat within the TTL must be a hit').toBe(true);
    expect(second.meta.loadMs).toBe(0);
  });

  it('a call that WALKED does not report the cache hit that finished beside it', async () => {
    const scan = await freshModule();

    // Warm tenant A so a later A call is a genuine memory-cache hit.
    const warmCalls = { n: 0 };
    await scan.getScanRecency(fakeClient('tenant-a', warmCalls), []);
    expect(warmCalls.n).toBeGreaterThan(0);

    // Call B (tenant B) misses and parks inside its history walk.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const bCalls = { n: 0 };
    const bPromise = scan.getScanRecency(fakeClient('tenant-b', bCalls, gate), []);

    // It must actually be in flight before the hit runs, or nothing overlaps.
    await waitFor(() => bCalls.n > 0, 'call B never reached its history read');

    // Call A hits the memory cache: no HTTP at all, and it completes entirely
    // inside call B's await — which is when the shared flag used to be reset.
    const aCalls = { n: 0 };
    const aResult = await scan.getScanRecency(fakeClient('tenant-a', aCalls), []);
    expect(aCalls.n, 'call A was supposed to be served from memory').toBe(0);
    expect(aResult.meta.fromCache).toBe(true);

    release();
    const bResult = await bPromise;

    // The assertion the defect broke: B walked, so B must say so.
    expect(
      bResult.meta.fromCache,
      'the walking call published the concurrent hit\'s flag — freshly fetched ' +
        'scan-age data reported as coming from cache'
    ).toBe(false);
    expect(bResult.meta.loadMs).toBeGreaterThanOrEqual(0);
  });

  it('the mirror direction: a cache hit is not told it walked', async () => {
    const scan = await freshModule();

    const warmCalls = { n: 0 };
    await scan.getScanRecency(fakeClient('tenant-a', warmCalls), []);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const bCalls = { n: 0 };
    const bPromise = scan.getScanRecency(fakeClient('tenant-b', bCalls, gate), []);
    await waitFor(() => bCalls.n > 0, 'call B never reached its history read');

    // Release B first, then read A — so B's completion is the most recent write
    // to anything module-scoped before A reports.
    release();
    await bPromise;

    const aResult = await scan.getScanRecency(fakeClient('tenant-a', { n: 0 }), []);
    expect(
      aResult.meta.fromCache,
      'a call served from memory was attributed another call\'s walk'
    ).toBe(true);
    expect(aResult.meta.loadMs).toBe(0);
  });
});
