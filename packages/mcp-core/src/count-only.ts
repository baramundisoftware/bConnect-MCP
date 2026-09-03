/**
 * `countOnly`: the cheap path to "how many?" (finding TOK-8 / TOK-25)
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * Every bConnect list envelope carries `totalItems`, and no tool exposes a way
 * to ask for just that. "How many endpoints are stale / Win10 / vulnerable" —
 * among the most common fleet questions — costs a full default page: ~15.7 KB
 * for `list_job_instances`, ~18 KB for `list_endpoints`. Against
 * `list_vulnerabilities` (37,571 items, measured live) the count is the only
 * sane answer and the rows are pure waste.
 *
 * ── The idiom, measured ─────────────────────────────────────────────────────
 * A page past the end of the result set returns the envelope with an empty
 * `data` array. The prior evaluation record measured it:
 *
 *     PageSize=1 & Page=100000  ->  totalItems in 122 bytes   (-99.96%)
 *
 * That is why `COUNT_PROBE_PAGE` is a large page index rather than `PageSize=1`
 * on page 0: page 0 still materialises a row, and bConnect rows run 700 B to
 * 3.1 KB. Requesting past the end costs the server an index lookup and returns
 * no row at all.
 *
 * The idiom is implemented once, here, rather than in ~100 tool handlers across
 * four territories — which is the only way `countOnly` means the same thing in
 * every server.
 *
 * ── What comes back ─────────────────────────────────────────────────────────
 * `{ totalItems, totalPagesAtDefaultPageSize?, filters? }` — the count, and the
 * filters it was a count *of*, echoed once so a model reading its own transcript
 * can tell "12 stale endpoints" from "12 endpoints". `totalPages` from the probe
 * response is deliberately NOT forwarded: it is the page count at `PageSize=1`,
 * i.e. the item count again, and forwarding it has misled readers before.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 * ```ts
 * import { isCountOnlyRequest, fetchCount, countOnlyProperty } from "@bconnect/mcp-core";
 *
 * case "list_vulnerabilities": {
 *   if (isCountOnlyRequest(args)) {
 *     const count = await fetchCount(
 *       (params) => bconnect.compliance.listVulnerabilities(params),
 *       args
 *     );
 *     return toolTextResult(serializeToolResult(count));
 *   }
 *   ...
 * }
 * ```
 */

/**
 * Page index requested to land past the end of any real result set.
 *
 * 100,000 pages of 1 row = 100,000 items. The largest resource measured in this
 * API is the CVE library at 37,571 items, so this clears the estate by 2.6x. It
 * is the value the original measurement used.
 */
export const COUNT_PROBE_PAGE = 100_000;

/** Smallest page the API will serve. Combined with the probe page: no rows. */
export const COUNT_PROBE_PAGE_SIZE = 1;

/**
 * Parameters that never describe *what* is being counted — they describe how it
 * is being paged or ordered — and so are dropped from both the probe request
 * and the echoed filters.
 */
const NON_FILTER_PARAMS: ReadonlySet<string> = new Set([
  "Page",
  "PageSize",
  "OrderBy",
  "countOnly",
  "detail",
  "fields",
]);

/**
 * P1-6 — the client-side shaping vocabulary. Consumed by the server; never
 * meaningful to bConnect.
 *
 * Distinct from `NON_FILTER_PARAMS` above, and the difference matters: that set
 * serves the COUNT path, where `Page`/`PageSize`/`OrderBy` are replaced by the
 * probe and so must be dropped. On the ordinary list path they are real query
 * parameters the caller asked for and must survive. Only these four are ours.
 *
 * Keep the two in sync when a new shaping flag is added — a flag missing here
 * ends up on the wire; missing from `NON_FILTER_PARAMS` it corrupts a probe.
 */
export const CLIENT_SIDE_PARAMS: readonly string[] = Object.freeze([
  "detail",
  "fields",
  "countOnly",
  "includeSteps",
]);

/**
 * The caller's arguments with the client-side shaping flags removed.
 *
 * List handlers forward the whole argument object to the client as `params`, so
 * without this every `detail` / `fields` / `countOnly` / `includeSteps` is
 * appended to the bConnect URL. bConnect answers 200 and silently drops a
 * parameter it does not know (finding D6), so nothing visibly breaks — it just
 * puts the caller's shaping vocabulary on the wire forever, and
 * `__tests__/suite-schema-vs-types.test.ts` exists precisely to catch a tool
 * sending a parameter its operation does not declare.
 *
 * `countOnly: true` never reached the wire — `fetchCount` strips it on the
 * count path. What leaked was an explicit `countOnly: false`, which cannot
 * change an answer but makes "never sent to the API" true only of the
 * meaningful value.
 */
export function apiParams(args: Record<string, unknown> | undefined): Record<string, unknown> {
  const params = { ...(args ?? {}) };
  for (const key of CLIENT_SIDE_PARAMS) {
    delete params[key];
  }
  return params;
}

// M5 — recognising the unavailable envelope so a count never reads as zero.
import { isDataUnavailable } from "./absent-data.js";

export interface CountResult {
  /** Matches, from the envelope. `null` when the route returns no count. */
  totalItems: number | null;
  /** The filters this is a count of. Omitted when there were none. */
  filters?: Record<string, unknown>;
  /** Present only when `totalItems` is null, explaining why. */
  note?: string;
  /**
   * Present only when the count is unavailable because a sub-resource read hit
   * an overloaded 404 (see absent-data.ts). Every cause consistent with what
   * was observed, none ruled out.
   */
  possibleCauses?: string[];
}

/** Did the caller ask for a count rather than rows? */
export function isCountOnlyRequest(args: Record<string, unknown> | undefined): boolean {
  return args?.countOnly === true;
}

/**
 * Turn a tool's arguments into the probe request.
 *
 * The caller's filters are preserved exactly — the count has to be a count of
 * what they asked for — while `Page`/`PageSize` are replaced by the probe and
 * the shaping flags are dropped.
 */
export function countOnlyParams(
  args: Record<string, unknown> = {}
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!NON_FILTER_PARAMS.has(key)) {
      params[key] = value;
    }
  }
  params.Page = COUNT_PROBE_PAGE;
  params.PageSize = COUNT_PROBE_PAGE_SIZE;
  return params;
}

/** The caller's filters, with paging and shaping flags removed. */
export function countedFilters(
  args: Record<string, unknown> = {}
): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!NON_FILTER_PARAMS.has(key) && value !== undefined) {
      filters[key] = value;
    }
  }
  return filters;
}

/**
 * Read the count out of a list envelope.
 *
 * Exported separately from `fetchCount` for the handlers that already hold a
 * response (a composite tool that fetched a page for another reason) and for
 * tests.
 */
export function countResultFromEnvelope(
  envelope: unknown,
  args: Record<string, unknown> = {}
): CountResult {
  const totalItems = (envelope as { totalItems?: unknown } | null | undefined)?.totalItems;
  const filters = countedFilters(args);
  const hasFilters = Object.keys(filters).length > 0;

  // M5. A sub-resource read that hit an overloaded 404 already carries `null`
  // here, so the count is correctly not a zero — but the generic note below
  // would tell the caller to page the result, which cannot help and reads as
  // though the route were merely count-less. Carry the real reason instead.
  if (isDataUnavailable(envelope)) {
    return {
      totalItems: null,
      ...(hasFilters ? { filters } : {}),
      note: envelope.note,
      possibleCauses: envelope.possibleCauses,
    };
  }

  if (typeof totalItems !== "number" || !Number.isFinite(totalItems)) {
    return {
      totalItems: null,
      ...(hasFilters ? { filters } : {}),
      note:
        "This route did not return totalItems, so the count is unavailable. " +
        "Call the tool without countOnly and page the result.",
    };
  }

  return { totalItems, ...(hasFilters ? { filters } : {}) };
}

/**
 * Fetch just the count.
 *
 * @param fetchPage  issues the list request with the parameters it is given —
 *                   normally the same module method the tool would have called
 * @param args       the tool's arguments; filters are preserved, paging replaced
 *
 * @example
 * ```ts
 * const { totalItems } = await fetchCount(
 *   (params) => http.get("/endpoints/v2.0/Endpoints", { params }).then((r) => r.data),
 *   { DisplayName: "WORKSTATION1", countOnly: true }
 * );
 * ```
 */
export async function fetchCount(
  fetchPage: (params: Record<string, unknown>) => Promise<unknown>,
  args: Record<string, unknown> = {}
): Promise<CountResult> {
  const envelope = await fetchPage(countOnlyParams(args));
  return countResultFromEnvelope(envelope, args);
}
