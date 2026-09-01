/**
 * Wall-clock budget for one composite tool call.
 *
 * ── The defect this exists to fix ────────────────────────────────────────────
 * `get_security_posture` issues three multi-page walks with no overall
 * deadline. `BCONNECT_TIMEOUT_MS` bounds one REQUEST; three walks of several
 * hundred requests each have no bound at all. The MCP host is the one holding a clock — every
 * client imposes its own tool-call timeout, the values differ per client, and
 * none of them is negotiable from here. Past that ceiling the caller does not
 * get a slow answer, they get no answer: the transport is torn down, and all the
 * truncation-disclosure work in this module's siblings never reaches anyone.
 *
 * A partial answer that says it is partial beats a timeout. That is the whole
 * design: stop walking when the budget is spent, report what was covered out of
 * what exists, and let the existing `resultTrustworthy` machinery carry it.
 *
 * ── Why the default is what it is ───────────────────────────────────────────
 * 25 seconds. It has to sit below the smallest tool-call timeout in common use
 * (30 s in the tighter clients, 60 s in the looser ones) with enough margin for
 * the response to be serialised and written. It is deliberately NOT derived
 * from any measured estate: the point of this file is that the estate is
 * unknown. Set `BCONNECT_COMPOSITE_BUDGET_MS` to whatever the deploying client
 * actually allows — higher for a batch/automation host that will wait, lower
 * for an interactive one.
 *
 * ── The rule a budget must not break ────────────────────────────────────────
 * A walk stopped by the clock is a TRUNCATED walk, and everything this suite
 * already knows about truncation applies unchanged: the count it produced is a
 * floor, it must be labelled, and it must never be written to a cache. The
 * helpers below return the facts a caller needs to do that; they do not do it
 * for the caller, because the sentence belongs next to the number.
 *
 * This belongs in `packages/mcp-core` beside `paginate.ts` — `paginateAll` has
 * no deadline option, which is the reason this wraps it rather than extending
 * it.
 */

import { paginateAll, type PaginatedPage } from "@bconnect/mcp-core";

/** Env var that overrides the budget, in milliseconds. */
export const BUDGET_ENV = "BCONNECT_COMPOSITE_BUDGET_MS";

/** Budget applied when the env var is absent or unparseable. */
export const DEFAULT_BUDGET_MS = 25_000;

/**
 * Lower bound on a configured budget. Zero would mean "page 0 only, always",
 * which is the C2 defect wearing a config flag; one second is short enough to
 * be useless and long enough to be deliberate.
 */
const MIN_BUDGET_MS = 1_000;

export interface TimeBudget {
  /** The budget in force, after env override and clamping. */
  readonly totalMs: number;
  /** `Date.now()` when the call started. */
  readonly startedAt: number;
  /** True once the budget is spent. */
  expired(): boolean;
  remainingMs(): number;
  elapsedMs(): number;
}

function budgetFromEnv(env: NodeJS.ProcessEnv): number {
  const raw = env[BUDGET_ENV];
  if (raw == null || raw.trim() === "") {
    return DEFAULT_BUDGET_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_BUDGET_MS;
  }
  return Math.max(MIN_BUDGET_MS, parsed);
}

/**
 * Start a budget for one tool call. Read per call, not once at module load, so
 * a host that rewrites the environment between calls is honoured rather than
 * frozen at whatever the first call saw.
 */
export function startTimeBudget(env: NodeJS.ProcessEnv = process.env): TimeBudget {
  const totalMs = budgetFromEnv(env);
  const startedAt = Date.now();
  return {
    totalMs,
    startedAt,
    expired: () => Date.now() - startedAt >= totalMs,
    remainingMs: () => Math.max(0, totalMs - (Date.now() - startedAt)),
    elapsedMs: () => Date.now() - startedAt,
  };
}

export interface BudgetedWalk<T> {
  /** Rows the walk returned, in page order. Empty when the caller absorbs. */
  items: T[];
  /** Pages that were actually FETCHED — never the loop counter. */
  pagesFetched: number;
  /** `totalPages` as page 0 reported it. */
  totalPages: number;
  /** True when `maxPages` stopped the walk before the last page. */
  truncated: boolean;
  /** True when the time budget stopped the walk before the last page. */
  outOfTime: boolean;
}

/**
 * `paginateAll` with a deadline.
 *
 * Page 0 is always fetched, even against an already-spent budget: without it
 * there is no `totalPages`, and a response that cannot say how much it missed
 * is worse than a slow one. Every later page is skipped once the budget is
 * spent — skipped, not failed, so whatever was absorbed stays absorbed and the
 * caller gets the partial result it knows how to caveat.
 *
 * `pagesFetched` counts real fetches. `paginateAll`'s own counter walks the
 * skipped pages too, so it cannot be reported here.
 */
export async function walkWithin<T>(
  budget: TimeBudget,
  fetchPage: (page: number) => Promise<PaginatedPage<T>>,
  options: { maxPages: number; concurrency?: number }
): Promise<BudgetedWalk<T>> {
  let pagesFetched = 0;
  let outOfTime = false;

  const walk = await paginateAll<T>(
    async (page) => {
      if (page > 0 && budget.expired()) {
        outOfTime = true;
        return { items: [] };
      }
      pagesFetched++;
      return fetchPage(page);
    },
    { maxPages: options.maxPages, concurrency: options.concurrency }
  );

  return {
    items: walk.items,
    pagesFetched,
    totalPages: walk.totalPages,
    truncated: walk.truncated,
    outOfTime,
  };
}

/**
 * The sentence a walk owes its caller when the clock, not the page bound,
 * stopped it. Mirrors `truncationReason` in `@bconnect/mcp-core` — same shape,
 * same promise, different cause, because "we ran out of pages we were willing
 * to read" and "we ran out of time" lead an operator to different remedies.
 */
export function timeBudgetReason(
  what: string,
  walk: Pick<BudgetedWalk<unknown>, "pagesFetched" | "totalPages" | "outOfTime">,
  budget: TimeBudget
): string | null {
  if (!walk.outOfTime) {
    return null;
  }
  return (
    `${what} stopped at page ${walk.pagesFetched} of ${walk.totalPages} because this call's ` +
    `${budget.totalMs} ms time budget was spent, so this is a partial read. Counts derived from it ` +
    `are a floor, not a total, and anything absent from them was not read rather than not present. ` +
    `Raise ${BUDGET_ENV} if the MCP client will wait longer, or narrow the question.`
  );
}
