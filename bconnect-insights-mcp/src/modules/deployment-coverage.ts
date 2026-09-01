/**
 * get_deployment_coverage — "I deployed this. Did it actually land?"
 *
 * ── The question, and what it costs by hand ─────────────────────────────────
 * Measured live 2026-08-13: **113,389 B across 3 calls in 2 servers** — the
 * largest hand-walk ever measured in this project, 4.8x the 23,738 B walk that
 * justified `get_endpoint_briefing`. Almost all of it is
 * `list_installed_software_by_logical_group`, which returns EVERY product on
 * EVERY endpoint in the group (242 rows on a 9-endpoint group here) so the
 * caller can work out for themselves who is missing what.
 *
 * The answer is small: which members have the bundle's applications and which
 * do not. Nothing in the suite performs that join — `list_software_bundles`
 * says what should be there, `list_installed_software_by_*` says what is, and
 * the comparison is left to whoever is reading 100 KB.
 *
 * ── The join key, which is NOT the name ─────────────────────────────────────
 * Both sides carry `applicationId`, and that is what this joins on. Name
 * matching would be actively wrong here: measured on this estate, a bundle's
 * `applicationVersion` is EMPTY (""), so a name+version match finds nothing and
 * a name-only match would collide across vendors. The same lesson the jobs
 * server learned identifying patch jobs by `steps[].type` rather than by name.
 *
 * ── What an absent row means, and the correction that got us here ───────────
 * The bMS software inventory is a SNAPSHOT, and that was verified rather than
 * assumed (2026-08-13, estate-wide): `lastFound` is a RE-CONFIRMATION stamp,
 * not an install date — 180 rows carry a `lastFound` later than `installed`, by
 * up to 1,058 days — and per endpoint every row shares ONE `lastFound` (spread
 * 0.0 h across 55-104 rows). Each scan rewrites the timestamp on everything
 * still present.
 *
 * So on an endpoint that has ever been inventoried:
 *   a row present  => installed AS OF that scan
 *   a row absent   => NOT installed AS OF that scan
 * Both are facts. Both carry the same date.
 *
 * **An earlier version of this file voided the second one.** It required the
 * inventory to be newer than `inventoryStaleAfterDays` before it would say
 * "missing", and reported UNKNOWN otherwise. That was wrong, and the owner's
 * challenge is what corrected it:
 *
 *   - Any such threshold is arbitrary *because the data is always historical*.
 *     A one-day-old inventory is not "true now" either, only less stale.
 *     Drawing a line implies the fresh side is current, which it is not.
 *   - It DISCARDED a real fact. "Nothing on this machine matched, as of its
 *     last scan" is information; replacing it with "undetermined" is strictly
 *     less than the estate actually knows.
 *   - The danger direction runs the other way here. This project's rule is that
 *     a missing fact must never read as a GOOD fact — and `notInstalled` is a
 *     bad fact. Reporting it from an old snapshot risks a false ALARM, which
 *     prompts a look; the forbidden move would be claiming INSTALLED without
 *     evidence, and an absent row can never do that.
 *
 * What survives from that version, because the owner's challenge kept it too:
 * an endpoint with NO inventory rows at all has no snapshot to read, so it is
 * `neverInventoried` and genuinely unknown. That is a different state from
 * "we looked and it was not there", and the two are never combined.
 *
 * So every endpoint lands in one of three states:
 *   INSTALLED          a row for that applicationId exists, as of `inventoryAsOf`.
 *   NOT INSTALLED      the endpoint has an inventory and this app is not in it,
 *                      as of `inventoryAsOf`.
 *   NEVER INVENTORIED  no software rows at all; nothing has ever looked.
 *
 * The age of the snapshot is reported prominently beside every verdict and
 * counted in `coverage.answersOlderThanDays`, because "not installed" and "not
 * installed as of 359 days ago" are different claims to act on — but it never
 * changes the verdict.
 *
 * ── Deliberately NOT harmonised with `get_patch_readiness` ──────────────────
 * That tool DOES gate its Microsoft-update counts on inventory age, and should
 * keep doing so. The signal there is different in both direction and origin:
 * bMS itself emits `updateState: "InventoryOutdated"` — the server declaring
 * its own count untrustworthy, rather than us inventing a threshold — and a
 * stale ZERO there reads as a false ALL-CLEAR, the dangerous direction. Do not
 * "fix" the inconsistency between these two tools; it is load-bearing.
 */

import { CREDENTIAL_SCOPE_NOTE, sanitizeEstateText, daysSince, shortfallReason, notOverloaded404 } from "@bconnect/mcp-core";
import { readRows, isUnavailable, str, type HttpLike, type DimensionUnavailable } from "./paged-read.js";

export interface DeploymentCoverageOptions {
  /** The bundle whose applications should be present. */
  bundleId: string;
  /** The logical group the bundle was deployed to. */
  logicalGroupId: string;
  /** Inventory older than this many days cannot support a "missing" verdict. */
  inventoryStaleAfterDays?: number;
  /** An endpoint not seen within this many days is flagged unreachable. */
  reachableWithinDays?: number;
  maxNamed?: number;
  pageSize?: number;
  now?: () => number;
}

const DEFAULTS = {
  inventoryStaleAfterDays: 30,
  // Matches compliance/unpatched.ts's DEFAULT_REACHABLE_WITHIN_DAYS, and for
  // the same reason: one day is a lab assumption, seven spans a weekend.
  reachableWithinDays: 7,
  maxNamed: 10,
  pageSize: 1000,
};

/**
 * Per-endpoint verdict for one application.
 *
 * `notInstalled` is a dated fact, not a guess: the endpoint has an inventory
 * snapshot and this application is not in it. `neverInventoried` is the only
 * genuine unknown — no snapshot exists to read.
 */
type Verdict = "installed" | "notInstalled" | "neverInventoried";

interface EndpointRow {
  id?: unknown;
  displayName?: unknown;
  lastSeen?: unknown;
}

interface InstalledRow {
  applicationId?: unknown;
  name?: unknown;
  version?: unknown;
  vendor?: unknown;
  installed?: unknown;
  lastFound?: unknown;
  endpointId?: unknown;
  endpointName?: unknown;
}

interface BundleAppRow {
  applicationId?: unknown;
  applicationName?: unknown;
  applicationVendor?: unknown;
  applicationVersion?: unknown;
}

export interface DeploymentCoverage {
  query: Record<string, unknown>;
  headline: string[];
  bundle: Record<string, unknown> | DimensionUnavailable;
  coverage: Record<string, unknown> | null;
  applications: Array<Record<string, unknown>>;
  endpoints: Array<Record<string, unknown>>;
  meta: Record<string, unknown>;
}

export async function buildDeploymentCoverage(
  http: HttpLike,
  options: DeploymentCoverageOptions,
): Promise<DeploymentCoverage> {
  // Field by field, never a spread: the dispatch arm passes `args?.x`, so an
  // omitted argument arrives as an explicit undefined and a spread would
  // overwrite the default with it. That bug shipped once in estate-risk.ts.
  const o = {
    inventoryStaleAfterDays: options.inventoryStaleAfterDays ?? DEFAULTS.inventoryStaleAfterDays,
    reachableWithinDays: options.reachableWithinDays ?? DEFAULTS.reachableWithinDays,
    maxNamed: options.maxNamed ?? DEFAULTS.maxNamed,
    pageSize: options.pageSize ?? DEFAULTS.pageSize,
  };
  const now = (options.now ?? Date.now)();

  // These three sit in ONE statement, which is exactly why the 404 declaration
  // is an argument to each read rather than something the audit infers from
  // scope: anything statement-shaped would let one of them speak for all three.
  // See paged-read.ts's header.
  const [appsRaw, membersRaw, installedRaw] = await Promise.all([
    // Undeclared on purpose. This estate holds ONE bundle, so the route has
    // never been observed answering for a bundle with no applications and its
    // 404 is unmeasured. It stays on UNDECLARED_SUB_RESOURCE_READS.
    readRows(http, `/software/v2.0/Bundles/${options.bundleId}/BundleApplications`, 200),
    readRows(
      http,
      `/endpoints/v2.0/LogicalGroups/${options.logicalGroupId}/Endpoints`,
      o.pageSize,
      notOverloaded404(
        "Measured 2026-08-14: 19 of 19 logical groups answer 200 (13 with totalItems 0); a nonexistent id answers 404.",
      ),
    ),
    readRows(
      http,
      `/software/v2.0/LogicalGroups/${options.logicalGroupId}/InstalledWindowsSoftware`,
      o.pageSize,
      notOverloaded404(
        "Measured 2026-08-14: 19 of 19 logical groups answer 200 (15 with totalItems 0); a nonexistent id answers 404.",
      ),
    ),
  ]);

  const headline: string[] = [];
  const trustReasons: string[] = [];

  // A read that failed outright takes the whole answer with it: coverage over
  // an unknown membership, or against an unknown application set, is not a
  // partial answer — it is a different question.
  const unread: string[] = [];
  if (isUnavailable(appsRaw)) {unread.push(`bundle applications: ${appsRaw.reason}`);}
  if (isUnavailable(membersRaw)) {unread.push(`group members: ${membersRaw.reason}`);}
  if (isUnavailable(installedRaw)) {unread.push(`installed software: ${installedRaw.reason}`);}
  if (unread.length) {
    return {
      query: { ...options, ...o },
      headline: [
        `Cannot report coverage: ${unread.length} of 3 required reads failed (${unread.join("; ")}). ` +
          `This is NOT a report of zero coverage.`,
      ],
      bundle: isUnavailable(appsRaw) ? appsRaw : { available: true as const },
      coverage: null,
      applications: [],
      endpoints: [],
      meta: {
        // Disclosed on the REFUSAL path too. This arm returns coverage: null
        // and a headline ending "This is NOT a report of zero coverage", and a
        // caller told the join did not happen still needs to know the group it
        // would have been over is the one this key can see.
        credentialScope: CREDENTIAL_SCOPE_NOTE,
        resultTrustworthy: false,
        resultTrustworthyReasons: unread,
        note: "No join was performed, so nothing below describes the estate.",
      },
    };
  }

  // The early return above proves all three are pages, but the narrowing does
  // not survive into the tuple below, so it is restated once here rather than
  // asserted at each use.
  const apps = appsRaw as Exclude<typeof appsRaw, DimensionUnavailable>;
  const membersPage = membersRaw as Exclude<typeof membersRaw, DimensionUnavailable>;
  const installed = installedRaw as Exclude<typeof installedRaw, DimensionUnavailable>;

  // Short-served reads are the live-measured empty-page state. Here it is
  // especially dangerous: a short member list SHRINKS THE DENOMINATOR, so
  // coverage would read BETTER than reality — a deployment-verification tool
  // reporting success it never measured.
  for (const [what, raw] of [
    ["The bundle-application read", apps],
    ["The group-member read", membersPage],
    ["The installed-software read", installed],
  ] as const) {
    const reason = raw.truncated ? null : shortfallReason(what, raw.rows.length, raw.totalItems);
    if (reason) {trustReasons.push(reason);}
    if (raw.truncated) {
      trustReasons.push(
        `${what} returned only ${raw.rows.length} of ${raw.totalItems} row(s) — raise pageSize; ` +
          `coverage computed over a partial read overstates it.`,
      );
    }
  }

  const bundleApps = (apps.rows as BundleAppRow[]).filter((a) => str(a.applicationId));
  const members = (membersPage.rows as EndpointRow[]).filter((m) => str(m.id));

  // ── Inventory evidence per endpoint ────────────────────────────────────────
  // Derived from the software rows themselves (`lastFound` is when the scanner
  // last confirmed a product), NOT from the endpoint's `lastSeen`: an endpoint
  // can be checking in while its software inventory is months old, and it is
  // the inventory that decides whether an absence means anything.
  const installedByEndpoint = new Map<string, Map<string, InstalledRow>>();
  const inventoryAgeByEndpoint = new Map<string, number | null>();
  const inventoryAsOfByEndpoint = new Map<string, string | null>();
  for (const row of installed.rows as InstalledRow[]) {
    const epId = str(row.endpointId);
    const appId = str(row.applicationId);
    if (!epId) {continue;}
    if (!installedByEndpoint.has(epId)) {installedByEndpoint.set(epId, new Map());}
    if (appId) {installedByEndpoint.get(epId)!.set(appId.toLowerCase(), row);}
    // Newest `lastFound` on the endpoint IS the scan date — verified snapshot
    // semantics, so in practice every row carries the same one.
    const age = daysSince(row.lastFound ?? row.installed, now);
    if (age !== null) {
      const cur = inventoryAgeByEndpoint.get(epId);
      if (cur === undefined || cur === null || age < cur) {
        inventoryAgeByEndpoint.set(epId, age);
        inventoryAsOfByEndpoint.set(epId, str(row.lastFound) ?? str(row.installed));
      }
    } else if (!inventoryAgeByEndpoint.has(epId)) {
      inventoryAgeByEndpoint.set(epId, null);
      inventoryAsOfByEndpoint.set(epId, null);
    }
  }

  // ── The join ───────────────────────────────────────────────────────────────
  const perApp = new Map<string, { installed: string[]; notInstalled: string[]; neverInventoried: string[] }>();
  for (const a of bundleApps) {perApp.set(str(a.applicationId)!.toLowerCase(), { installed: [], notInstalled: [], neverInventoried: [] });}

  const endpointRows: Array<Record<string, unknown>> = [];
  let fullyCovered = 0, partly = 0, noneInstalled = 0, neverInventoried = 0, answersStale = 0;

  for (const m of members) {
    const epId = str(m.id)!;
    const name = sanitizeEstateText(str(m.displayName) ?? "(unnamed)");
    const installedHere = installedByEndpoint.get(epId) ?? new Map<string, InstalledRow>();
    const inventoryAge = inventoryAgeByEndpoint.get(epId) ?? null;
    // The ONLY genuine unknown: no snapshot exists on this endpoint, so there
    // is nothing to read an absence against. Age does not enter this decision —
    // see the header for why a staleness threshold was removed.
    const hasInventory = installedHere.size > 0;
    const answerIsOld = hasInventory && inventoryAge !== null && inventoryAge > o.inventoryStaleAfterDays;
    if (answerIsOld) {answersStale++;}
    const daysSinceSeen = daysSince(m.lastSeen, now);
    const reachable = daysSinceSeen !== null && daysSinceSeen <= o.reachableWithinDays;

    const verdicts: Record<string, Verdict> = {};
    let nInstalled = 0, nNot = 0, nNever = 0;
    for (const a of bundleApps) {
      const appId = str(a.applicationId)!.toLowerCase();
      const hit = installedHere.get(appId);
      const v: Verdict = hit ? "installed" : hasInventory ? "notInstalled" : "neverInventoried";
      verdicts[sanitizeEstateText(str(a.applicationName) ?? appId)] = v;
      perApp.get(appId)![v].push(name);
      if (v === "installed") {nInstalled++;} else if (v === "notInstalled") {nNot++;} else {nNever++;}
    }

    // ── An empty bundle classifies nobody ─────────────────────────────────
    // `nInstalled === bundleApps.length` is 0 === 0 when the bundle has no
    // applications, so every member counted as FULLY COVERED — an all-clear
    // over a question nobody asked. The arm below it already carried an
    // explicit `> 0`, which is what marks this as an oversight rather than a
    // decision: the empty case was considered for one verdict and not its
    // neighbour.
    //
    // Skipped rather than redirected. Sending these members to `noneInstalled`
    // would swap one wrong answer for another — "none of the applications are
    // installed" is a finding, and "there are no applications" is not. All four
    // counters stay 0, `applicationCount: 0` states the cause, and the headline
    // says there was nothing to verify.
    if (bundleApps.length === 0) {
      // no verdict
    }
    else if (nNever === bundleApps.length) {neverInventoried++;}
    else if (nInstalled === bundleApps.length) {fullyCovered++;}
    else if (nInstalled > 0) {partly++;}
    else {noneInstalled++;}

    endpointRows.push({
      endpoint: name,
      endpointId: epId,
      installed: nInstalled,
      notInstalled: nNot,
      neverInventoried: nNever,
      verdicts,
      // The as-of date sits beside the verdict, not in meta: "not installed"
      // and "not installed as of 359 days ago" are different claims to act on.
      inventoryAsOf: inventoryAsOfByEndpoint.get(epId) ?? null,
      inventoryAgeDays: inventoryAge,
      inventoryEvidence: hasInventory
        ? answerIsOld
          ? `snapshot is ${inventoryAge} days old — the verdict is as of then, not today`
          : "current snapshot"
        : "none — this endpoint has never reported software, so nothing is known",
      daysSinceSeen,
      reachable,
    });
  }

  // Worst first: never-inventoried leads, because an endpoint nothing has ever
  // looked at is the one a reader must fix to make the rest meaningful; then
  // the endpoints actually lacking the software.
  endpointRows.sort((a, b) => (b.neverInventoried as number) - (a.neverInventoried as number) || (b.notInstalled as number) - (a.notInstalled as number));

  const applications = bundleApps.map((a) => {
    const appId = str(a.applicationId)!.toLowerCase();
    const p = perApp.get(appId)!;
    return {
      application: sanitizeEstateText(str(a.applicationName) ?? "(unnamed)"),
      applicationId: str(a.applicationId),
      vendor: sanitizeEstateText(str(a.applicationVendor) ?? ""),
      // Empty on this estate, and stated as such rather than omitted: a caller
      // must not read absence here as "any version will do".
      bundleVersion: str(a.applicationVersion),
      installedOn: p.installed.length,
      notInstalledOn: p.notInstalled.length,
      neverInventoriedOn: p.neverInventoried.length,
      // NOT `.map(sanitizeEstateText)`. Array.map passes the INDEX as the second
      // argument and `sanitizeEstateText(value, max)` reads it as a length cap,
      // so index 0 truncated the first name to a single ellipsis. Caught by the
      // test that asserts the named endpoint rather than just the count — these
      // names are already sanitised where they are collected, so there is
      // nothing to re-apply.
      notInstalledEndpoints: p.notInstalled.slice(0, o.maxNamed),
      neverInventoriedEndpoints: p.neverInventoried.slice(0, o.maxNamed),
      namedNote:
        p.notInstalled.length > o.maxNamed || p.neverInventoried.length > o.maxNamed
          ? `Counts are exact; name lists are capped at maxNamed=${o.maxNamed}.`
          : undefined,
    };
  });

  // ── Headline ───────────────────────────────────────────────────────────────
  if (bundleApps.length === 0) {
    headline.push("This bundle contains no applications, so there is nothing to verify.");
  } else {
    headline.push(
      `${fullyCovered} of ${members.length} member(s) have all ${bundleApps.length} bundle ` +
        `application(s); ${partly} partial, ${noneInstalled} have none of them.`,
    );
  }
  if (neverInventoried > 0) {
    headline.push(
      `${neverInventoried} member(s) have NEVER reported software inventory, so nothing is known ` +
        `about them either way. They are counted separately and never as "not installed".`,
    );
  }
  if (answersStale > 0) {
    headline.push(
      `${answersStale} member(s) answer from a software inventory older than ` +
        `${o.inventoryStaleAfterDays} days — those verdicts describe what was true at the last scan, ` +
        `not today. Read each endpoint's inventoryAsOf before acting.`,
    );
  }
  const unreachable = endpointRows.filter((r) => !r.reachable).length;
  if (unreachable > 0) {
    headline.push(
      `${unreachable} member(s) have not checked in within ${o.reachableWithinDays} day(s), so a ` +
        `redeployment aimed at them would queue rather than run.`,
    );
  }
  if (trustReasons.length) {
    headline.unshift(
      `INCOMPLETE: a required read returned fewer rows than the server reported, so the ` +
        `denominator may be short and coverage below OVERSTATES reality. ${trustReasons.join(" ")}`,
    );
  }

  return {
    query: {
      bundleId: options.bundleId,
      logicalGroupId: options.logicalGroupId,
      inventoryStaleAfterDays: o.inventoryStaleAfterDays,
      reachableWithinDays: o.reachableWithinDays,
      maxNamed: o.maxNamed,
      pageSize: o.pageSize,
    },
    headline,
    bundle: {
      available: true as const,
      bundleId: options.bundleId,
      applicationCount: bundleApps.length,
    },
    coverage: {
      membersInGroup: membersPage.totalItems ?? members.length,
      membersExamined: members.length,
      allApplicationsPresent: fullyCovered,
      partiallyPresent: partly,
      noneInstalled,
      // Never counted as "not installed": no snapshot exists to read.
      neverInventoried,
      // A qualifier on the answers above, NOT a subtraction from them: these
      // endpoints answered, from a snapshot older than inventoryStaleAfterDays.
      answersOlderThanThreshold: answersStale,
      unreachable,
    },
    applications,
    endpoints: endpointRows.slice(0, o.maxNamed),
    meta: {
      // The group membership this coverage is computed over is itself scoped —
      // measured, LogicalGroups 19 -> 1 and this group's membersInGroup 11 -> 9,
      // so "0 of 11 members have the bundle" became "0 of 9". The denominator
      // moved, which is the one number a coverage percentage cannot survive.
      credentialScope: CREDENTIAL_SCOPE_NOTE,
      resultTrustworthy: trustReasons.length === 0,
      resultTrustworthyReasons: trustReasons,
      installedRowsExamined: installed.rows.length,
      installedRowsInEstate: installed.totalItems,
      joinedOn:
        "applicationId, not name. A bundle's applicationVersion is empty on this estate, so a " +
        "name+version match finds nothing and a name-only match collides across vendors.",
      note:
        "The bMS software inventory is a snapshot: a scan rewrites lastFound on every product still " +
        "present, so on an endpoint that has an inventory, an absent row means NOT INSTALLED as of " +
        "that scan — a dated fact, not a guess. inventoryStaleAfterDays does NOT change any verdict; " +
        "it only counts how many answers come from an old snapshot, and every endpoint carries its " +
        "own inventoryAsOf. The single genuine unknown is neverInventoried: no snapshot exists, so " +
        "nothing is known either way, and it is never counted as not-installed.",
    },
  };
}
