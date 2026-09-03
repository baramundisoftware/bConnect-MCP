/**
 * Bounded pagination helper (PER-17).
 *
 * The behaviour being pinned is the one the hand-rolled loop in
 * bconnect-compliance-mcp/src/modules/unpatched.ts already had, plus an
 * explicit truncation signal — because the tools that fetched page 0 only
 * presented a partial estate as a total, including the endpointsInReach count
 * that feeds preview_assignment's REFUSE/CONFIRM verdict.
 */

import { describe, it, expect } from 'vitest';
import { paginateAll } from '@bconnect/mcp-core';

/** A fake list route: `pages` pages of `perPage` rows, numbered from 0. */
function route(pages: number, perPage = 2) {
  const calls: number[] = [];
  const fetchPage = async (page: number) => {
    calls.push(page);
    return {
      items: Array.from({ length: perPage }, (_, i) => `p${page}r${i}`),
      totalPages: pages,
    };
  };
  return { calls, fetchPage };
}

describe('paginateAll', () => {
  it('walks every page, in order', async () => {
    const { calls, fetchPage } = route(4);

    const result = await paginateAll(fetchPage);

    expect(calls).toEqual([0, 1, 2, 3]);
    expect(result.items).toHaveLength(8);
    expect(result.items[0]).toBe('p0r0');
    expect(result.items.at(-1)).toBe('p3r1');
    expect(result.pagesFetched).toBe(4);
    expect(result.truncated).toBe(false);
  });

  it('stops after one page when that is all there is', async () => {
    const { calls, fetchPage } = route(1);

    const result = await paginateAll(fetchPage);

    expect(calls).toEqual([0]);
    expect(result.totalPages).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('treats a missing totalPages as a single page', async () => {
    const result = await paginateAll(async () => ({ items: ['only'] }));
    expect(result.items).toEqual(['only']);
    expect(result.truncated).toBe(false);
  });

  it('honours maxPages and says so, rather than undercounting in silence', async () => {
    const { calls, fetchPage } = route(38);

    const result = await paginateAll(fetchPage, { maxPages: 5 });

    expect(calls).toEqual([0, 1, 2, 3, 4]);
    expect(result.pagesFetched).toBe(5);
    expect(result.totalPages).toBe(38);
    expect(result.truncated).toBe(true);
  });

  it('preserves page order when fetched concurrently', async () => {
    const { fetchPage } = route(6);

    const serial = await paginateAll(fetchPage);
    const parallel = await paginateAll(fetchPage, { concurrency: 4 });

    expect(parallel.items).toEqual(serial.items);
    expect(parallel.pagesFetched).toBe(serial.pagesFetched);
  });

  it('keeps at most `concurrency` requests in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchPage = async (page: number) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { items: [page], totalPages: 12 };
    };

    await paginateAll(fetchPage, { concurrency: 3, maxPages: 12 });

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  // ── An unreadable totalPages, added 2026-08-19 after it shipped ──────────
  //
  // The seven tests above cover walk order, an absent totalPages, the maxPages
  // bound, concurrency ordering and limit, and page failure. None of them ever
  // handed this function a totalPages that was PRESENT but not a number, and
  // that is the gap the defect lived in.
  //
  // `Math.max(1, Math.floor(x))` is NaN for non-numeric x, and every comparison
  // against NaN is false, so the walk skipped `pagesToFetch > 1`, returned page
  // 0 alone, and reported `truncated: NaN > NaN` — false. Downstream,
  // `truncationReason` returns null when not truncated and `assessResultTrust`
  // reads no reasons as `resultTrustworthy: true`.
  //
  // What makes it worth pinning is that it defeats defence in depth in one
  // move. `exposure.ts` guards with `walk.truncated || walk.outOfTime ||
  // walk.pagesFetched < walk.totalPages` — three independent conditions — and
  // NaN falsifies all three at once, because `1 < NaN` is false too.

  it('refuses a totalPages that is present but not a finite number', async () => {
    const seen: number[] = [];
    const fetchPage = async (page: number) => {
      seen.push(page);
      return { items: ['row'], totalPages: 'many' as unknown as number };
    };
    await expect(paginateAll(fetchPage)).rejects.toThrow(/not a finite number/);
    // Refused before walking, so no caller sees a partial side effect.
    expect(seen).toEqual([0]);
  });

  it('refuses NaN and both infinities — the values that make every comparison false', async () => {
    for (const poison of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const fetchPage = async () => ({ items: [1], totalPages: poison });
      await expect(paginateAll(fetchPage), String(poison)).rejects.toThrow(/finite/);
    }
  });

  it('never reports a bad totalPages as a complete walk', async () => {
    // The PROPERTY rather than the mechanism: if a future change goes back to
    // coercing instead of throwing, this still fails, whatever fallback the
    // coercion picks.
    const fetchPage = async (page: number) => ({
      items: [`p${page}a`, `p${page}b`, `p${page}c`],
      totalPages: 'many' as unknown as number,
    });
    let settled: Awaited<ReturnType<typeof paginateAll>> | null = null;
    try {
      settled = await paginateAll(fetchPage);
    } catch {
      settled = null;
    }
    if (settled !== null) {
      expect(
        settled.truncated,
        `paginateAll returned ${settled.items.length} rows with truncated=${settled.truncated}. ` +
          `An undercount presented as a total is the one outcome this helper exists to prevent.`
      ).toBe(true);
    }
    expect(settled).toBeNull();
  });

  it('propagates a page failure instead of returning a short result', async () => {
    const fetchPage = async (page: number) => {
      if (page === 2) {
        throw new Error('bConnect API error (HTTP 500).');
      }
      return { items: [page], totalPages: 4 };
    };

    await expect(paginateAll(fetchPage)).rejects.toThrow(/HTTP 500/);
    await expect(paginateAll(fetchPage, { concurrency: 3 })).rejects.toThrow(/HTTP 500/);
  });
});
