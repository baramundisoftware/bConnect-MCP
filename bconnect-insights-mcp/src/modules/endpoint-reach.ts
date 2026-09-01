/**
 * get_endpoint_reach — "what reaches this endpoint, and why does it get things?"
 *
 * ── The question, and why it is not answerable by hand ──────────────────────
 * bConnect has NO endpoint -> groups direction. Verified live 2026-08-13, every
 * candidate reverse route answers 404:
 *   /endpoints/v2.0/Endpoints/{id}/LogicalGroups | /StaticGroups | /DynamicGroups
 *   /endpoints/v2.0/Endpoints/{id}/Groups
 *   /endpoints/v2.0/WindowsEndpoints/{id}/LogicalGroups
 *   /universaldynamicgroups/v2.0/Endpoints/{id}/UniversalDynamicGroups
 *
 * Membership only runs group -> endpoints. So "which dynamic groups is this
 * machine in" costs one membership read PER GROUP, and each read returns the
 * group's whole membership. Measured on this estate: **56 calls, 436,124 B,
 * 790 ms** to discover that one endpoint is in 15 of 55 groups. The answer is
 * ~390 B. That is the largest ratio measured anywhere in this project, and it
 * is not a walk a model would ever actually make — it would spot-check a few
 * groups and guess.
 *
 * ── What is free, and therefore not fetched ─────────────────────────────────
 * The LOGICAL group is already on the endpoint record (`logicalGroupId` /
 * `logicalGroup`), so it costs nothing and is reported without a call. STATIC
 * and DYNAMIC groups cannot be enumerated at all — `/endpoints/v2.0/StaticGroups`
 * and `/DynamicGroups` both 404 — so neither this tool nor any other can list
 * them, and `meta.notCovered` says so rather than leaving a silent hole.
 *
 * ── The gate that matters when you make 55 reads ────────────────────────────
 * Any one of those membership reads can fail or come back short. A group whose
 * membership could not be read is NOT evidence that the endpoint is outside it.
 * Absence of a hit is only meaningful for groups that were actually checked, so
 * every unread group is counted and named, `resultTrustworthy` drops, and the
 * headline says the reach list is a FLOOR. Reporting "in 15 groups" after 40 of
 * 55 reads failed would be the same defect this suite has spent its history
 * removing, at a larger scale than usual.
 *
 * ── The snapshot caveat, inherited from preview_assignment ──────────────────
 * Universal dynamic group membership is evaluated server-side from a rule
 * rather than stored, so this is a SNAPSHOT: the set can change between this
 * call and any action taken on it, without anyone editing a group.
 */

import { sanitizeEstateText, daysSince, shortfallReason, notOverloaded404 } from "@bconnect/mcp-core";
import { readOne, readRows, isUnavailable, str, type HttpLike } from "./paged-read.js";

export interface EndpointReachOptions {
  endpointId: string;
  /** Hard ceiling on membership reads. Protects an estate with many groups. */
  maxGroupsChecked?: number;
  /** Wall-clock budget; groups not reached by then are reported unchecked. */
  budgetMs?: number;
  maxNamed?: number;
  pageSize?: number;
  now?: () => number;
}

const DEFAULTS = {
  // 200 membership reads at ~14 ms is ~3 s, which is the most this should ever
  // spend. Past it the answer is bounded and says so rather than running on.
  maxGroupsChecked: 200,
  budgetMs: 20_000,
  maxNamed: 25,
  pageSize: 1000,
};

interface GroupRow { id?: unknown; name?: unknown }

export interface EndpointReach {
  query: Record<string, unknown>;
  headline: string[];
  endpoint: Record<string, unknown> | null;
  reach: Record<string, unknown>;
  assigned: Record<string, unknown>;
  meta: Record<string, unknown>;
}

export async function buildEndpointReach(
  http: HttpLike,
  options: EndpointReachOptions,
): Promise<EndpointReach> {
  const o = {
    maxGroupsChecked: options.maxGroupsChecked ?? DEFAULTS.maxGroupsChecked,
    budgetMs: options.budgetMs ?? DEFAULTS.budgetMs,
    maxNamed: options.maxNamed ?? DEFAULTS.maxNamed,
    pageSize: options.pageSize ?? DEFAULTS.pageSize,
  };
  const clock = options.now ?? Date.now;
  const now = clock();
  const started = now;

  const headline: string[] = [];
  const trustReasons: string[] = [];

  // The typed route, for the same reason endpoint-briefing uses it: the untyped
  // one is a strict subset and omits health fields.
  const epRaw = await readOne(http, `/endpoints/v2.0/WindowsEndpoints/${options.endpointId}`);
  if (isUnavailable(epRaw)) {
    return {
      query: { endpointId: options.endpointId, ...o },
      headline: [`Cannot report reach: ${epRaw.reason}`],
      endpoint: null,
      reach: {},
      assigned: {},
      meta: { resultTrustworthy: false, resultTrustworthyReasons: [epRaw.reason] },
    };
  }

  const epName = sanitizeEstateText(str(epRaw.displayName) ?? "(unnamed)");
  const daysSinceSeen = daysSince(epRaw.lastSeen, now);

  // ── Universal dynamic groups: the reverse lookup, bounded ─────────────────
  const udgList = await readRows(http, "/universaldynamicgroups/v2.0/UniversalDynamicGroups", o.pageSize);
  const memberOf: string[] = [];
  const unchecked: string[] = [];
  let groupsChecked = 0;

  if (isUnavailable(udgList)) {
    trustReasons.push(`The universal-dynamic-group listing could not be read: ${udgList.reason}`);
  } else {
    const shortfall = udgList.truncated
      ? `The universal-dynamic-group listing returned ${udgList.rows.length} of ${udgList.totalItems} group(s).`
      : shortfallReason("The universal-dynamic-group listing", udgList.rows.length, udgList.totalItems);
    if (shortfall) {trustReasons.push(shortfall);}

    const groups = (udgList.rows as GroupRow[]).filter((g) => str(g.id));
    // Lowercased ONCE, and the row side lowercased at the compare: bMS accepts a
    // GUID in either case on every PATH — the typed endpoint route, jobs and
    // kiosk all answered 200 to an uppercase id — but emits row ids in
    // lowercase. A case-sensitive compare here made the same machine answer
    // "in 19 of 55 groups" to its lowercase id and "in 0 of 55 groups" to its
    // uppercase one, resultTrustworthy true both times (measured live
    // 2026-08-22). PowerShell prints GUIDs uppercase, so the input occurs.
    const wantedId = options.endpointId.toLowerCase();
    for (const grp of groups) {
      const outOfBudget = clock() - started > o.budgetMs;
      if (groupsChecked >= o.maxGroupsChecked || outOfBudget) {
        unchecked.push(sanitizeEstateText(str(grp.name) ?? "(unnamed)"));
        continue;
      }
      // Membership lives under the ENDPOINTS module, not the UDG one — the UDG
      // server's own /{id}/Endpoints answers 404. preview_assignment reads it
      // from the same place.
      const members = await readRows(
        http, `/endpoints/v2.0/UniversalDynamicGroups/${str(grp.id)}/Endpoints`, o.pageSize,
        notOverloaded404(
          "Measured 2026-08-14: 55 of 55 universal dynamic groups answer 200 (15 with totalItems 0); a nonexistent id answers 404.",
        ),
      );
      groupsChecked++;
      if (isUnavailable(members)) {
        // A group we could not read is NOT a group the endpoint is outside of.
        unchecked.push(sanitizeEstateText(str(grp.name) ?? "(unnamed)"));
        continue;
      }
      if (members.truncated) {
        // Same rule: a short membership page cannot prove absence.
        unchecked.push(sanitizeEstateText(str(grp.name) ?? "(unnamed)"));
        continue;
      }
      const hit = members.rows.some(
        (r) => String((r as { id?: unknown }).id).toLowerCase() === wantedId,
      );
      if (hit) {memberOf.push(sanitizeEstateText(str(grp.name) ?? "(unnamed)"));}
    }
  }

  if (unchecked.length) {
    trustReasons.push(
      `${unchecked.length} universal dynamic group(s) could not be checked (unreadable, short-served, ` +
        `or past maxGroupsChecked=${o.maxGroupsChecked}/budgetMs=${o.budgetMs}). The endpoint may be in ` +
        `any of them.`,
    );
  }

  // ── What is actually assigned, in summary ─────────────────────────────────
  const jobs = await readRows(
    http,
    `/jobs/v2.0/Endpoints/${options.endpointId}/JobInstances`,
    o.pageSize,
    notOverloaded404(
      "Measured 2026-08-14: 26 of 26 endpoints answer 200 (2 with totalItems 0); a nonexistent id answers 404.",
    ),
  );
  // Undeclared on purpose: every one of the 26 endpoints probed had kiosk
  // releases, so no childless parent was available and this route's 404 has
  // never been produced. It stays on UNDECLARED_SUB_RESOURCE_READS.
  const kiosk = await readRows(http, `/jobs/v2.0/Endpoints/${options.endpointId}/KioskReleases`, o.pageSize);

  const jobNames = isUnavailable(jobs)
    ? []
    : [...new Set(jobs.rows.map((r) => sanitizeEstateText(str((r as { jobDefinitionName?: unknown }).jobDefinitionName) ?? "(unnamed)")))];
  const failingNow = isUnavailable(jobs)
    ? 0
    : jobs.rows.filter((r) => /error|fail|abort/i.test(String((r as { state?: unknown }).state ?? ""))).length;

  // ── Trust accounting for the two reads that had none ──────────────────────
  // `jobs` was checked for `isUnavailable` and nothing else, so a short-served
  // page produced `currentlyFailing: 0` — a count over rows the server never
  // sent — published under `resultTrustworthy: true`. The routine trigger is an
  // endpoint with more instances than `pageSize`.
  //
  // Deliberately NOT the `truncated ? … : shortfallReason(…)` shape the group
  // listing above uses. Those two are the SAME predicate — `truncated` is
  // `totalItems !== null && totalItems > rows.length` (paged-read.ts) and
  // `shortfallReason` returns non-null on exactly that condition — so the else
  // arm there is unreachable. Copying it would have read as two conditions
  // covered while only one can ever fire. (The dead arm at the group listing is
  // pre-existing and left alone; this is not the commit to churn it.)
  if (isUnavailable(jobs)) {
    trustReasons.push(`Assigned jobs could not be read: ${jobs.reason}`);
  } else if (jobs.truncated) {
    trustReasons.push(
      `The assigned-jobs read returned ${jobs.rows.length} of ${jobs.totalItems} job instance(s), ` +
        `so the definition list and failure count are computed over what was served, not over all of them.`,
    );
  }

  // Kiosk gets the unavailable arm ONLY, and that asymmetry is the point.
  // Previously it had no accounting at all, so a 403 became `kioskReleases:
  // null` beside `resultTrustworthy: true` — "none" indistinguishable from "not
  // allowed to look". But a TRUNCATED kiosk read costs this tool nothing: the
  // only kiosk-derived output is the server's own `totalItems`, and the rows are
  // never read. Dropping trust for it would be a false alarm on a number that is
  // exactly right — the carriage-return marker mistake in a new place. Jobs is
  // different precisely because `jobNames` and `failingNow` ARE row-derived.
  if (isUnavailable(kiosk)) {
    trustReasons.push(`Kiosk releases could not be read: ${kiosk.reason}`);
  }

  // ── Headline ──────────────────────────────────────────────────────────────
  headline.push(
    `${epName} is in logical group "${sanitizeEstateText(str(epRaw.logicalGroup) ?? "(none)")}" and ` +
      `${memberOf.length} universal dynamic group(s) of ${groupsChecked} checked.`,
  );
  // ── The group picture is a FLOOR for three reasons, not one ───────────────
  // `unchecked` only ever holds groups that were LISTED and then not read. It
  // is structurally blind to the two ways the listing itself falls short, and
  // both used to produce a clean-reading headline over a failed read:
  //   - the listing was unavailable: `unchecked` stays empty, so this said
  //     nothing, and "in 0 group(s) of 0 checked" reads as a finding;
  //   - the listing was short-served: the groups never listed cannot enter
  //     `unchecked` either, so "of 3 checked" was published while 52 more
  //     existed that this tool never saw.
  // The trust reasons for both already existed above; only the headline — the
  // part a model actually summarises — was silent.
  if (isUnavailable(udgList)) {
    headline.unshift(
      `INCOMPLETE: the universal-dynamic-group listing could not be read, so NO membership was checked. ` +
        `"0 group(s)" below means nothing was looked at, never that this endpoint is in none.`,
    );
  } else if (unchecked.length || udgList.truncated) {
    const neverListed = udgList.truncated ? (udgList.totalItems as number) - udgList.rows.length : 0;
    headline.unshift(
      `INCOMPLETE: ${unchecked.length} group(s) could not be checked` +
        (neverListed ? ` and ${neverListed} more were never listed` : "") +
        `, so the reach list below is a FLOOR. An unchecked group is not evidence this endpoint is ` +
        `outside it.`,
    );
  }
  if (isUnavailable(jobs)) {
    // The severe case must not be quieter than the mild one. A 403 here used to
    // say nothing in the headline at all while a short serve shouted, so a
    // reader saw no job line and had no reason to wonder why.
    headline.push(`Assigned jobs could not be read, so nothing here describes what runs on this endpoint.`);
  } else {
    headline.push(
      `${jobs.totalItems ?? jobs.rows.length} job instance(s) are assigned across ` +
        `${jobNames.length} definition(s)` + (failingNow ? `, ${failingNow} currently in a failed state.` : "."),
    );
    // `push`, NOT `unshift`. This is a REACH tool: headline[0] is the group
    // verdict, and four sibling suites pin headline[0] as the single verdict
    // line. Promoting a caveat about the jobs SUMMARY above the tool's actual
    // product would bury the answer under a footnote — `endpoint-briefing.ts`
    // makes the same split deliberately, push for truncation and unshift
    // reserved for unread dimensions.
    //
    // The wording says "the failure count above" and never quotes a literal
    // "0 failing": when `failingNow` is 0 that clause is omitted from the
    // sentence entirely, so glossing text the reader cannot see would be worse
    // than saying nothing.
    if (jobs.truncated) {
      headline.push(
        `INCOMPLETE: only ${jobs.rows.length} of ${jobs.totalItems} job instance(s) were served, so the ` +
          `definition list and failure count above are a FLOOR — they describe the rows returned, never ` +
          `this endpoint as a whole.`,
      );
    }
  }
  if (daysSinceSeen !== null && daysSinceSeen > 30) {
    headline.push(
      `Not seen for ${daysSinceSeen} days — anything newly assigned would queue rather than run.`,
    );
  }

  return {
    query: {
      endpointId: options.endpointId,
      maxGroupsChecked: o.maxGroupsChecked,
      budgetMs: o.budgetMs,
      maxNamed: o.maxNamed,
    },
    headline,
    endpoint: {
      name: epName,
      hostName: str(epRaw.hostName),
      lastSeen: str(epRaw.lastSeen),
      daysSinceSeen,
    },
    reach: {
      // Free: it is a field on the endpoint record, not a lookup.
      logicalGroup: sanitizeEstateText(str(epRaw.logicalGroup) ?? ""),
      logicalGroupId: str(epRaw.logicalGroupId),
      universalDynamicGroupsCheckedCount: groupsChecked,
      universalDynamicGroupsMemberOfCount: memberOf.length,
      universalDynamicGroups: memberOf.slice(0, o.maxNamed),
      groupsNotChecked: unchecked.slice(0, o.maxNamed),
      groupsNotCheckedCount: unchecked.length,
      namedNote:
        memberOf.length > o.maxNamed || unchecked.length > o.maxNamed
          ? `Counts are exact; name lists are capped at maxNamed=${o.maxNamed}.`
          : undefined,
    },
    assigned: {
      jobInstances: isUnavailable(jobs) ? null : jobs.totalItems ?? jobs.rows.length,
      // Beside the total, not instead of it — `endpoint-briefing.ts` already
      // publishes the pair and this block did not. `jobInstances` is the
      // SERVER's count while `jobDefinitions` and `currentlyFailing` are derived
      // from the rows actually read, so a structured consumer that never reads
      // the prose can still see the two populations differ.
      jobInstancesExamined: isUnavailable(jobs) ? null : jobs.rows.length,
      jobDefinitions: jobNames.slice(0, o.maxNamed),
      currentlyFailing: isUnavailable(jobs) ? null : failingNow,
      kioskReleases: isUnavailable(kiosk) ? null : kiosk.totalItems ?? kiosk.rows.length,
      detailHint:
        "Per-instance history, failure clusters and step detail: explain_job_failure or " +
        "list_job_instances_by_endpoint in bconnect-jobs. This block is a summary of what reaches here.",
    },
    meta: {
      resultTrustworthy: trustReasons.length === 0,
      resultTrustworthyReasons: trustReasons,
      membershipReads: groupsChecked,
      notCovered:
        "STATIC and DYNAMIC group membership is not reported: /endpoints/v2.0/StaticGroups and " +
        "/DynamicGroups both answer 404, so no caller can enumerate them. Their absence here is a " +
        "gap in the API, not a statement that this endpoint is in none.",
      snapshotNote:
        "Universal dynamic group membership is evaluated server-side from a rule rather than stored, " +
        "so this is a snapshot: the set can change before any action is taken on it, with nobody " +
        "editing a group.",
      costNote:
        "bConnect has no endpoint-to-groups direction, so this performs one membership read per " +
        "group. Measured on this estate: 56 reads, 436,124 B by hand, for an answer of about 390 B.",
    },
  };
}
