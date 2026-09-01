/**
 * Bounded page-through helper for bConnect list routes (upstream finding PER-17)
 *
 * ── The defect this exists to fix ────────────────────────────────────────────
 * bConnect v2.0 list routes are paged (`Page` is zero-indexed, `PageSize` caps
 * at 1000 server-side) and the envelope carries `totalPages`. Several composite
 * tools fetch page 0 only and present the result as the whole estate, which
 * silently truncates any estate over one page — including
 * `preview-assignment`'s `endpointsInReach`, where undercounting understates
 * the blast radius on the suite's own safety primitive.
 *
 * The correct shape already existed in this repo, hand-rolled, at
 * `bconnect-compliance-mcp/src/modules/unpatched.ts` (a do/while bounded by
 * `MAX_ENDPOINT_PAGES`). This is that loop lifted into the shared library so a
 * fourth hand-rolled copy does not appear.
 *
 * ── Two modes ───────────────────────────────────────────────────────────────
 * Serial (default) reproduces the reference loop exactly. Bounded-concurrency
 * mode fetches page 0 first — `totalPages` is not known before it returns — then
 * fans the remaining pages out `concurrency` at a time, preserving page order in
 * the result. That is what the ~38-page vulnerability library fan-out in
 * `exposure.ts` needs; it pairs with the keep-alive change in
 * `BConnectClientBase`, since the pages now share sockets.
 *
 * ── Truncation is reported, never silent ────────────────────────────────────
 * `maxPages` is a real bound, not a formality, so the result says whether it
 * was hit. A caller that renders a count must surface `truncated` — an
 * undercount presented as a total is the failure mode this helper exists to
 * prevent, and it is worse than an error.
 *
 * That rule is why an UNREADABLE `totalPages` throws rather than degrading to a
 * one-page walk. Until 2026-08-19 a non-numeric value made `Math.max(1,
 * Math.floor(x))` return NaN, every subsequent comparison false, and the walk
 * return page 0 with `truncated: false`. An ABSENT `totalPages` still means
 * "this is the last page" — that contract is unchanged and every caller depends
 * on it.
 */

/** One page as returned by a bConnect list route. */
export interface PaginatedPage<T> {
  /** Rows on this page. `data` in the bConnect envelope. */
  items: T[];
  /** Total page count from the envelope. Absent is treated as "this is the last page". */
  totalPages?: number;
}

export interface PaginateAllOptions {
  /**
   * Hard ceiling on pages fetched. Required in spirit: pick the number your
   * tool can actually render, and check `truncated` on the result.
   * @default 50
   */
  maxPages?: number;

  /**
   * Pages fetched at once after page 0. 1 = the original serial loop.
   * @default 1
   */
  concurrency?: number;
}

export interface PaginateAllResult<T> {
  /** Every row fetched, in page order. */
  items: T[];
  /** How many pages were actually fetched. */
  pagesFetched: number;
  /** `totalPages` as reported by the first page (1 when the envelope omits it). */
  totalPages: number;
  /** True when `maxPages` stopped the walk before the last page. */
  truncated: boolean;
}

/**
 * Fetch every page of a bConnect list route, bounded by `maxPages`.
 *
 * @param fetchPage  called with a zero-indexed page number; returns that page's
 *                   rows plus the envelope's `totalPages`
 *
 * @example
 * ```ts
 * const { items, truncated } = await paginateAll(
 *   (page) => http
 *     .get("/endpoints/v2.0/Endpoints", { params: { PageSize: 1000, Page: page } })
 *     .then((res) => ({ items: res.data.data ?? [], totalPages: res.data.totalPages })),
 *   { maxPages: 20 }
 * );
 * ```
 */
export async function paginateAll<T>(
  fetchPage: (page: number) => Promise<PaginatedPage<T>>,
  options: PaginateAllOptions = {}
): Promise<PaginateAllResult<T>> {
  const maxPages = Math.max(1, Math.floor(options.maxPages ?? 50));
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));

  const first = await fetchPage(0);

  // An envelope that carries a totalPages we cannot read is an ERROR, not a
  // one-page walk.
  //
  // `Math.max(1, Math.floor(x))` returns NaN for any non-numeric x, and every
  // comparison against NaN is false. So the walk skipped straight past
  // `pagesToFetch > 1`, returned page 0 alone, and reported
  // `truncated: NaN > NaN` — false. An undercount presented as a total, which
  // this file's own header calls worse than an error.
  //
  // It defeats redundant guards simultaneously rather than one at a time.
  // `exposure.ts` checks `walk.truncated || walk.outOfTime ||
  // walk.pagesFetched < walk.totalPages` — three independent conditions,
  // written by someone who was clearly worried about this class — and NaN makes
  // all three false at once. `1 < NaN` is false.
  //
  // ABSENT is different from UNREADABLE and stays legal: `undefined`/`null`
  // mean "this is the last page", which is the documented contract every caller
  // relies on via `res.totalPages ?? undefined`. Only a value that is present
  // and not a finite number throws.
  const declaredTotal = first.totalPages;
  if (declaredTotal !== undefined && declaredTotal !== null && !Number.isFinite(declaredTotal)) {
    throw new Error(
      `paginateAll: the first page declared totalPages=${String(declaredTotal)}, which is not a ` +
        `finite number. Treating it as one page would return page 0 alone while reporting the ` +
        `walk complete, so this refuses instead. Fix the envelope or omit totalPages to mean ` +
        `"this is the last page".`
    );
  }
  const totalPages = Math.max(1, Math.floor(declaredTotal ?? 1));
  const pagesToFetch = Math.min(totalPages, maxPages);

  const items: T[] = [...first.items];
  let pagesFetched = 1;

  if (pagesToFetch > 1) {
    if (concurrency === 1) {
      // The reference serial loop from unpatched.ts, unchanged in behaviour.
      for (let page = 1; page < pagesToFetch; page++) {
        const next = await fetchPage(page);
        items.push(...next.items);
        pagesFetched++;
      }
    } else {
      const remaining: number[] = [];
      for (let page = 1; page < pagesToFetch; page++) {
        remaining.push(page);
      }

      // Slot-per-worker fan-out: `concurrency` requests in flight at most, and
      // results written back by index so page order survives out-of-order
      // completion.
      const pages: T[][] = new Array<T[]>(remaining.length);
      let cursor = 0;
      const worker = async (): Promise<void> => {
        for (;;) {
          const slot = cursor++;
          if (slot >= remaining.length) {
            return;
          }
          const next = await fetchPage(remaining[slot]);
          pages[slot] = next.items;
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, remaining.length) }, () => worker())
      );

      for (const page of pages) {
        items.push(...(page ?? []));
        pagesFetched++;
      }
    }
  }

  return {
    items,
    pagesFetched,
    totalPages,
    truncated: totalPages > pagesToFetch,
  };
}
