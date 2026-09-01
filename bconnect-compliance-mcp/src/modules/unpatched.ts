/**
 * Unpatched-endpoint queue — composite read-only analysis.
 *
 * LOCAL ADDITION (not upstream). This formalises a join that had been living as
 * prose in a demo skill (`.claude/skills/patch-queue-demo/SKILL.md`), where a
 * model re-derived it from scratch on every run: **vulnerability count x
 * reachability x scan age**. Three servers, none of which answers the question,
 * and the wrong answer is the plausible one.
 *
 * Why it exists, one clause per input:
 *
 *   - **Vulnerability count** is `get_vulnerability_exposure`'s ranking, which
 *     already exists because the raw join costs ~40 requests and ~31 MB
 *     (upstream finding D7). Reused here, not recomputed: the same single fetch
 *     of `DetectedVulnerabilities` feeds both the ranking and the scan-age
 *     lookup.
 *
 *   - **Reachability** comes from `lastSeen` on the endpoints listing, and it is
 *     the difference between a patch job that runs and a patch job that queues
 *     silently against a machine that has been offline for a year. On this
 *     estate, 3 of 26 endpoints had checked in today and 8 had been dark for
 *     more than 290 days — several of them still ranked high on vulnerability
 *     count, because a decommissioned machine's last scan never expires. Ranking
 *     by vulnerabilities alone puts ghosts at the top of the queue. It uses the
 *     generic `/Endpoints` projection (25 KB for 26 endpoints) rather than
 *     `/WindowsEndpoints` (63 KB for 23) — upstream D1's own point, that the
 *     lean shape already exists.
 *
 *   - **Scan age** answers upstream finding D17 and is the reason this tool is
 *     honest rather than merely convenient. A vulnerability count with no
 *     visible age reads as "this is the current state"; for most rows in a real
 *     estate it is not. See `scan-recency.ts` for how the date is derived, why
 *     one signal is not enough, and what it cost to measure.
 *
 * The output ranks by vulnerability count — the question as asked — but every
 * row carries the two qualifiers that decide whether the number means anything,
 * and `caveats` states in plain language when the ranking is not comparable
 * across rows. Nothing is silently filtered out: an unreachable or never-scanned
 * endpoint is returned and labelled, because "not in the list" and "in the list
 * and unactionable" lead to very different operator decisions.
 *
 * Read-only. It stages the ask; it does not patch anything.
 */

import type { AxiosInstance } from "axios";
import { CREDENTIAL_SCOPE_NOTE, assessResultTrust, shortfallReason } from "@bconnect/mcp-core";
import type { ComplianceModule } from "./compliance.js";
import { analyzeExposure } from "./exposure.js";
import { getScanRecency, summarizeScanRecency } from "./scan-recency.js";
import {
  BUDGET_ENV,
  startTimeBudget,
  timeBudgetReason,
  walkWithin,
  type TimeBudget,
} from "./time-budget.js";

const DAY_MS = 86_400_000;
const ENDPOINT_PAGE_SIZE = 1000;
const MAX_ENDPOINT_PAGES = 25;

/**
 * Default reachability window, in days.
 *
 * The previous default was 1 — "checked in today" — which is not a property of
 * bMS but of the lab it was tuned against, where the endpoints were always-on
 * VMs. On a laptop fleet, or over a weekend, or wherever the bMS check-in
 * interval is longer than a day, that default labels healthy machines
 * unreachable and tells the operator their patch queue is unactionable. That is
 * a false negative on the exact question this tool exists to answer, and it
 * points the reader at a connectivity investigation instead of at patching.
 *
 * 7 spans a weekend plus a normal check-in interval. It is still an assumption,
 * which is why `meta.reachability` reports the estate's OWN observed check-in
 * ages beside it and a caveat fires when the window is short relative to them.
 * Deliberately not derived from those ages: the machines that drag the median
 * out are precisely the dark ones this flag exists to find, so a data-derived
 * window would widen itself until everything looked reachable.
 */
const DEFAULT_REACHABLE_WITHIN_DAYS = 7;

/**
 * Explicit order for the endpoint walk (H4). A bounded read of an unordered
 * collection returns an arbitrary subset and is not reproducible between runs.
 *
 * Measured live 2026-08-03 against 26R1: the default order of
 * `/endpoints/v2.0/Endpoints` is not sorted by anything
 * (`WIN10CLIENT4 | WIN10CLIENT1 | WIN10CLIENT3 | ...`), `DisplayName asc` is
 * honoured, and an unknown property answers HTTP 400 — so this value is checked
 * by the server rather than merely declared by the spec. `DisplayName` also
 * happens to be the key the vulnerability rows join on, so a bounded walk covers
 * a contiguous, nameable slice rather than a random one.
 */
const ENDPOINT_ORDER_BY = "DisplayName asc";

interface EndpointRow {
  id: string | null;
  displayName: string;
  type: string | null;
  operatingSystem: string | null;
  lastSeen: string | null;
  activity: string | null;
}

/** What the endpoint walk covered — never the array length on its own (H4). */
interface EndpointWalk {
  rows: EndpointRow[];
  pagesFetched: number;
  totalPages: number;
  /** `totalItems` from page 0: the server's own statement of the estate size. */
  totalItems: number | null;
  truncated: boolean;
  /** True when the call's time budget, not the page bound, stopped the walk. */
  outOfTime: boolean;
}

/**
 * Fetch the estate's endpoints via the lean generic projection.
 *
 * Not cached. `lastSeen` is precisely the field that must not be stale — a tool
 * whose whole job is telling you how current things are cannot serve reachability
 * from a cache. It is also the cheap half of this tool: ~25 KB, ~40 ms measured.
 *
 * H4: this used to be a hand-rolled do/while — the very loop
 * `packages/mcp-core/src/paginate.ts:11-15` names as its reference
 * implementation and which was never migrated. It read `totalPages`, discarded
 * it, and returned a bare array whose length was then published as
 * `totals.endpointsInEstate`. It now returns what it covered as well as what it
 * read, because past the bound the failure is not a missing row — it is the
 * blocker sentence "No endpoint record matches this name ... a renamed or
 * deleted endpoint still carries detections", which is a confident, specific,
 * wrong explanation for a machine that exists.
 */
async function loadEndpoints(http: AxiosInstance, budget: TimeBudget): Promise<EndpointWalk> {
  const out: EndpointRow[] = [];
  let totalItems: number | null = null;

  const walk = await walkWithin<never>(
    budget,
    async (page) => {
      const res = await http.get("/endpoints/v2.0/Endpoints", {
        params: { PageSize: ENDPOINT_PAGE_SIZE, Page: page, OrderBy: ENDPOINT_ORDER_BY },
      });
      const body = res.data as {
        totalPages?: number;
        totalItems?: number;
        data?: Array<Record<string, unknown>>;
      };
      if (page === 0 && typeof body.totalItems === "number") {
        totalItems = body.totalItems;
      }
      for (const e of body.data ?? []) {
        out.push({
          id: e.id == null ? null : String(e.id),
          displayName: String(e.displayName ?? ""),
          type: e.type == null ? null : String(e.type),
          operatingSystem: e.operatingSystem == null ? null : String(e.operatingSystem),
          lastSeen: e.lastSeen == null ? null : String(e.lastSeen),
          activity: e.activity == null ? null : String(e.activity),
        });
      }
      return { items: [], totalPages: body.totalPages ?? undefined };
    },
    { maxPages: MAX_ENDPOINT_PAGES }
  );

  return {
    rows: out,
    pagesFetched: walk.pagesFetched,
    totalPages: walk.totalPages,
    totalItems,
    truncated: walk.truncated || walk.outOfTime,
    outOfTime: walk.outOfTime,
  };
}

export interface UnpatchedOptions {
  /** Minimum CVSS to count a detection (default: 7 — "high and above"). */
  minCvss?: number;
  /** How many endpoints to return, most-affected first (default: 10). */
  limit?: number;
  /**
   * An endpoint counts as reachable if it checked in within this many days
   * (default: DEFAULT_REACHABLE_WITHIN_DAYS). This is the flag that decides
   * whether a patch job would run or merely queue, so the right value is the
   * estate's own check-in interval — see the constant for why there is a
   * default at all.
   */
  reachableWithinDays?: number;
  /** Scan age beyond which the count is flagged as stale (default: 30 days). */
  staleAfterDays?: number;
  /** Drop unreachable endpoints instead of returning them labelled (default: false). */
  onlyReachable?: boolean;
  /** Include detections marked ignored in bMS (default: false). */
  includeIgnored?: boolean;
  /** Force a refresh of the cached vulnerability library and job history. */
  refresh?: boolean;
}

export async function getUnpatchedEndpoints(
  compliance: ComplianceModule,
  http: AxiosInstance,
  opts: UnpatchedOptions = {}
): Promise<Record<string, unknown>> {
  const minCvss = opts.minCvss ?? 7;
  const limit = opts.limit ?? 10;
  const reachableWithinDays = opts.reachableWithinDays ?? DEFAULT_REACHABLE_WITHIN_DAYS;
  const staleAfterDays = opts.staleAfterDays ?? 30;
  const onlyReachable = opts.onlyReachable ?? false;
  const includeIgnored = opts.includeIgnored ?? false;

  // One clock for the whole call. Four walks run under it — the CVE library,
  // detections, endpoints and job history — and an MCP client's tool-call
  // timeout applies to all of them together, so they must too.
  const budget = startTimeBudget();
  const startedAt = budget.startedAt;

  // The exposure analysis and the endpoint listing are independent; the scan
  // index depends on the detections the first one returns.
  const [analysis, endpointWalk] = await Promise.all([
    analyzeExposure(compliance, { minCvss, includeIgnored, refreshLibrary: opts.refresh }, budget),
    loadEndpoints(http, budget),
  ]);
  const endpoints = endpointWalk.rows;

  /**
   * The sentence the endpoint walk owes the caller when it hit its bound (H4).
   * Built once and reused, so the caveat, the per-row blocker and
   * `resultTrustworthyReasons` all carry the same numbers rather than three
   * paraphrases of them.
   */
  // A walk that COMPLETED while the server short-served it (fewer rows than
  // its own totalItems — the live-measured empty page under an intact header
  // is the extreme case) is the same incompleteness as a bounded walk, from a
  // different cause. Gated on !truncated so a page-cap stop stays ONE
  // condition with the cap's own wording, not two reasons and a "retry" the
  // client-side bound cannot honour.
  const endpointsShortfall = endpointWalk.truncated
    ? null
    : shortfallReason("The endpoint listing walk", endpoints.length, endpointWalk.totalItems);
  const endpointsIncomplete: string | null = endpointWalk.truncated
    ? (timeBudgetReason("The endpoint listing walk", endpointWalk, budget) ??
        `The endpoint listing was read to page ${endpointWalk.pagesFetched} of ` +
          `${endpointWalk.totalPages} (bounded by MAX_ENDPOINT_PAGES=${MAX_ENDPOINT_PAGES}, ordered ` +
          `"${ENDPOINT_ORDER_BY}"), so ${endpoints.length} of ` +
          `${endpointWalk.totalItems ?? "an unknown number of"} endpoint record(s) were read.`)
    : endpointsShortfall
      ? `${endpointsShortfall} An empty or short page under an intact header has been observed ` +
        `live on this API. Retry; if it persists, the server's own count disagrees with what ` +
        `it serves.`
      : null;

  const byName = new Map<string, EndpointRow>();
  for (const e of endpoints) {if (e.displayName) {byName.set(e.displayName, e);}}

  let scanIndex: Awaited<ReturnType<typeof getScanRecency>> | null = null;
  let scanError: string | null = null;
  try {
    scanIndex = await getScanRecency(http, analysis.newestDetectionPerEndpoint, {
      refresh: opts.refresh,
      budget,
      // Endpoints with no detections and no scan job still belong in the index:
      // "we have never measured this machine" is an answer, and a different one
      // from "this machine is clean".
      extraEndpoints: endpoints.map((e) => ({ name: e.displayName, id: e.id })),
    });
  } catch (err) {
    scanError = err instanceof Error ? err.message : String(err);
  }

  const now = Date.now();
  const offlineDays = (iso: string | null): number | null =>
    iso == null ? null : Math.max(0, Math.round((now - Date.parse(iso)) / DAY_MS));

  /**
   * The estate's own check-in behaviour, so the reachability window is reported
   * as the assumption it is rather than applied silently. Computed over
   * endpoints that have EVER checked in — a null `lastSeen` is a different fact
   * ("never contacted") and folding it in would blur both.
   */
  const checkInAges = endpoints
    .map((e) => offlineDays(e.lastSeen))
    .filter((d): d is number => d != null)
    .sort((a, b) => a - b);
  const checkInPercentile = (p: number): number | null =>
    checkInAges.length
      ? checkInAges[Math.min(checkInAges.length - 1, Math.floor(p * checkInAges.length))]
      : null;
  const medianCheckInAgeDays = checkInPercentile(0.5);

  const all = [...analysis.byEndpoint.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].max - a[1].max)
    .map(([endpointName, v]) => {
      const ep = byName.get(endpointName) ?? null;
      const scan = scanIndex?.byEndpoint.get(endpointName) ?? null;
      const off = offlineDays(ep?.lastSeen ?? null);
      const reachable = off != null && off <= reachableWithinDays;

      const blockers: string[] = [];
      if (!ep) {
        // H4. Over a truncated walk the renamed-or-deleted sentence is a
        // confident, specific, wrong explanation for a machine that exists and
        // simply sat on a page nobody read. Two different situations, so two
        // different sentences — the difference decides whether an operator goes
        // looking for a decommissioned host or for the rest of their estate.
        blockers.push(
          endpointsIncomplete
            ? `No endpoint record was READ for this name, and the endpoint listing was ` +
              `INCOMPLETE: ${endpointsIncomplete} This endpoint may exist among the rows not ` +
              `read. Do not read this as a renamed or deleted machine without re-running ` +
              `against a complete walk.`
            : `No endpoint record matches this name in the endpoints listing — the vulnerability rows ` +
              `key on display name only, so a renamed or deleted endpoint still carries detections.`
        );
      } else if (off == null) {
        blockers.push(`Never checked in (lastSeen is null) — a job assigned now would queue indefinitely.`);
      } else if (!reachable) {
        blockers.push(
          `Last seen ${off} day(s) ago — a patch job assigned now would queue silently until it returns.`
        );
      }

      return {
        endpointName,
        endpointId: ep?.id ?? scan?.endpointId ?? null,
        vulnerabilitiesAboveThreshold: v.count,
        highestCvss: v.max,
        exampleCriticalCves: [...v.worst].slice(0, 3),

        // Reachability
        reachable,
        lastSeen: ep?.lastSeen ?? null,
        offlineDays: off,
        operatingSystem: ep?.operatingSystem ?? null,
        // Verbatim from bMS. Frequently the most informative single string about
        // why a machine is unreachable ("Unable to reach client ... via ping").
        currentActivity: ep?.activity ?? null,

        // Scan age (D17)
        lastScan: scan?.lastScan ?? null,
        scanAgeDays: scan?.scanAgeDays ?? null,
        scanSource: scan?.scanSource ?? null,
        scanIsStale: scan?.scanAgeDays == null ? null : scan.scanAgeDays > staleAfterDays,
        scanInProgress: scan?.scanInProgress ?? false,
        scanNote: scan?.note ?? null,

        // The join's actual verdict.
        patchable: reachable,
        blockers,
      };
    });

  const returned = (onlyReachable ? all.filter((r) => r.reachable) : all).slice(0, limit);

  // Reachable machines nobody has ever scanned. These carry zero vulnerabilities
  // and would otherwise be invisible in a vulnerability-ranked list — the single
  // most misleading way to read this data, since zero here means "unmeasured",
  // not "clean".
  const neverScannedReachable = endpoints
    .filter((e) => {
      const s = scanIndex?.byEndpoint.get(e.displayName);
      const off = offlineDays(e.lastSeen);
      return (
        (s == null || s.scanSource === "none") &&
        off != null &&
        off <= reachableWithinDays &&
        !analysis.byEndpoint.has(e.displayName)
      );
    })
    .map((e) => ({ endpointName: e.displayName, endpointId: e.id, lastSeen: e.lastSeen }));

  const caveats: string[] = [];
  const staleReturned = returned.filter((r) => r.scanIsStale === true);
  if (staleReturned.length) {
    caveats.push(
      `${staleReturned.length} of ${returned.length} returned endpoint(s) have a vulnerability scan older ` +
        `than ${staleAfterDays} days. Their counts describe what was true at scan time, not today — anything ` +
        `installed since has never been checked against the CVE library.`
    );
  }
  const ages = returned.map((r) => r.scanAgeDays).filter((d): d is number => d != null);
  if (ages.length > 1 && Math.max(...ages) - Math.min(...ages) > staleAfterDays) {
    caveats.push(
      `Scan ages in this list span ${Math.min(...ages)} to ${Math.max(...ages)} days, so the ranking is not ` +
        `directly comparable across rows — a fresh scan on a dirty machine and a stale scan on a clean one ` +
        `look identical by count alone.`
    );
  }
  const unreachable = returned.filter((r) => !r.reachable);
  if (unreachable.length && !onlyReachable) {
    caveats.push(
      `${unreachable.length} of ${returned.length} returned endpoint(s) are not reachable now. They are ` +
        `listed rather than hidden — a long-dark machine still counts toward licence and compliance numbers ` +
        `— but a patch job assigned to one queues silently instead of running.`
    );
  }
  // The reachability window is an assumption about how often THESE machines
  // contact bMS, and it is the one input here that nothing in the API states.
  // When the estate's own behaviour contradicts it, say so — otherwise the tool
  // reports a healthy fleet as an unactionable queue and sends the operator
  // after a connectivity problem that does not exist.
  if (medianCheckInAgeDays != null && medianCheckInAgeDays > reachableWithinDays) {
    caveats.push(
      `The reachability window is ${reachableWithinDays} day(s), but half the endpoints read here last ` +
        `checked in ${medianCheckInAgeDays} or more day(s) ago. A window shorter than an estate's own ` +
        `check-in interval labels healthy machines unreachable — set reachableWithinDays to match how ` +
        `often these endpoints actually contact bMS (see meta.reachability).`
    );
  }
  if (returned.some((r) => r.scanInProgress)) {
    caveats.push(`A compliance scan is in progress on at least one listed endpoint; its counts will move.`);
  }
  if (neverScannedReachable.length) {
    caveats.push(
      `${neverScannedReachable.length} reachable endpoint(s) have no vulnerability scan on record at all ` +
        `(listed under neverScannedReachable). They show zero vulnerabilities because nobody has looked.`
    );
  }
  // H4. `neverScannedReachable` is built by filtering the same truncated array,
  // so a bounded walk silently shortens the one list whose purpose is to say
  // "nobody has ever looked at this machine". Stated separately from the walk
  // caveat below because the reading is different: that one says the totals are
  // short, this one says a named list is short.
  if (endpointsIncomplete) {
    caveats.push(
      `The neverScannedReachable list is incomplete for the same reason: it is filtered from the ` +
        `endpoints that were read, and the walk covered ${endpointWalk.pagesFetched} of ` +
        `${endpointWalk.totalPages} page(s). Endpoints missing from that read cannot appear in it ` +
        `whether or not they have ever been scanned.`
    );
  }
  // H1. The scan-recency index has its own bound, independent of the endpoint
  // walk, and it degrades in the same direction: toward "we have never measured
  // this machine".
  if (scanIndex?.meta.historyIncomplete) {
    caveats.push(
      `${scanIndex.meta.historyIncomplete} Any scanSource of "none" below means no evidence was read, ` +
        `not that no scan happened.`
    );
  }
  if (scanError) {
    caveats.push(`Scan age unavailable: ${scanError}. Counts below carry no age context.`);
  }
  // A truncated detections walk means every count here undercounts (P0-NEW).
  // Distinct from the library caveat below: the scores are right, the totals
  // are short. Unshifted before it so the library caveat still lands first
  // when both apply.
  if (analysis.detectionsIncomplete) {
    caveats.unshift(
      `THE DETECTIONS LISTING IS INCOMPLETE. ${analysis.detectionsIncomplete} Endpoints may be ` +
        `missing from this queue entirely.`
    );
  }
  // Loudest caveat, first in the list. An empty queue produced by an outage
  // looks exactly like an empty queue produced by a healthy estate, and only one
  // of those is good news. Finding B10; since P0-NEW this also covers a
  // truncated (non-empty) library, which downstream reads exactly the same way.
  // H4. Loud, and above the ordinary caveats, because it is the condition under
  // which `totals.endpointsInEstate`, the reachability verdict on every row, and
  // `neverScannedReachable` are all simultaneously wrong in the same direction.
  if (endpointsIncomplete) {
    caveats.unshift(
      `THE ENDPOINT LISTING IS INCOMPLETE. ${endpointsIncomplete} Endpoints missing from the read ` +
        `have no lastSeen here, so they are labelled unreachable and may be missing from this queue ` +
        `entirely.`
    );
  }
  if (analysis.libraryUnavailable) {
    caveats.unshift(
      `THIS QUEUE IS NOT TRUSTWORTHY. The CVE library did not load, so none of the ` +
        `${analysis.detections.totalItems ?? analysis.detections.rowsExamined} detection(s) this bMS ` +
        `reports could be scored and no endpoint can be ranked. An empty or short list here means the ` +
        `lookup failed, not that nothing needs patching. Cause: ${analysis.libraryUnavailable}`
    );
  }

  return {
    // Self-describing: state what was actually applied (upstream §12).
    query: {
      minCvss,
      limit,
      reachableWithinDays,
      staleAfterDays,
      onlyReachable,
      includeIgnored,
    },
    totals: {
      // H4. This used to be `endpoints.length` — the length of a bounded walk
      // published under a field name that says "in estate". It is now the
      // server's own `totalItems`, which stays exact even when the walk is
      // bounded, with what was actually read beside it.
      endpointsInEstate: endpointWalk.totalItems ?? endpoints.length,
      endpointsExamined: endpoints.length,
      endpointWalkTruncated: endpointWalk.truncated,
      endpointsWithVulnerabilitiesAboveThreshold: analysis.byEndpoint.size,
      detectionsAboveThreshold: analysis.detections.aboveThreshold,
      returned: returned.length,
      reachableReturned: returned.filter((r) => r.reachable).length,
      staleScansReturned: staleReturned.length,
    },
    scanRecency: scanIndex ? summarizeScanRecency(scanIndex, staleAfterDays) : null,
    endpoints: returned,
    neverScannedReachable,
    caveats,
    meta: {
      // An estate-wide aggregate, so it owes the scope disclosure. See
      // result-trust.ts. Measured under a scoped key: endpointsInEstate 27 -> 9
      // and `scanRecency.neverScanned` 6 -> 0 — a patch queue that reports NO
      // never-scanned machine beside `resultTrustworthy: true`.
      credentialScope: CREDENTIAL_SCOPE_NOTE,
      elapsedMs: Date.now() - startedAt,
      // What the walks were allowed and what they used, reported whether or not
      // the budget bit — a caller comparing runs can see a call approaching its
      // ceiling before it starts truncating.
      timeBudget: {
        budgetMs: budget.totalMs,
        elapsedMs: budget.elapsedMs(),
        envVar: BUDGET_ENV,
      },
      libraryEntries: analysis.library.size,
      // The server's own count of detections, with what was actually folded in
      // beside it — a bounded walk must not publish its own length as a total.
      detectionsInEstate: analysis.detections.totalItems ?? analysis.detections.rowsExamined,
      detectionsExamined: analysis.detections.rowsExamined,
      // The window this run applied, next to what the estate's own check-in
      // behaviour looks like, so the assumption is checkable rather than buried.
      reachability: {
        windowDays: reachableWithinDays,
        endpointsWithCheckIn: checkInAges.length,
        medianCheckInAgeDays,
        p90CheckInAgeDays: checkInPercentile(0.9),
        note:
          "The right window is the interval at which these endpoints actually contact bMS; the default " +
          "spans a weekend and is not derived from any estate.",
      },
      libraryUnavailable: analysis.libraryUnavailable,
      // The shared completeness contract — see `@bconnect/mcp-core`
      // for what `resultTrustworthy: false` means and what it deliberately does
      // not mean. Two conditions were missing before (audit M4/H1/H4): the
      // endpoint walk's bound, and the scan-history walk's bound. Both degrade
      // toward "we have never measured this machine", which is precisely the
      // direction this tool must not fail in.
      ...assessResultTrust(
        analysis.libraryUnavailable,
        analysis.detectionsIncomplete,
        endpointsIncomplete,
        scanIndex?.meta.historyIncomplete ?? null,
        scanError ? `The scan-recency index could not be built: ${scanError}` : null
      ),
      endpointWalk: {
        pagesFetched: endpointWalk.pagesFetched,
        totalPages: endpointWalk.totalPages,
        totalItems: endpointWalk.totalItems,
        rowsExamined: endpoints.length,
        truncated: endpointWalk.truncated,
        shortfall: endpointsShortfall,
        outOfTime: endpointWalk.outOfTime,
        orderBy: ENDPOINT_ORDER_BY,
        maxPages: MAX_ENDPOINT_PAGES,
      },
      scanAge: scanIndex
        ? {
            historyFromCache: scanIndex.meta.fromCache,
            historyLoadMs: scanIndex.meta.loadMs,
            jobInstancesExamined: scanIndex.meta.instancesExamined,
            historyPagesFetched: scanIndex.meta.pagesFetched,
            // H1. `historyPagesFetched` on its own is a bare number a reader
            // cannot tell apart from "the history was that long".
            historyTotalPages: scanIndex.meta.historyTotalPages,
            historyTotalItems: scanIndex.meta.historyTotalItems,
            historyTruncated: scanIndex.meta.historyTruncated,
            historyOrderBy: scanIndex.meta.historyOrderBy,
            historyIncomplete: scanIndex.meta.historyIncomplete,
            historyBytes: scanIndex.meta.historyBytes,
          }
        : null,
      note:
        "Read-only. Ranking is by vulnerability count above the CVSS threshold; reachability and scan " +
        "age qualify it rather than filter it. Assigning a patch job is a separate, write-gated action.",
    },
  };
}
