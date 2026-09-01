/**
 * Security posture — composite read-only aggregate.
 *
 * LOCAL ADDITION (not upstream). Answers "how exposed are we" across BitLocker,
 * Microsoft Defender and detected threats in one response.
 *
 * The underlying listings are deeply nested — a BitLocker record carries every
 * storage medium and volume, so four endpoints cost ~7 KB and the estate ~40 KB
 * (upstream finding D1) — to answer a question whose useful form is a handful of
 * counts. This reads them once and returns the counts, plus the specific
 * endpoints worth naming.
 *
 * Deliberately surfaces DEFINITION AGE. Whether Defender is "active" is close to
 * useless on its own: an endpoint can report active while running signatures
 * that are months old, which is the more common real-world failure.
 *
 * ── Completeness (audit finding C2, fixed 2026-08-03) ───────────────────────
 * This function used to request `PageSize: 1000`, send no `Page`, and never read
 * `totalPages` or `totalItems`. Every number it returned was page 0 presented as
 * an estate figure. Driven against a server reporting 5 pages of endpoints and
 * 12,400 detected threats it answered `threats.total: 0` and
 * `headline: ["No posture issues found in the checked dimensions."]`, with no
 * field anywhere a careful caller could have checked. That is the same sentence
 * as "nothing needs patching" over 1,522 critical detections — this project's
 * worst shipped defect — in a different server.
 *
 * It was invisible because labcorp.local answers `totalPages=1` on all three
 * routes (measured 2026-08-03: BitLocker 23/1, Defender 23/1, Threats 0/1), and
 * because no test executed this function.
 *
 * Three things changed, and none of them is "add a `truncated` field":
 *
 *   1. All three reads go through `paginateAll` with a real bound.
 *   2. `threats.total` is the envelope's own `totalItems`, not the length of
 *      what was materialised — so the count stays exact even when the walk is
 *      bounded, and the B10 shape (nonzero total, empty `data`) can no longer
 *      read as zero.
 *   3. **The verdict changes when the read is partial.** `headline` leads with
 *      what was and was not read, and cannot say "No posture issues found" over
 *      an incomplete walk. `meta.resultTrustworthy` carries the same fact in a
 *      machine-readable form (see `@bconnect/mcp-core`).
 *
 * ── Ordering ────────────────────────────────────────────────────────────────
 * A bounded read of an unordered collection is not reproducible: it returns an
 * arbitrary subset, and which endpoints fall outside the bound changes between
 * runs. Every walk here sends an explicit `OrderBy`.
 *
 * Measured live against 26R1, 2026-08-03 — the default order on all three routes
 * is not sorted by anything (`WIN10CLIENT4 | WIN10CLIENT1 | WIN10CLIENT3 | ...`),
 * `OrderBy` is honoured, and an unknown property answers **HTTP 400**, so these
 * values are wire-verified rather than inferred from the spec. Note that
 * `EndpointId` — which the 26R1 spec text names as legal on
 * `BitLocker/WindowsEndpoints` and `MicrosoftDefender/WindowsEndpoints` —
 * answers HTTP 400 on the live server. Only `EndpointName` works. Do not
 * "restore" `EndpointId` from the spec.
 */

import {
  CREDENTIAL_SCOPE_NOTE,
  assessResultTrust,
  shortfallReason,
  truncationReason,
} from "@bconnect/mcp-core";

import type { DefenseControlModule } from "./defensecontrol.js";
import {
  BUDGET_ENV,
  startTimeBudget,
  timeBudgetReason,
  walkWithin,
  type TimeBudget,
} from "./time-budget.js";

const DAY_MS = 86_400_000;
const PAGE_SIZE = 1000;

/**
 * Endpoint-listing bound: 25 pages x 1000 = 25,000 endpoint records. bMS
 * deployments of 1,000+ endpoints are ordinary; 25,000 is an order of magnitude
 * beyond that, and past it the response says so rather than quietly shortening.
 */
const MAX_ENDPOINT_PAGES = 25;

/**
 * Threat bound: 10 pages x 1000 = 10,000 threat rows materialised. Lower than
 * the endpoint bound on purpose — the only thing this composite does with threat
 * rows is count them, and the count comes from the envelope's `totalItems`
 * regardless of how many rows were read. Reading more would cost bytes and buy
 * nothing.
 */
const MAX_THREAT_PAGES = 10;

/** Wire-verified 2026-08-03; see the module header before changing any of these. */
const ORDER_BITLOCKER = "EndpointName asc";
const ORDER_DEFENDER = "EndpointName asc";
const ORDER_THREATS = "Severity desc, Name asc";

interface Volume {
  isSystemVolume?: boolean;
  driveLetter?: string;
  bitLockerVolumeData?: { protectionStatus?: string; conversionStatus?: string } | null;
}
interface BitLockerRow {
  endpointName?: string;
  isSecureBootEnabled?: boolean;
  tpmData?: { tpmStatus?: string } | null;
  storageMedia?: Array<{ storageVolumes?: Volume[] }>;
}
interface DefenderRow {
  endpointName?: string;
  isMicrosoftDefenderActive?: boolean;
  microsoftDefenderState?: {
    antivirus?: { isActive?: boolean; definitionCreation?: string; definitionVersion?: string };
    antispyware?: { isActive?: boolean; definitionCreation?: string };
    antimalware?: { isActive?: boolean; runningMode?: string; engineVersion?: string };
  } | null;
}

/** What one paged read of one dimension actually covered. */
interface Coverage {
  /** Rows absorbed into the counts below. */
  rowsExamined: number;
  pagesFetched: number;
  /** `totalPages` as the server reported it on page 0. */
  totalPages: number;
  /** `totalItems` as the server reported it on page 0; null when omitted. */
  totalItems: number | null;
  /** True when the page bound stopped the walk before the last page. */
  truncated: boolean;
  /** True when the call's time budget, not the page bound, stopped the walk. */
  outOfTime: boolean;
}

/** A bConnect list envelope, only the parts this module reads. */
interface Envelope<T> {
  totalPages?: number | null;
  totalItems?: number | null;
  data?: T[] | null;
}

/**
 * One bounded, ordered walk. Returns the rows and an honest account of what the
 * walk covered — `totalItems` comes from page 0, which is the server's own
 * statement of the collection size and the only figure a truncated walk can
 * still report exactly.
 */
async function walk<T>(
  fetchPage: (params: { Page: number; PageSize: number; OrderBy: string }) => Promise<Envelope<T>>,
  orderBy: string,
  maxPages: number,
  budget: TimeBudget
): Promise<{ rows: T[]; coverage: Coverage }> {
  let totalItems: number | null = null;

  const result = await walkWithin<T>(
    budget,
    async (page) => {
      const body = await fetchPage({ Page: page, PageSize: PAGE_SIZE, OrderBy: orderBy });
      if (page === 0 && typeof body.totalItems === "number") {
        totalItems = body.totalItems;
      }
      return { items: body.data ?? [], totalPages: body.totalPages ?? undefined };
    },
    { maxPages }
  );

  return {
    rows: result.items,
    coverage: {
      rowsExamined: result.items.length,
      pagesFetched: result.pagesFetched,
      totalPages: result.totalPages,
      totalItems,
      truncated: result.truncated,
      outOfTime: result.outOfTime,
    },
  };
}

export interface PostureOptions {
  staleDefinitionsAfterDays?: number;
  maxNamed?: number;
}

export async function getSecurityPosture(
  dc: DefenseControlModule,
  opts: PostureOptions = {}
): Promise<Record<string, unknown>> {
  const staleAfter = opts.staleDefinitionsAfterDays ?? 7;
  const maxNamed = opts.maxNamed ?? 10;
  // One clock across all three walks: the MCP client's tool-call timeout applies
  // to the call, not to a dimension, so the budget has to as well.
  const budget = startTimeBudget();
  const startedAt = budget.startedAt;

  const [blWalk, defWalk, threatWalk] = await Promise.all([
    walk<BitLockerRow>(
      (params) => dc.getBitLockerWindowsEndpoints(params) as Promise<Envelope<BitLockerRow>>,
      ORDER_BITLOCKER,
      MAX_ENDPOINT_PAGES,
      budget
    ),
    walk<DefenderRow>(
      (params) =>
        dc.getMicrosoftDefenderWindowsEndpoints(params) as Promise<Envelope<DefenderRow>>,
      ORDER_DEFENDER,
      MAX_ENDPOINT_PAGES,
      budget
    ),
    walk<Record<string, unknown>>(
      (params) =>
        dc.getMicrosoftDefenderThreats(params) as Promise<Envelope<Record<string, unknown>>>,
      ORDER_THREATS,
      MAX_THREAT_PAGES,
      budget
    ),
  ]);

  const bl = blWalk.rows;
  const def = defWalk.rows;
  const threats = threatWalk.rows;

  /**
   * The authoritative threat count. `totalItems` is the server's own statement
   * and it survives a bounded walk; `threats.length` is only what was
   * materialised. Reporting the latter is exactly the C2 defect — a server
   * saying 12,400 with an empty `data` array (finding B10) rendered as zero.
   */
  const threatTotal = threatWalk.coverage.totalItems ?? threats.length;

  // ── BitLocker ──────────────────────────────────────────────────────────────
  const unencrypted: string[] = [];
  const noTpm: string[] = [];
  const noSecureBoot: string[] = [];
  let encrypted = 0;
  let noSystemVolumeData = 0;

  for (const e of bl) {
    const vols = (e.storageMedia ?? []).flatMap((m) => m.storageVolumes ?? []);
    const withBl = vols.filter((v) => v.bitLockerVolumeData);
    const sys = withBl.find((v) => v.isSystemVolume) ?? withBl[0];
    if (!sys) {noSystemVolumeData++;}
    else if (sys.bitLockerVolumeData?.protectionStatus === "Protected") {encrypted++;}
    else {unencrypted.push(e.endpointName ?? "(unnamed)");}

    if (e.tpmData?.tpmStatus !== "Enabled") {noTpm.push(e.endpointName ?? "(unnamed)");}
    if (e.isSecureBootEnabled !== true) {noSecureBoot.push(e.endpointName ?? "(unnamed)");}
  }

  // ── Defender ───────────────────────────────────────────────────────────────
  const now = Date.now();
  const inactive: string[] = [];
  const staleDefs: Array<{ endpoint: string; definitionAgeDays: number; definitionVersion: string | null }> = [];
  let defsUnknown = 0;

  for (const e of def) {
    if (e.isMicrosoftDefenderActive !== true) {inactive.push(e.endpointName ?? "(unnamed)");}
    const av = e.microsoftDefenderState?.antivirus;
    const created = av?.definitionCreation ? new Date(av.definitionCreation).getTime() : null;
    if (!created || Number.isNaN(created)) { defsUnknown++; continue; }
    const ageDays = Math.floor((now - created) / DAY_MS);
    if (ageDays > staleAfter) {
      staleDefs.push({
        endpoint: e.endpointName ?? "(unnamed)",
        definitionAgeDays: ageDays,
        definitionVersion: av?.definitionVersion ?? null,
      });
    }
  }
  staleDefs.sort((a, b) => b.definitionAgeDays - a.definitionAgeDays);

  // ── Completeness ───────────────────────────────────────────────────────────
  //
  // Assembled before the verdict, because the verdict depends on it. Two
  // independent conditions per dimension: the walk hit its page bound, or the
  // rows absorbed fell short of the server's own `totalItems` (the exact
  // P0-NEW assertion, not a heuristic floor).
  //
  // The clock is a third condition, independent of both: a walk the time budget
  // stopped is as partial as one the page bound stopped, and the headline below
  // must not read as an estate verdict over either.
  const trust = assessResultTrust(
    truncationReason("The BitLocker endpoint listing", blWalk.coverage, "MAX_ENDPOINT_PAGES"),
    timeBudgetReason("The BitLocker endpoint listing walk", blWalk.coverage, budget),
    shortfallReason(
      "The BitLocker endpoint listing walk",
      blWalk.coverage.rowsExamined,
      blWalk.coverage.totalItems
    ),
    truncationReason("The Defender endpoint listing", defWalk.coverage, "MAX_ENDPOINT_PAGES"),
    timeBudgetReason("The Defender endpoint listing walk", defWalk.coverage, budget),
    shortfallReason(
      "The Defender endpoint listing walk",
      defWalk.coverage.rowsExamined,
      defWalk.coverage.totalItems
    ),
    truncationReason("The detected-threat listing", threatWalk.coverage, "MAX_THREAT_PAGES"),
    timeBudgetReason("The detected-threat listing walk", threatWalk.coverage, budget),
    shortfallReason(
      "The detected-threat listing walk",
      threatWalk.coverage.rowsExamined,
      threatWalk.coverage.totalItems
    )
  );
  const complete = trust.resultTrustworthy;

  // ── Verdict ────────────────────────────────────────────────────────────────
  const findings: string[] = [];
  if (unencrypted.length) {findings.push(`${unencrypted.length} of ${bl.length} endpoints examined have an unencrypted system volume`);}
  if (staleDefs.length) {findings.push(`${staleDefs.length} endpoint(s) have antivirus definitions older than ${staleAfter} days (worst: ${staleDefs[0].definitionAgeDays} days)`);}
  if (inactive.length) {findings.push(`${inactive.length} endpoint(s) report Defender inactive`);}
  if (noTpm.length) {findings.push(`${noTpm.length} endpoint(s) have no TPM enabled, so BitLocker cannot use it`);}
  if (threatTotal > 0) {findings.push(`${threatTotal} detected Defender threat(s)`);}

  /**
   * The headline over a partial read.
   *
   * This is the whole point of the C2 fix. "No posture issues found in the
   * checked dimensions." over a truncated walk is the bug; a footnote in `meta`
   * beside that sentence would still be the bug. So an incomplete read gets a
   * different first line, stating what was read out of what, and the clean
   * verdict is only reachable when the walk covered the estate.
   */
  const headline: string[] = [];
  if (!complete) {
    const parts = [
      `BitLocker ${blWalk.coverage.rowsExamined} of ${blWalk.coverage.totalItems ?? "?"} record(s)`,
      `Defender ${defWalk.coverage.rowsExamined} of ${defWalk.coverage.totalItems ?? "?"} record(s)`,
      `threats ${threatWalk.coverage.rowsExamined} of ${threatWalk.coverage.totalItems ?? "?"} row(s)`,
    ];
    headline.push(
      `INCOMPLETE READ — this is not an estate verdict. Examined ${parts.join(", ")}. ` +
        `Every count below is a floor; an endpoint absent from the named lists was not read, ` +
        `not cleared. See meta.resultTrustworthyReasons.`
    );
    headline.push(...findings);
    if (!findings.length) {
      headline.push(
        `No posture issues found in the portion that was read. This is not a statement about the estate.`
      );
    }
  } else if (findings.length) {
    headline.push(...findings);
  } else {
    headline.push("No posture issues found in the checked dimensions.");
  }

  /**
   * Say when a named list was capped, and how to lift the cap.
   *
   * ── Why this exists ─────────────────────────────────────────────────────────
   * `maxNamed` silently truncated all three named lists. This module applies
   * "nothing is dropped without saying so" rigorously to its PAGINATION —
   * `meta.coverage`, `resultTrustworthy`, a headline that changes on a partial
   * read — and did not apply it to the lists themselves.
   *
   * Measured, that omission is expensive. On the reference estate the default
   * names 10 of 19 unprotected endpoints and 10 of 17 with stale definitions. In
   * an instrumented session a model called this composite and THEN pulled
   * `list_defender_windows_endpoints` (8,236 B) and
   * `list_bitlocker_windows_endpoints` (6,337 B) — 14,573 B — to get the names
   * the cap had removed. Raising the cap enough to name every one costs
   * **735 B** (2,818 -> 3,553 B). That is a 20:1 trade, and the caller could not
   * make it because nothing said the list was short or what to do about it.
   *
   * The fix is disclosure rather than a bigger default. A default that names
   * everything is fine on 23 endpoints and ruinous on 20,000; a caller told
   * "showing 10 of 19, raise maxNamed" can decide, and a caller told
   * "showing 10 of 19,000" knows not to.
   *
   * ── Why this field is NOT named with the incompleteness suffix ──────────────
   * The first version used that suffix, and
   * `__tests__/suite-truncation-disclosure.test.ts` refused it as a sixth way of
   * saying "this answer may be incomplete". The guard was right, and the fix is
   * a rename rather than an entry in its allowlist, because this is NOT that
   * concept: `resultTrustworthy` and its siblings mean the WALK was cut and the
   * COUNTS may therefore be wrong. Here the counts are exact and complete — only
   * the illustrative list of names is capped. Borrowing the incompleteness
   * vocabulary would tell a caller the data is untrustworthy when it is not,
   * which is a worse defect than the one being fixed.
   *
   * (That guard matches on source TEXT, so even naming the rejected field in a
   * comment re-trips it. Hence the circumlocution above rather than an example.)
   */
  const namedCap = (shown: number, total: number): Record<string, unknown> =>
    shown < total
      ? {
          namedShown: shown,
          namedTotal: total,
          namedNote: `Counts above are exact. This NAME LIST is capped at maxNamed=${maxNamed}, showing ${shown} of ${total}. Raise maxNamed to name more — do not fall back to the raw list_* tools, which are far larger.`,
        }
      : {};

  return {
    query: { staleDefinitionsAfterDays: staleAfter, maxNamed },
    encryption: {
      endpointsReporting: bl.length,
      // What the server says exists, beside what was examined — the pair a
      // caller needs to tell a small estate from a short read.
      endpointsInEstate: blWalk.coverage.totalItems,
      systemVolumeProtected: encrypted,
      systemVolumeUnprotected: unencrypted.length,
      noBitLockerVolumeData: noSystemVolumeData,
      tpmNotEnabled: noTpm.length,
      secureBootDisabled: noSecureBoot.length,
      unprotectedEndpoints: unencrypted.slice(0, maxNamed),
      ...namedCap(Math.min(maxNamed, unencrypted.length), unencrypted.length),
    },
    defender: {
      endpointsReporting: def.length,
      endpointsInEstate: defWalk.coverage.totalItems,
      active: def.length - inactive.length,
      inactive: inactive.length,
      inactiveEndpoints: inactive.slice(0, maxNamed),
      definitionsStale: staleDefs.length,
      definitionAgeUnknown: defsUnknown,
      staleDefinitionEndpoints: staleDefs.slice(0, maxNamed),
      // Both named lists share one cap, so one disclosure covers whichever was
      // actually shortened — reported against the longer of the two.
      ...namedCap(
        Math.min(maxNamed, Math.max(inactive.length, staleDefs.length)),
        Math.max(inactive.length, staleDefs.length)
      ),
    },
    threats: {
      // The envelope's own count, so this is exact even when `rowsExamined` is
      // bounded and even when the API returns a nonzero total with an empty
      // body (finding B10).
      total: threatTotal,
      rowsExamined: threats.length,
      // Named separately because a zero here is easy to over-read: it means no
      // threat was DETECTED, not that the estate is clean — see stale
      // definitions above.
      note:
        threatTotal === 0
          ? "No detected threats. Read alongside definition age — endpoints with stale signatures may simply not be detecting."
          : threats.length < threatTotal
            ? `${threatTotal} detected threat(s) reported by the server; ${threats.length} row(s) were read ` +
              `(ordered "${ORDER_THREATS}", so the most severe were read first). The total is exact; the ` +
              `rows behind it are a sample.`
            : "Detected threats present.",
    },
    headline,
    meta: {
      // An estate-wide aggregate, so it owes the scope disclosure. See
      // result-trust.ts. This is the sharpest measured case in the set: under a
      // scoped key `tpmNotEnabled` fell 10 -> 0 and `noBitLockerVolumeData`
      // 4 -> 0, so "how secure are we" is answered "zero machines lack TPM"
      // beside `resultTrustworthy: true`. A ZERO here is not a clean bill.
      credentialScope: CREDENTIAL_SCOPE_NOTE,
      elapsedMs: Date.now() - startedAt,
      // What the walks were allowed and what they used, reported whether or not
      // the budget bit, so a caller can see a call approaching its ceiling
      // before it starts returning partial dimensions.
      timeBudget: {
        budgetMs: budget.totalMs,
        elapsedMs: budget.elapsedMs(),
        envVar: BUDGET_ENV,
      },
      dimensionsChecked: ["BitLocker encryption", "TPM", "Secure Boot", "Defender activity", "AV definition age", "detected threats"],
      // What each walk actually covered. `pagesFetched` on its own is the number
      // a reader cannot tell apart from "the collection was that long", so it is
      // never reported without `totalPages` beside it.
      coverage: {
        bitlocker: { ...blWalk.coverage, orderBy: ORDER_BITLOCKER, maxPages: MAX_ENDPOINT_PAGES },
        defender: { ...defWalk.coverage, orderBy: ORDER_DEFENDER, maxPages: MAX_ENDPOINT_PAGES },
        threats: { ...threatWalk.coverage, orderBy: ORDER_THREATS, maxPages: MAX_THREAT_PAGES },
      },
      ...trust,
      note: "Counts reflect each endpoint's last check-in, so a stale endpoint's posture data is as old as its last contact.",
    },
  };
}
