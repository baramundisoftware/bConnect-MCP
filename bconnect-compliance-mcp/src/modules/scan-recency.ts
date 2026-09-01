/**
 * Per-endpoint vulnerability-scan recency — shared composite helper.
 *
 * LOCAL ADDITION (not upstream). This is the concrete answer to upstream
 * finding D17: neither `DetectedVulnerabilities` nor `Vulnerabilities` carries
 * a per-endpoint "last scanned" field, so a vulnerability count cannot be told
 * apart from a stale one. Two endpoints ranked side by side — one scanned
 * yesterday, one scanned 533 days ago — are presented as directly comparable,
 * and they are not.
 *
 * D17 says the only way to recover the date is to cross-reference `JobInstances`
 * for a `WindowsComplianceScan` step, per endpoint, by hand. Doing that is both
 * expensive and, measured against this estate, *wrong* often enough to matter.
 * So this module derives the date from two independent signals and reports when
 * they disagree:
 *
 *   1. `detected` on `DetectedVulnerabilities` rows (source `"detections"`).
 *      Measured on labcorp.local: every endpoint's detections share exactly one
 *      `detected` value — 21 of 21 endpoints, 2,531 rows, one distinct timestamp
 *      each. That is the scan writing its result set in one pass, so the maximum
 *      `detected` per endpoint *is* the as-of date of the data being ranked.
 *      It costs nothing extra: the caller has already loaded these rows.
 *
 *   2. The `WindowsComplianceScan` step inside `JobInstances` (source
 *      `"job-history"`). This is D17's prescribed workaround. It is the only
 *      signal available for an endpoint that was scanned and came back clean
 *      (no detections, therefore no `detected` timestamp), and it is the only
 *      way to see that a scan is currently *in progress* rather than finished.
 *
 * Why both, rather than trusting the documented workaround alone — two live
 * cases, either of which would have produced a confidently wrong answer:
 *
 *   - WIN11CLIENT10: job history reports a scan step 101 days old; the step
 *     state is `Running`, and the newest detection on that endpoint is 122 days
 *     old. Job history alone over-reports currency by three weeks, because a
 *     later attempt started and never completed. A recurring job instance keeps
 *     one row and overwrites its own step timestamps, so the *attempt* is
 *     visible and the last *successful* refresh is not.
 *   - A-DC-01 and WIN10CLIENT2 hold detections 837 and 533 days old with **no
 *     `WindowsComplianceScan` anywhere in retained job history**. The documented
 *     workaround returns "never scanned" for two endpoints that plainly were.
 *
 * So: detections win when they exist (they are the as-of date of the data being
 * ranked), job history fills the gaps and flags in-progress scans, and any
 * disagreement beyond a day is reported rather than silently resolved.
 *
 * COST. The naive shape of this lookup is N endpoints x job history. Measured
 * against labcorp.local, 23 Windows endpoints: the per-endpoint path
 * (`/jobs/v2.0/Endpoints/{id}/JobInstances`, 23 requests) costs ~1,270 ms and
 * 299 KB. The whole estate's history in one page (`/jobs/v2.0/JobInstances`,
 * PageSize 1000) costs ~650 ms and 302 KB in a single request — same bytes,
 * 23x fewer round trips, and it does not grow a request per endpoint. On a
 * 500-endpoint estate the naive path is 500 requests; this one is a handful of
 * pages. So: fetch estate-wide, reduce to one small record per endpoint, cache
 * the reduction.
 *
 * The reduction is cached at module scope AND on disk, for the same reason
 * `exposure.ts` caches the vulnerability library: a fresh client — and
 * therefore a fresh per-client cache — is constructed on every tool call
 * (upstream finding R3/B8), so nothing held on the client survives; and MCP
 * hosts do not guarantee the server *process* survives between tool calls
 * either (measured against Claude Desktop, it did not). Module scope outlives
 * the call; disk outlives the process. Only the reduced records are persisted
 * (~21 small objects), never the 302 KB raw history.
 *
 * ── Truncation (audit finding H1, fixed 2026-08-03) ─────────────────────────
 * The walk read `totalPages` off the envelope and discarded it, stopped at
 * `MAX_HISTORY_PAGES`, and wrote the truncated reduction to disk
 * unconditionally — so the truncation persisted and was served as fact for the
 * whole 15-minute TTL. Demonstrated at 25 of 40 pages: `meta` reported
 * `pagesFetched: 25` with no `totalPages` and no `truncated`, and an endpoint
 * whose successful scan sat on page 39 came back
 * `scanSource: "none", note: "No scan evidence from either signal."` That note
 * is a claim about the estate made from a partial read, and it flows straight
 * into `get_unpatched_endpoints`'s `neverScannedReachable` — the field whose
 * entire purpose is to say "nobody has ever looked at this machine".
 *
 * Four things changed:
 *
 *   1. The hand-rolled do/while is now `paginateAll`, so `totalPages`,
 *      `pagesFetched` and `truncated` come back as data rather than being
 *      recomputed and forgotten.
 *   2. `CachedHistory` carries its own completeness, and a truncated history is
 *      NOT written to disk — the rule `exposure.ts:125-127` already had and
 *      this module, in the same directory, did not.
 *   3. The disk reader re-validates: a payload that does not record its own
 *      completeness is a pre-fix write and is refused, which is what lets a
 *      poisoned copy already sitting in %TEMP% self-heal.
 *   4. **The prose changes.** When the walk was bounded, an endpoint with no
 *      evidence is told the walk was bounded, not that it has never been
 *      scanned. `summarizeScanRecency` marks `neverScanned` untrustworthy for
 *      the same reason.
 *
 * ── Ordering ────────────────────────────────────────────────────────────────
 * The walk sent no `OrderBy`, and the server's default order was measured to be
 * neither ascending nor descending — so a 25-page cap read an *arbitrary*
 * 25,000 instances, non-deterministic between runs and then frozen on disk for
 * fifteen minutes. It now sends `LastAction desc`, making a bounded walk the
 * *recent* window and reproducible.
 *
 * `LastAction`, not the `Start` the audit suggested. Measured live 2026-08-03
 * against 26R1, 229 instances: `Start desc` and `LastAction desc` are both
 * honoured, but `start` is blank on 29 of 229 rows (12.7%) while `lastAction` is
 * populated on 229 of 229. Under `Start desc` those 29 sort to the very end and
 * are the first rows a bound discards; under `LastAction desc` every row has a
 * key. It is also the field this module reduces on (`step.lastAction`), so the
 * ordering and the reduction agree.
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AxiosInstance } from "axios";
import { fingerprintFromHttpClient, fingerprintedCacheName, shortfallReason } from "@bconnect/mcp-core";
import { readCacheFileSync, writeCacheFileSync } from "./secure-disk-cache.js";
import {
  startTimeBudget,
  timeBudgetReason,
  walkWithin,
  type TimeBudget,
} from "./time-budget.js";

/** The step type bMS emits for a vulnerability/compliance scan. */
export const COMPLIANCE_SCAN_STEP = "WindowsComplianceScan";

/**
 * Job history is operational data — a scan that ran ten minutes ago should show
 * up. Fifteen minutes is short enough that a demo or an operator re-asking the
 * same question sees a fresh scan land, and long enough that a burst of related
 * tool calls pays the fetch once.
 */
const HISTORY_TTL_MS = 15 * 60 * 1000;
const PAGE_SIZE = 1000;

/** Safety valve. bMS caps PageSize at 1000; this bounds a runaway totalPages. */
const MAX_HISTORY_PAGES = 25;

/**
 * Explicit order for the bounded walk. Wire-verified against 26R1 on
 * 2026-08-03; see the module header for why this is `LastAction` and not
 * `Start`. An unknown property answers HTTP 400 on these routes, so this value
 * is checked by the server, not merely declared by the spec.
 */
const HISTORY_ORDER_BY = "LastAction desc";

// Fixed, shared path — read and written through `secure-disk-cache.ts`
// (finding SEC-5): owner-only 0700/0600, and a symlink, a file owned by someone
// else, or a group/world-writable one is refused rather than parsed. A planted
// history here would misdate every endpoint's scan, which is the one thing this
// module exists to get right.
const CACHE_DIR = join(tmpdir(), "bconnect-mcp");
/**
 * H2 — the cache file is per-TENANT, not shared.
 *
 * secure-disk-cache closes the cross-USER case. It cannot close this one:
 * two MCP configurations under ONE OS user, pointing at two different bMS
 * servers, resolved this same path and read each other's scan history.
 * No permission check fires, because the same user legitimately owns both.
 *
 * A function, not a constant: the fingerprint is computed per call so a
 * process whose configuration changes partitions to the new tenant instead of
 * continuing to serve the previous one's data.
 *
 * A function OF THE CLIENT, not of the environment. `cacheProvenanceFromEnv`
 * reads only the ambient BCONNECT_* variables, but `resolveClientConfig` picks
 * a base URL and key from three tiers in order: credentials injected per
 * request (which is how the GATEWAY serves each domain), then `__SUFFIX`
 * scoped variables, then the ambient environment. Fingerprinting the ambient
 * tier therefore misses the two that a multi-tenant deployment actually uses:
 * two configs differing only in BCONNECT_BASE_URL__COMPLIANCE hash the same,
 * and under MCP_GATEWAY_DOMAIN_CREDENTIALS=strict the ambient variables can be
 * absent altogether, collapsing the hash to one constant for every deployment.
 *
 * `fingerprintFromHttpClient` reads the identity off the client that actually
 * fetched the rows, which is the only thing that cannot disagree with them.
 * It existed, exported and documented for this, with zero call sites.
 */
function diskCachePath(fingerprint: string): string {
  return join(CACHE_DIR, fingerprintedCacheName("compliance-scan-history.json", fingerprint));
}

/** One endpoint's scan evidence as seen in job history. */
export interface JobHistoryScan {
  endpointId: string | null;
  /** Step `lastAction` of the most recent WindowsComplianceScan seen. */
  lastAttempt: string | null;
  /** Step `lastAction` of the most recent scan step that finished successfully. */
  lastSuccess: string | null;
  /** Step state of the most recent attempt, verbatim from the API. */
  stepState: string | null;
  /** Job definition the scan step belonged to. */
  jobName: string | null;
  /** True when the most recent scan step is still Running/Queued. */
  inProgress: boolean;
}

interface CachedHistory {
  byEndpoint: Map<string, JobHistoryScan>;
  fetchedAt: number;
  instancesExamined: number;
  pagesFetched: number;
  bytes: number;
  /**
   * `totalPages` as the server reported it on page 0 (H1). Recorded so
   * `pagesFetched` is never readable on its own — a bare `pagesFetched: 25`
   * cannot be told apart from "the history was 25 pages long".
   */
  totalPages: number;
  /** Page-0 `totalItems` — the server's own count of job instances, or null
   *  when the envelope omitted it. */
  totalItems: number | null;
  /**
   * True when the walk stopped before the last page — either MAX_HISTORY_PAGES
   * (H1) or the call's time budget. One flag, because everything downstream
   * does the same thing with it: caveat the answer and refuse to persist it.
   */
  truncated: boolean;
  /**
   * The row disagreement when an UNtruncated walk absorbed fewer instances
   * than the server's own totalItems — the live-measured empty page under an
   * intact header is the extreme case. Same downstream treatment as
   * `truncated`: caveat the answer and refuse to persist it. Gated on
   * !truncated so a page-cap stop stays one condition.
   */
  shortfall: string | null;
  /** Set when it was the clock rather than the page bound that stopped it. */
  outOfTimeNote: string | null;
  /** The order the walk was taken in, so a bounded read is reproducible (H1). */
  orderBy: string;
}

/** The sentence an incomplete history owes every caller that reads it. */
function incompleteNote(c: CachedHistory): string | null {
  if (c.truncated) {
    if (c.outOfTimeNote) {
      return (
        `${c.outOfTimeNote} An endpoint with no scan evidence here may simply have its scan on a page ` +
        `the walk did not reach.`
      );
    }
    return (
      `Job history was read to page ${c.pagesFetched} of ${c.totalPages} ` +
      `(bounded by MAX_HISTORY_PAGES=${MAX_HISTORY_PAGES}, ordered "${c.orderBy}"), so this is a ` +
      `partial read of the estate's job history. An endpoint with no scan evidence here may simply ` +
      `have its scan beyond the bound.`
    );
  }
  if (c.shortfall) {
    return (
      `${c.shortfall} An empty or short page under an intact header has been observed live on this ` +
      `API. Retry; if it persists, the server's own count disagrees with what it serves. An endpoint ` +
      `with no scan evidence here may simply be among the rows not served.`
    );
  }
  return null;
}

/**
 * ── KNOWN, DEFERRED: the same module-state shape `exposure.ts` just removed ──
 *
 * `lastLoadWasCacheHit` / `lastLoadMs` are written inside the loader and read
 * at the end of the caller's flow, with an `await` in between — so two
 * concurrent calls share them exactly as `exposure.ts`'s trust flags did. A
 * commit message on 2026-08-14 claimed this pair "went with it"; that was true
 * of exposure.ts only, and this is the correction.
 *
 * Deferred rather than fixed, on a severity judgement that should be checked
 * rather than trusted: neither value reaches `assessResultTrust` or any caveat.
 * They surface only as `meta.scanAge.historyFromCache` / `historyLoadMs`. The
 * worst outcome is a call publishing another call's load time, or
 * `historyFromCache: false` over what was a hit — 15-minute-old scan-age data
 * reading as freshly measured, in the module whose whole subject is how current
 * things are. `cacheAgeSeconds` sits beside them and IS computed per call from
 * `history.fetchedAt`, so the honest answer is still in the payload.
 *
 * Cosmetic-leaning, not cosmetic. Fix it the way exposure.ts was fixed —
 * return the values from the loader — when this file is next opened.
 *
 * The tenant-keying half of that note is now CLOSED — `historyCache` is keyed
 * by the fingerprinted cache path below, and
 * `__tests__/scan-recency-tenant-isolation.test.ts` reproduces the crossover it
 * prevents (tenant B receiving tenant A's history with zero HTTP calls made).
 *
 * ── AND THE REST IS NOW CLOSED TOO (2026-08-23) ─────────────────────────────
 * The severity judgement above said it should be checked rather than trusted,
 * so it was. Two concurrent calls against the in-repo mock, one walking (a
 * miss, slowed by fault injection) and one hitting the memory cache:
 *
 *     Y did a real 914 ms walk and reported  fromCache: true
 *
 * The ordering is the whole mechanism: `lastLoadWasCacheHit = false` is written
 * BEFORE the walk begins, the concurrent hit sets it back to true during the
 * await, and the walking call never writes it again — so it published a cache
 * hit it never had, in the module whose entire subject is how current the data
 * is. Reproduced by `scripts/probe-composite-concurrency.mjs` and pinned by
 * `__tests__/scan-recency-concurrency.test.ts`.
 *
 * The values now travel with the load, exactly as `exposure.ts` does it. The
 * two module-scope caches that remain (`historyCache`, `historyCacheKey`) are
 * safe to share: every path that reads them returns synchronously, so no other
 * call can interleave between the tenant check and the return.
 */
let historyCache: CachedHistory | null = null;
/** The tenant `historyCache` belongs to. See `loadComplianceScanHistory`. */
let historyCacheKey: string | null = null;

/**
 * One load's own result. Returned rather than parked in module scope, because
 * a value written before an await and read after it belongs to whichever call
 * happened to finish last.
 */
interface HistoryLoad {
  history: CachedHistory;
  /** True when this call was served from memory or disk without walking. */
  fromCache: boolean;
  /** Wall time this call spent walking; 0 on a cache hit. */
  loadMs: number;
}

/** States that mean "this scan step has not produced a result yet". */
const IN_PROGRESS_STATES = new Set(["running", "queued", "waiting", "delayed"]);

function readDiskCache(tenantKey: string, fingerprint: string): CachedHistory | null {
  try {
    const text = readCacheFileSync(CACHE_DIR, tenantKey);
    if (text === null) {return null;}
    const raw = JSON.parse(text) as {
      provenance?: string;
      fetchedAt: number;
      entries: Array<[string, JobHistoryScan]>;
      instancesExamined: number;
      pagesFetched: number;
      bytes: number;
      totalPages?: unknown;
      totalItems?: unknown;
      truncated?: unknown;
      orderBy?: unknown;
    };
    if (Date.now() - raw.fetchedAt >= HISTORY_TTL_MS) {return null;}
    // ── Provenance, re-checked rather than assumed ──────────────────────
    // The fingerprint is in the FILENAME, which is a single point of failure:
    // if two configurations ever resolve the same name, the reader has no
    // second opinion. Recording it in the payload gives it one.
    //
    // Be precise about what that buys, because the first version of this
    // comment overclaimed and a review took it apart:
    //   - It catches ACCIDENTAL collision — a future change to the hash
    //     inputs or to FINGERPRINT_LENGTH silently re-pointing existing files
    //     at a different tenant. That is the real risk and why this exists.
    //   - It does NOT heal the pre-2026-08-14 env-fingerprinted files. Under
    //     the client fingerprint those resolve a DIFFERENT filename, so this
    //     build never opens them; they were orphaned by the fingerprint change
    //     itself. The only files this check actually rejects in the wild are
    //     single-tenant ones whose data was correct — a one-off refetch.
    //   - It is NOT a defence against a poisoning attacker. The expected value
    //     is printed in the filename, so anyone able to plant a file can read
    //     it off a directory listing and write it into the payload. Ownership
    //     and mode are what defend that, in secure-disk-cache.ts.
    //
    // A file recording NO provenance is discarded rather than trusted:
    // 'nothing recorded' cannot read as 'nothing wrong'. Note the refetch is
    // once-only ONLY where the writer persists; on a truncated or short-served
    // estate the writer bails, nothing replaces the file, and every call pays
    // the walk again. That is pre-existing, and it is why the cost claim in
    // the original commit message was wrong.
    if (raw.provenance !== fingerprint) {
      return null;
    }

    // Validate completeness on READ, not only on write (H1, following the
    // P0-NEW rule `exposure.ts` already applies to the CVE library). A cache
    // written by a fixed build always records what it covered, so:
    //   - fields absent or malformed -> pre-fix format, never completeness-
    //     checked; untrusted, refetch and rewrite. This is what lets a
    //     truncated copy already sitting in %TEMP% self-heal.
    //   - recorded as truncated -> a partial history persisted as fact;
    //     discard rather than serve it for the rest of the TTL.
    //   - rows short of the server's own count -> the live-measured empty-page
    //     state written by a pre-shortfall build; same lie, same discard.
    if (typeof raw.totalPages !== "number" || typeof raw.truncated !== "boolean") {return null;}
    if (raw.truncated) {return null;}
    if (raw.pagesFetched < raw.totalPages) {return null;}
    const cachedTotalItems = typeof raw.totalItems === "number" ? raw.totalItems : null;
    if (cachedTotalItems !== null && raw.instancesExamined < cachedTotalItems) {return null;}

    return {
      byEndpoint: new Map(raw.entries),
      fetchedAt: raw.fetchedAt,
      instancesExamined: raw.instancesExamined,
      pagesFetched: raw.pagesFetched,
      bytes: raw.bytes,
      totalPages: raw.totalPages,
      totalItems: cachedTotalItems,
      truncated: false,
      shortfall: null,
      outOfTimeNote: null,
      orderBy: typeof raw.orderBy === "string" ? raw.orderBy : HISTORY_ORDER_BY,
    };
  } catch {
    return null; // absent, stale or unreadable — just refetch
  }
}

/**
 * Persist the reduction — but never a truncated one (H1).
 *
 * A truncated history on disk is worse than no history: it is served for the
 * full 15-minute TTL, it is keyed by endpoint display name, and the shape of
 * the lie is "this machine has never been scanned". The fields are still
 * written on the complete path so a reader can re-check, and so a pre-fix file
 * (which has neither) is distinguishable from a checked one.
 */
function writeDiskCache(c: CachedHistory, tenantKey: string, fingerprint: string): void {
  if (c.truncated) {
    console.error(
      `[bconnect-compliance] job history read to ${c.pagesFetched} of ${c.totalPages} pages ` +
        `(MAX_HISTORY_PAGES=${MAX_HISTORY_PAGES}, outOfTime=${c.outOfTimeNote != null}); not ` +
        `persisting it — a partial history served as fact reports scanned endpoints as never scanned`
    );
    return;
  }
  if (c.shortfall) {
    // Same lie, different cause: a short-served history on disk answers "never
    // scanned" for machines whose evidence the server simply did not serve,
    // for the full TTL.
    console.error(`[bconnect-compliance] ${c.shortfall} Not persisting it.`);
    return;
  }
  writeCacheFileSync(
    CACHE_DIR,
    tenantKey,
    JSON.stringify({
      // Whose estate this is, so a reader need not trust the filename alone.
      provenance: fingerprint,
      fetchedAt: c.fetchedAt,
      entries: [...c.byEndpoint],
      instancesExamined: c.instancesExamined,
      pagesFetched: c.pagesFetched,
      bytes: c.bytes,
      totalPages: c.totalPages,
      totalItems: c.totalItems,
      truncated: c.truncated,
      orderBy: c.orderBy,
    })
  );
}

function newer(a: string | null, b: string | null): boolean {
  if (!b) {return true;}
  if (!a) {return false;}
  return Date.parse(a) > Date.parse(b);
}

/**
 * Fetch the estate-wide job history once and reduce it to one scan record per
 * endpoint. Cached; see the module header for why module scope AND disk.
 *
 * Deliberately does NOT use `SearchQuery` to narrow to scan jobs or to a state.
 * Upstream finding D15: `SearchQuery` is matched against human-readable display
 * text, not the enum values the API itself returns, so filtering server-side by
 * anything read out of a response silently returns an empty set — and an empty
 * set here reads as "nothing has ever been scanned". Page, then filter
 * client-side. `explain-job-failure.ts` does the same, for the same reason.
 */
/**
 * The exported shape, unchanged: callers that only want the history keep
 * working. `getScanRecency` uses `loadHistoryWithMeta` below, because it also
 * has to report HOW the history arrived.
 */
export async function loadComplianceScanHistory(
  http: AxiosInstance,
  force = false,
  budget: TimeBudget = startTimeBudget()
): Promise<CachedHistory> {
  return (await loadHistoryWithMeta(http, force, budget)).history;
}

async function loadHistoryWithMeta(
  http: AxiosInstance,
  force = false,
  budget: TimeBudget = startTimeBudget()
): Promise<HistoryLoad> {
  // Same computation as the disk cache, so both partition identically. Without
  // it the memory cache sits in FRONT of the fingerprinted disk path and
  // silently undoes the partition for the whole TTL — and this history is keyed
  // by endpoint DISPLAY NAME, so server B's `WIN10-01` would inherit server A's
  // scan date and answer `neverScanned` / `scanAgeDays` for a machine nobody
  // looked at. That is a wrong fact about a real endpoint, not a stale one.
  const fingerprint = fingerprintFromHttpClient(http);
  const tenantKey = diskCachePath(fingerprint);
  if (
    !force &&
    historyCache &&
    historyCacheKey === tenantKey &&
    Date.now() - historyCache.fetchedAt < HISTORY_TTL_MS
  ) {
    return { history: historyCache, fromCache: true, loadMs: 0 };
  }
  if (!force) {
    const fromDisk = readDiskCache(tenantKey, fingerprint);
    if (fromDisk) {
      historyCache = fromDisk;
      historyCacheKey = tenantKey;
      return { history: fromDisk, fromCache: true, loadMs: 0 };
    }
  }

  const started = Date.now();

  const byEndpoint = new Map<string, JobHistoryScan>();
  let instancesExamined = 0;
  let bytes = 0;
  let pagesFetched = 0;

  const absorb = (rows: Array<Record<string, unknown>>): void => {
    for (const inst of rows) {
      instancesExamined++;
      const steps = (inst.steps ?? []) as Array<Record<string, unknown>>;
      for (const step of steps) {
        if (String(step.type ?? "") !== COMPLIANCE_SCAN_STEP) {continue;}

        const name = String(inst.endpointName ?? "");
        if (!name) {continue;}

        const at = step.lastAction == null ? null : String(step.lastAction);
        const state = step.state == null ? null : String(step.state);
        const succeeded = /^finishedsuccessfully$/i.test(state ?? "");

        const cur: JobHistoryScan = byEndpoint.get(name) ?? {
          endpointId: null,
          lastAttempt: null,
          lastSuccess: null,
          stepState: null,
          jobName: null,
          inProgress: false,
        };

        cur.endpointId = cur.endpointId ?? (inst.endpointId == null ? null : String(inst.endpointId));

        if (newer(at, cur.lastAttempt)) {
          cur.lastAttempt = at;
          cur.stepState = state;
          cur.jobName = inst.jobDefinitionName == null ? null : String(inst.jobDefinitionName);
          cur.inProgress = IN_PROGRESS_STATES.has((state ?? "").toLowerCase());
        }
        if (succeeded && newer(at, cur.lastSuccess)) {cur.lastSuccess = at;}

        byEndpoint.set(name, cur);
      }
    }
  };

  // The hand-rolled do/while this replaces read `totalPages` and threw it away
  // (H1). `paginateAll` hands the page counters back as data, which is the only
  // reason the caveats below can carry numbers. Rows are absorbed inside
  // `fetchPage` and `items: []` handed back, so the ~300 KB of raw instances per
  // page is never accumulated into an array — the reduction is the output.
  let totalItems: number | null = null;
  const walk = await walkWithin<never>(
    budget,
    async (page) => {
      const res = await http.get("/jobs/v2.0/JobInstances", {
        params: { PageSize: PAGE_SIZE, Page: page, OrderBy: HISTORY_ORDER_BY },
      });
      // `totalItems` captured because the walker cannot see it — this was the
      // last totalItems-blind estate walk in the suite (census 2026-08-13),
      // and it fed `neverScanned`, the claim the module header says must never
      // be made from a partial read.
      const body = res.data as { totalPages?: number; totalItems?: number; data?: Array<Record<string, unknown>> };
      if (page === 0 && typeof body.totalItems === "number") {totalItems = body.totalItems;}
      bytes += JSON.stringify(body).length;
      pagesFetched++;
      absorb(body.data ?? []);
      return { items: [], totalPages: body.totalPages ?? undefined };
    },
    { maxPages: MAX_HISTORY_PAGES }
  );

  const truncated = walk.truncated || walk.outOfTime;
  historyCache = {
    byEndpoint,
    fetchedAt: Date.now(),
    instancesExamined,
    pagesFetched,
    bytes,
    totalPages: walk.totalPages,
    totalItems,
    // The clock is a second route to a partial history and it lands in exactly
    // the same place: a partial history served as fact reports scanned
    // endpoints as never scanned, so it is caveated and never persisted.
    truncated,
    shortfall: truncated ? null : shortfallReason("The job-history walk", instancesExamined, totalItems),
    outOfTimeNote: timeBudgetReason("The job-history walk", walk, budget),
    orderBy: HISTORY_ORDER_BY,
  };
  historyCacheKey = tenantKey;
  writeDiskCache(historyCache, tenantKey, fingerprint);
  return { history: historyCache, fromCache: false, loadMs: Date.now() - started };
}

/** Where an endpoint's scan date came from. */
export type ScanSource = "detections" | "job-history" | "none";

export interface EndpointScanRecency {
  endpointName: string;
  endpointId: string | null;
  /** Best available "the vulnerability data for this endpoint is as of" date. */
  lastScan: string | null;
  scanAgeDays: number | null;
  scanSource: ScanSource;
  /** True when the newest scan step is still Running/Queued — no result yet. */
  scanInProgress: boolean;
  /** Job definition that last ran a compliance scan here, when known. */
  scanJob: string | null;
  /**
   * Days by which job history is *more optimistic* than the detection data.
   * Non-null only when the two signals disagree by more than a day — that is
   * the WIN11CLIENT10 case, and it is the number that makes a stale endpoint
   * look current.
   */
  jobHistoryOptimisticByDays: number | null;
  /** Human-readable caveat, present only when there is something to say. */
  note: string | null;
}

export interface ScanRecencyIndex {
  /** Keyed by endpoint display name — the only key `DetectedVulnerabilities` offers. */
  byEndpoint: Map<string, EndpointScanRecency>;
  meta: {
    fromCache: boolean;
    /** Wall time spent fetching job history; 0 on a cache hit. */
    loadMs: number;
    cacheAgeSeconds: number;
    instancesExamined: number;
    pagesFetched: number;
    /** `totalPages` the server reported. Never report `pagesFetched` without it (H1). */
    historyTotalPages: number;
    /** `totalItems` the server reported — the same H1 rule for rows: never
     *  report `instancesExamined` without the count it is measured against. */
    historyTotalItems: number | null;
    /** True when MAX_HISTORY_PAGES stopped the walk before the last page (H1). */
    historyTruncated: boolean;
    /** The explicit order the walk was taken in (H1). */
    historyOrderBy: string;
    /**
     * Plain-language statement of the incompleteness, or null when the walk
     * covered the history. Present so a caller does not have to reconstruct the
     * sentence from the numbers, and so composites can splice it into `caveats`.
     */
    historyIncomplete: string | null;
    historyBytes: number;
    endpointsWithScanEvidence: number;
  };
}

const DAY_MS = 86_400_000;
const ageDays = (iso: string | null, now: number): number | null =>
  iso == null ? null : Math.max(0, Math.round((now - Date.parse(iso)) / DAY_MS));

/**
 * Build the per-endpoint scan-recency index.
 *
 * `detections` is whatever the caller already loaded from
 * `DetectedVulnerabilities` — passing it in rather than refetching is the
 * difference between this being free and this doubling the caller's cost.
 * Pass an empty array to rely on job history alone.
 */
export async function getScanRecency(
  http: AxiosInstance,
  detections: Array<Record<string, unknown>>,
  opts: {
    refresh?: boolean;
    extraEndpoints?: Array<{ name: string; id?: string | null }>;
    /** The composite's own clock, so the history walk shares one deadline. */
    budget?: TimeBudget;
  } = {}
): Promise<ScanRecencyIndex> {
  const { history, fromCache, loadMs } = await loadHistoryWithMeta(http, opts.refresh, opts.budget);
  const now = Date.now();

  // Newest `detected` per endpoint. Measured on this estate every endpoint has
  // exactly one distinct value, but max() is the safe reduction either way.
  const newestDetection = new Map<string, { at: string; id: string | null }>();
  for (const d of detections) {
    const name = String(d.endpointName ?? "");
    if (!name) {continue;}
    const at = d.detected == null ? null : String(d.detected);
    if (!at) {continue;}
    const cur = newestDetection.get(name);
    if (!cur || Date.parse(at) > Date.parse(cur.at)) {
      newestDetection.set(name, { at, id: d.endpointId == null ? null : String(d.endpointId) });
    }
  }

  const names = new Set<string>([
    ...newestDetection.keys(),
    ...history.byEndpoint.keys(),
    ...(opts.extraEndpoints ?? []).map((e) => e.name),
  ]);

  const byEndpoint = new Map<string, EndpointScanRecency>();
  for (const name of names) {
    const det = newestDetection.get(name) ?? null;
    const job = history.byEndpoint.get(name) ?? null;
    const extraId = (opts.extraEndpoints ?? []).find((e) => e.name === name)?.id ?? null;

    // Detections win when present: they are the as-of date of the rows being
    // ranked, which is the question the caller is actually asking. Job history
    // is the fallback (scanned clean, or detections not loaded).
    const jobBest = job?.lastSuccess ?? job?.lastAttempt ?? null;
    const lastScan = det?.at ?? jobBest;
    const scanSource: ScanSource = det ? "detections" : jobBest ? "job-history" : "none";

    let optimisticBy: number | null = null;
    if (det && jobBest && Date.parse(jobBest) > Date.parse(det.at)) {
      const d = Math.round((Date.parse(jobBest) - Date.parse(det.at)) / DAY_MS);
      if (d >= 1) {optimisticBy = d;}
    }

    const notes: string[] = [];
    if (job?.inProgress) {
      notes.push(
        `A ${COMPLIANCE_SCAN_STEP} step is still ${job.stepState} (last action ${job.lastAttempt}); ` +
          `the data below predates it.`
      );
    }
    if (optimisticBy != null) {
      // No internal identifier in emitted text (D17 stays in the comments): the
      // reader has no document to resolve it against, so the fact it stands for
      // is stated instead.
      notes.push(
        `Job history would report this endpoint ${optimisticBy} day(s) fresher than its data actually is — ` +
          `the later scan attempt has not written results, so job history shows attempts, not refreshes.`
      );
    }
    if (det && !job) {
      notes.push(
        `No ${COMPLIANCE_SCAN_STEP} for this endpoint survives in job history, so a job-history ` +
          `cross-reference alone would report it as never scanned. The detection timestamp says otherwise.`
      );
    }
    if (!det && job && job.lastSuccess) {
      notes.push(`Scanned with no detections recorded — treat as scanned-clean, not as unscanned.`);
    }
    if (scanSource === "none") {
      // H1. Over a truncated walk the old sentence — "No scan evidence from
      // either signal" — is a claim about the estate derived from a partial
      // read, and it is the sentence that reaches an operator as "nobody has
      // ever looked at this machine". The bound has to be stated instead.
      if (history.truncated) {
        notes.push(
          `${incompleteNote(history)} A ${COMPLIANCE_SCAN_STEP} for this endpoint may sit outside what ` +
            `was read. This is NOT evidence that the endpoint was never scanned — it is the absence of ` +
            `a read, not the absence of a scan.`
        );
      } else {
        notes.push(`No scan evidence from either signal. Absence of vulnerabilities here means unknown, not clean.`);
      }
    }

    byEndpoint.set(name, {
      endpointName: name,
      endpointId: det?.id ?? job?.endpointId ?? extraId,
      lastScan,
      scanAgeDays: ageDays(lastScan, now),
      scanSource,
      scanInProgress: job?.inProgress ?? false,
      scanJob: job?.jobName ?? null,
      jobHistoryOptimisticByDays: optimisticBy,
      note: notes.length ? notes.join(" ") : null,
    });
  }

  return {
    byEndpoint,
    meta: {
      fromCache,
      loadMs,
      cacheAgeSeconds: Math.round((now - history.fetchedAt) / 1000),
      instancesExamined: history.instancesExamined,
      pagesFetched: history.pagesFetched,
      historyTotalPages: history.totalPages,
      historyTotalItems: history.totalItems,
      historyTruncated: history.truncated,
      historyOrderBy: history.orderBy,
      historyIncomplete: incompleteNote(history),
      historyBytes: history.bytes,
      endpointsWithScanEvidence: history.byEndpoint.size,
    },
  };
}

/** Compact summary of an index, for a response's top level. */
export function summarizeScanRecency(
  index: ScanRecencyIndex,
  staleAfterDays: number
): Record<string, unknown> {
  const rows = [...index.byEndpoint.values()];
  const aged = rows.filter((r) => r.scanAgeDays != null).map((r) => r.scanAgeDays as number);
  aged.sort((a, b) => a - b);
  const median = aged.length ? aged[Math.floor(aged.length / 2)] : null;

  return {
    staleAfterDays,
    endpointsWithScanDate: aged.length,
    neverScanned: rows.filter((r) => r.scanSource === "none").map((r) => r.endpointName),
    /**
     * H1. `neverScanned` is the most consequential list this module produces —
     * it is what an operator reads as "nobody has ever looked at these
     * machines". Over a truncated history walk it is not that list; it is
     * "these machines had no scan on the pages we read". The flag says which
     * of the two you are holding, and the note says why.
     */
    // Gated on historyIncomplete, not historyTruncated alone: a short-served
    // walk (rows missing under an intact header) is the same partial read from
    // a different cause, and this list must not be trusted over either.
    neverScannedTrustworthy: index.meta.historyIncomplete == null,
    neverScannedNote: index.meta.historyIncomplete != null
      ? `${index.meta.historyIncomplete} Endpoints listed under neverScanned may have been scanned ` +
        `outside what was read; treat this list as "no evidence found", not as "never scanned".`
      : null,
    scansInProgress: rows.filter((r) => r.scanInProgress).map((r) => r.endpointName),
    newestScanAgeDays: aged.length ? aged[0] : null,
    medianScanAgeDays: median,
    oldestScanAgeDays: aged.length ? aged[aged.length - 1] : null,
    staleEndpoints: rows.filter((r) => (r.scanAgeDays ?? Infinity) > staleAfterDays).length,
    // Endpoints where D17's documented workaround alone would have been wrong.
    jobHistoryWouldOverstateCurrency: rows
      .filter((r) => r.jobHistoryOptimisticByDays != null)
      .map((r) => ({ endpointName: r.endpointName, byDays: r.jobHistoryOptimisticByDays })),
  };
}
