/**
 * Stale / "ghost machine" detection — composite read-only aggregate.
 *
 * LOCAL ADDITION (not upstream). Answers upstream finding §12.5's proposed
 * `get_stale_endpoints` row directly — "not-seen-since with a threshold
 * parameter" — but does not stop there, because a not-seen threshold alone
 * misses the more interesting half of the "ghost machine" problem this
 * project keeps running into: a decommissioned box that still checks in
 * (so it never trips a last-seen threshold) while every job ever run
 * against it fails, sometimes hundreds of retries deep. That endpoint is
 * just as dead operationally, and it still counts toward license and
 * compliance numbers — the strongest demo moment this project produced was
 * finding exactly this pattern buried inside `explain_job_failure`'s
 * `flapping`/`neverSucceeded` arrays, built for a different purpose and
 * easy to miss unless you already know to ask for it.
 *
 * DESIGN DECISION — this tool crosses the domain boundary into job data.
 * `bconnect-endpoints-mcp` has no `JobsModule`, and importing one from
 * `bconnect-jobs-mcp` would mean a cross-package dependency between two
 * servers the vendor deliberately ships as independent processes. Instead
 * this calls `/jobs/v2.0/JobInstances` directly against the *same*
 * authenticated axios client returned by `BConnectClientBase.getHttpClient()`
 * — bConnect is one API behind one credential; "endpoints" vs "jobs" is
 * only a URL path segment (`/endpoints/v2.0/...` vs `/jobs/v2.0/...`), not a
 * different server or auth scheme (contrast v1.1, which genuinely does need
 * separate Basic-auth credentials — see `explain_job_failure`'s
 * `jobConfiguration` lookup). No new dependency is needed either: the two
 * job-instance fields this reads are declared locally as `JobInstanceRow`
 * below. (This note used to say the generated `jobs-types.ts` ships in this
 * package's own `src/generated/`. It did, along with eight other domains'
 * types that nothing imported — ~12,000 dead lines that tsc parsed on every
 * build. They were deleted under upstream finding OPT-36; only
 * `endpoints-types.ts` remains, which is the only one this server ever
 * imported.)
 *
 * The trade-off, stated plainly: this is no longer the cheap, self-contained
 * tool `get_fleet_summary` is. It costs one additional full-estate paginated
 * fetch of job-instance history (the same ~290KB-raw / ~1 page at PageSize
 * 1000 that `explain_job_failure` pays — see upstream D1), and it silently
 * degrades if the configured credential can't read the jobs module (caught,
 * reported in `meta.note`, not thrown). `includeJobHistory: false` opts back
 * into the cheap floor version for a caller that only wants check-in age. The
 * default is `true` — the whole reason this tool exists is that the
 * never-succeeded signal is the one nobody finds, so it should not require an
 * extra flag to see it.
 *
 * DELIBERATELY DOES NOT USE `SearchQuery` to find failed instances (upstream
 * D15 — it matches display text, not the `state` enum the API returns:
 * `"FinishedWithError"` finds nothing, `"Error"` finds some). This pages the
 * full `JobInstances` set once and aggregates client-side per `endpointId`,
 * exactly like `explain_job_failure` does for the same reason.
 *
 * COMPACT BY DESIGN (upstream D1). `list_windows_endpoints` costs ~89KB for
 * 23 endpoints; this returns totals, a headline and a capped, worst-first
 * `ghosts` list (default 25), never the full estate.
 *
 * KNOWN BLIND SPOT — deactivated clients are indistinguishable from ghosts.
 * A deactivated endpoint in bMS is no longer managed at all; it is kept as an
 * archive of what was installed and configured at the moment it was switched
 * off. So it will never check in again, by design, and every signal this tool
 * uses will flag it: last-seen grows without bound, and no job will ever
 * succeed on it again. It is the textbook false positive here — deliberately
 * retired, not neglected.
 *
 * We cannot filter it out. `isDeactivated` exists only on the typed
 * WindowsEndpoint schema, never on the generic /v2.0/Endpoints projection this
 * tool reads for payload reasons (upstream D1) — the same gap that made
 * get_fleet_summary's `deactivated` counter structurally zero, which is why
 * that counter was removed rather than repaired.
 *
 * Costs nothing on this estate: zero of 23 Windows endpoints are deactivated,
 * so every ghost reported here is a real one. On an estate that archives
 * retired machines this way, expect false positives proportional to the archive
 * — and note that the cheap fix is upstream, not here: exposing `isDeactivated`
 * on the generic projection would let this tool exclude archives in one filter.
 *
 * ISSUES NO WRITES. It only reads.
 */

import type { AxiosInstance } from "axios";
import { CREDENTIAL_SCOPE_NOTE, assessResultTrust, paginateAll, sanitizeEstateText, shortfallReason, truncationReason } from "@bconnect/mcp-core";
import type { EndpointsModule } from "./endpoints.js";
// LOCAL ADDITION — bMC console link builder. modules/bmc-console-link.ts
// carries the design rationale, what is vendor-documented, and why the block is
// opt-in rather than on by default.
import { consoleLinkMeta, isConsoleLinksEnabled, isRemoteDeskLinksEnabled } from "./bmc-console-link.js";

const DAY_MS = 86_400_000;
const JOB_PAGE_SIZE = 1000;
const ENDPOINT_PAGE_SIZE = 1000;
/** Real ceilings, not formalities — the response reports when one is hit. */
const MAX_ENDPOINT_PAGES = 20;
const MAX_JOB_PAGES = 20;

/**
 * Explicit orders for the two bounded walks. Without them a capped walk reads an
 * arbitrary subset that differs between runs, so the ghost list reshuffles over
 * an unchanged estate and the truncation notes below cannot describe what was
 * actually read.
 *
 * `DisplayName` and `LastAction` are both among the values their route documents
 * for `OrderBy` (`/v2.0/Endpoints`: DisplayName, HostName, OperatingSystem,
 * LastSeen; `/jobs/v2.0/JobInstances`: JobDefinitionDisplayName,
 * JobDefinitionName, EndpointName, Start, LastAction). `LastAction` rather than
 * `Start` because `start` is blank on a meaningful share of instances — those
 * rows sort to the end under `Start desc` and are the first a cap discards —
 * and because a capped history should be the RECENT window: the never-succeeded
 * signal is about what has happened lately, not about an arbitrary slice.
 */
const ENDPOINT_ORDER_BY = "DisplayName asc";
const JOB_ORDER_BY = "LastAction desc";

interface EndpointRow {
  id?: string;
  displayName?: string;
  hostName?: string | null;
  lastSeen?: string | null;
  activity?: string | null;
  operatingSystem?: string | null;
  type?: string | null;
}

interface JobInstanceRow {
  endpointId?: string;
  endpointName?: string;
  state?: string;
  successfulExecutions?: number;
  erroneousExecutions?: number;
  start?: string | null;
  lastAction?: string | null;
}

/**
 * Result of the job-instance page walk, with "not asked for" and "could not
 * read it" kept distinct — the two produce different notes, and collapsing
 * them would let a permissions failure read as a deliberate opt-out.
 */
type JobHistoryOutcome =
  | { status: "ok"; items: JobInstanceRow[]; pagesFetched: number; totalPages: number; truncated: boolean }
  | { status: "failed"; error: unknown }
  | { status: "skipped" };

interface JobAgg {
  instances: number;
  totalSuccessful: number;
  totalErroneous: number;
  everSucceeded: boolean;
  lastActivity: string | null;
}

interface Ghost {
  endpoint: string;
  /** TOK-23 — `id` + `type` replace the fully-expanded 131-165 character
   * `consoleLink` this row used to carry. `consoleLinks.template` on the
   * response reconstructs the URI from exactly these two fields, once, instead
   * of repeating it on every one of up to `maxListed` (default 25) ghosts. */
  id?: string;
  type?: string;
  reasons: string[];
  lastSeenDays: number | null;
  jobInstances: number;
  failedAttempts: number;
  everSucceededAJob: boolean | null;
  lastJobActivity: string | null;
  activity: string | null;
}

export interface StaleEndpointsOptions {
  notSeenForDays?: number;
  minFailedAttempts?: number;
  includeJobHistory?: boolean;
  maxListed?: number;
  /** Emit the RemoteDesk template alongside the console-link template in
   * `consoleLinks`. Defaults to isRemoteDeskLinksEnabled()
   * (BMC_REMOTEDESK_LINKS=true), off unless set. See bmc-console-link.ts. */
  includeRemoteDesk?: boolean;
  /** Emit the `consoleLinks` block at all. Defaults to isConsoleLinksEnabled()
   * (BMC_CONSOLE_LINKS=true), off unless set — see bmc-console-link.ts for why
   * an unverified deep link is not a default affordance. */
  includeConsoleLinks?: boolean;
}

export async function getStaleEndpoints(
  endpoints: EndpointsModule,
  client: AxiosInstance,
  opts: StaleEndpointsOptions = {}
): Promise<Record<string, unknown>> {
  // Matches get_fleet_summary's staleAfterDays default — same estate, same
  // convention, so the two tools agree on what "stale" means by default.
  const notSeenForDays = opts.notSeenForDays ?? 30;
  // erroneousExecutions accumulates retries within a single instance, so a
  // machine can rack up dozens of failed attempts without a human ever
  // re-triggering the job. Require a few before calling it a pattern rather
  // than a one-off blip.
  const minFailedAttempts = opts.minFailedAttempts ?? 3;
  const includeJobHistory = opts.includeJobHistory ?? true;
  const maxListed = opts.maxListed ?? 25;
  const includeRemoteDesk = opts.includeRemoteDesk ?? isRemoteDeskLinksEnabled();
  const includeConsoleLinks = opts.includeConsoleLinks ?? isConsoleLinksEnabled();
  const startedAt = Date.now();

  // LOCAL FIX — PER-16 / PER-17.
  //
  // PER-17: both fetches took page 0 and treated it as the whole set. The
  // endpoints listing fed `totals.endpoints`, and the job walk set
  // `jobPagesFetched = totalPages` BEFORE fetching those pages, so the meta
  // block reported pages it had not read. Both now walk every page under an
  // explicit bound and report whether the bound was hit.
  //
  // PER-16: the /Endpoints listing and the /jobs JobInstances history have no
  // data dependency — the join happens after both land — but they were
  // awaited back to back, making the floor latency two page-walks instead of
  // max(both). They are started together and awaited once.
  //
  // The generic /Endpoints projection (27 fields), not the 53-field typed
  // variants — same lean-payload choice get_fleet_summary makes (upstream D1).
  // Page-0 `totalItems` captured on both walks: `paginateAll` cannot see the
  // field, and the API has been MEASURED serving 200s whose data[] is empty
  // while the header still carries the real count. Discarding it here rendered
  // "No ghosts found among 0 endpoints" over an estate of 26.
  let estateTotalItems: number | null = null;
  let jobTotalItems: number | null = null;
  const estatePromise = paginateAll<EndpointRow>(
    async (p) => {
      const body = (await endpoints.getEndpoints({
        PageSize: ENDPOINT_PAGE_SIZE,
        Page: p,
        OrderBy: ENDPOINT_ORDER_BY,
      } as never)) as { data?: EndpointRow[]; totalPages?: number; totalItems?: number };
      if (p === 0 && typeof body.totalItems === "number") { estateTotalItems = body.totalItems; }
      return { items: body.data ?? [], totalPages: body.totalPages };
    },
    { maxPages: MAX_ENDPOINT_PAGES }
  );

  // Degrade, don't fail — a credential scoped to endpoints-only (a realistic
  // least-privilege setup) should still get the not-seen-since half rather
  // than an error. The rejection is folded into the result here, at the point
  // the promise is created, so starting it early cannot produce an unhandled
  // rejection while the endpoints walk is still running.
  const jobHistoryPromise: Promise<JobHistoryOutcome> = includeJobHistory
    ? paginateAll<JobInstanceRow>(
        async (p) => {
          const res = await client.get("/jobs/v2.0/JobInstances", {
            params: { PageSize: JOB_PAGE_SIZE, Page: p, OrderBy: JOB_ORDER_BY },
          });
          const body = res.data as { data?: JobInstanceRow[]; totalPages?: number; totalItems?: number };
          if (p === 0 && typeof body.totalItems === "number") { jobTotalItems = body.totalItems; }
          return { items: body.data ?? [], totalPages: body.totalPages };
        },
        { maxPages: MAX_JOB_PAGES }
      ).then(
        (walk): JobHistoryOutcome => ({ status: "ok", ...walk }),
        (error: unknown): JobHistoryOutcome => ({ status: "failed", error })
      )
    : Promise.resolve<JobHistoryOutcome>({ status: "skipped" });

  const [estate, jobHistory] = await Promise.all([estatePromise, jobHistoryPromise]);
  const rows = estate.items;
  // Shortfall is asserted only over a walk that did NOT hit its own page cap:
  // a capped walk is EXPECTED to absorb fewer rows than totalItems, and
  // truncationReason already owns that condition — asserting both would put
  // two reasons on one cause and prescribe "retry" for a client-side bound
  // retrying can never lift (adversarial review, M1).
  const estateShortfall = estate.truncated
    ? null
    : shortfallReason("The endpoint listing walk", rows.length, estateTotalItems);
  const jobShortfall = jobHistory.status === "ok" && !jobHistory.truncated
    ? shortfallReason("The job-instance history walk", jobHistory.items.length, jobTotalItems)
    : null;

  const now = Date.now();
  const ageDays = (r: EndpointRow): number | null =>
    r.lastSeen ? Math.floor((now - new Date(r.lastSeen).getTime()) / DAY_MS) : null;

  // ── Job history join (the "never succeeded" half) ────────────────────────
  const jobsByEndpoint = new Map<string, JobAgg>();
  let jobPagesFetched = 0;
  let jobInstancesExamined = 0;
  let jobHistoryNote: string | null = null;

  if (jobHistory.status === "skipped") {
    jobHistoryNote =
      "includeJobHistory=false — ghosts reflect check-in age only, not job outcome.";
  } else if (jobHistory.status === "failed") {
    // Say so rather than silently returning a partial answer that looks
    // complete (the trap this whole project keeps flagging — upstream §4).
    const err = jobHistory.error;
    jobHistoryNote =
      `Job history unavailable (${err instanceof Error ? err.message : String(err)}); ` +
      "ghosts reflect check-in age only, not job outcome. Falls back to the notSeenForDays " +
      "signal alone.";
  } else {
    jobPagesFetched = jobHistory.pagesFetched;
    jobInstancesExamined = jobHistory.items.length;

    // Join on endpointId (a GUID field JobInstance carries directly), not
    // endpointName — a stabler key than the string-matching
    // explain_job_failure has to use because it has no endpoints listing
    // to join against.
    for (const inst of jobHistory.items) {
      const key = inst.endpointId;
      if (!key) {continue;}
      const cur = jobsByEndpoint.get(key) ?? {
        instances: 0,
        totalSuccessful: 0,
        totalErroneous: 0,
        everSucceeded: false,
        lastActivity: null,
      };
      cur.instances += 1;
      cur.totalSuccessful += inst.successfulExecutions ?? 0;
      cur.totalErroneous += inst.erroneousExecutions ?? 0;
      const t = inst.lastAction ?? inst.start ?? null;
      if (t && (!cur.lastActivity || t > cur.lastActivity)) {cur.lastActivity = t;}
      jobsByEndpoint.set(key, cur);
    }
    for (const agg of jobsByEndpoint.values()) {agg.everSucceeded = agg.totalSuccessful > 0;}

    if (jobHistory.truncated) {
      // An endpoint whose only job instances live on an unread page looks like
      // it has no job history at all, which reads as "no failures" — the
      // never-succeeded signal would go quiet exactly where it matters.
      jobHistoryNote =
        `Job history INCOMPLETE — read the ${jobInstancesExamined} most recent instances by ` +
        `${JOB_ORDER_BY}, being ${jobHistory.pagesFetched} of ${jobHistory.totalPages} pages ` +
        `(${MAX_JOB_PAGES}-page cap). Endpoints whose instances all fall outside that window ` +
        "appear to have no job history, so the never-succeeded-a-job signal is understated.";
    } else if (jobShortfall) {
      // The short-serve case is worse than the cap: nothing this tool asked
      // for was refused, the server simply served fewer rows than its own
      // count. Without this branch the generic joined-by-endpointId note
      // rendered under a never-succeeded signal computed over none of the
      // instances the server says exist (adversarial review, H1).
      jobHistoryNote =
        `Job history INCOMPLETE — ${jobShortfall} The never-succeeded-a-job signal was computed ` +
        `over what WAS served and is understated. Retry; if it persists, the server's own count ` +
        `disagrees with what it serves (observed live on this API).`;
    }
  }

  // ── Classify ───────────────────────────────────────────────────────────
  const ghosts: Ghost[] = [];
  let notSeenSinceCount = 0;
  let neverSucceededCount = 0;
  let bothCount = 0;

  for (const r of rows) {
    const age = ageDays(r);
    const isStale = age === null || age > notSeenForDays;

    const jobInfo = includeJobHistory && r.id ? jobsByEndpoint.get(r.id) : undefined;
    const isFailingGhost =
      !!jobInfo && !jobInfo.everSucceeded && jobInfo.totalErroneous >= minFailedAttempts;

    if (!isStale && !isFailingGhost) {continue;}

    const reasons: string[] = [];
    if (age === null) {reasons.push("never checked in");}
    else if (isStale) {reasons.push(`not seen for ${age} days`);}
    if (isFailingGhost) {
      reasons.push(
        `${jobInfo!.instances} job instance(s), ${jobInfo!.totalErroneous} failed execution(s), never once succeeded`
      );
    }

    if (isStale && isFailingGhost) {bothCount++;}
    else if (isStale) {notSeenSinceCount++;}
    else {neverSucceededCount++;}

    ghosts.push({
      endpoint: r.displayName ?? "(unnamed)",
      ...(r.id ? { id: r.id } : {}),
      ...(r.type ? { type: r.type } : {}),
      reasons,
      lastSeenDays: age,
      jobInstances: jobInfo?.instances ?? 0,
      failedAttempts: jobInfo?.totalErroneous ?? 0,
      everSucceededAJob: jobInfo ? jobInfo.everSucceeded : null,
      lastJobActivity: jobInfo?.lastActivity ?? null,
      activity: r.activity ?? null,
    });
  }

  // Worst first: both-signal ghosts lead, then by failure volume, then by age.
  ghosts.sort((a, b) => {
    const bothA = a.reasons.length > 1 ? 1 : 0;
    const bothB = b.reasons.length > 1 ? 1 : 0;
    if (bothB !== bothA) {return bothB - bothA;}
    if (b.failedAttempts !== a.failedAttempts) {return b.failedAttempts - a.failedAttempts;}
    return (b.lastSeenDays ?? Number.MAX_SAFE_INTEGER) - (a.lastSeenDays ?? Number.MAX_SAFE_INTEGER);
  });

  const headline: string[] = [];
  if (estateShortfall) {
    // The all-clear below must never render over unread machines: "No ghosts
    // found among 0 endpoints" with the server reporting 26 is the exact false
    // health this tool exists to remove.
    headline.push(
      `INCOMPLETE — ${estateShortfall} An empty or short page under an intact header has been ` +
        `observed live on this API. Retry; if it persists, the server's own count disagrees ` +
        `with what it serves. Do not read absence as health.`
    );
  }
  if (jobShortfall) {
    // Same rule for the other half of the join: a quiet never-succeeded signal
    // over a short-served history must not read as "no failing ghosts".
    headline.push(
      `INCOMPLETE — ${jobShortfall} The never-succeeded-a-job signal is understated; ` +
        `ghost counts below are floors.`
    );
  }
  if (!ghosts.length) {
    if (!estateShortfall && !jobShortfall) {
      headline.push(
        `No ghosts found among ${rows.length} endpoints (notSeenForDays=${notSeenForDays}` +
          (includeJobHistory ? `, minFailedAttempts=${minFailedAttempts}).` : ").")
      );
    }
  } else {
    headline.push(
      `${ghosts.length} of ${rows.length} endpoints are ghosts: ${notSeenSinceCount} not-seen-since, ` +
        `${neverSucceededCount} checking in but never succeeded a job, ${bothCount} both.`
    );
    const worst = ghosts[0];
    // The endpoint display name is operator-renameable and this list is sorted
    // worst-first deterministically, so an attacker who can rename one machine
    // chooses what lands in this headline. The name still appears verbatim in
    // the structured rows below; it is only the PROSE that is bounded.
    headline.push(`Worst offender: ${sanitizeEstateText(worst.endpoint)} — ${worst.reasons.join("; ")}.`);
  }

  return {
    // Say what was applied rather than leaving it implied (same rationale as
    // get_fleet_summary and explain_job_failure's `query` echo).
    query: {
      notSeenForDays,
      minFailedAttempts: includeJobHistory ? minFailedAttempts : null,
      includeJobHistory,
      maxListed,
    },
    totals: {
      // The server's own count under the estate-shaped name, with what was
      // actually read beside it (the H4 rule; live-measured empty-page case).
      endpoints: estateTotalItems ?? rows.length,
      endpointsExamined: rows.length,
      ghosts: ghosts.length,
      notSeenSince: notSeenSinceCount,
      neverSucceededAJob: neverSucceededCount,
      both: bothCount,
    },
    headline,
    ghosts: ghosts.slice(0, maxListed),
    // Ghosts dropped by the DISPLAY cap. This was named `truncated` — a
    // coverage word for a formatting fact, sitting one field from
    // meta.estate.truncated which means a bounded WALK. Renamed so the two
    // cannot be read as the same thing.
    ghostsNotListed: Math.max(0, ghosts.length - maxListed),
    // LOCAL ADDITION — see modules/bmc-console-link.ts. TOK-23: one template
    // and one worked example (expanded from the worst offender, which is the
    // ghost a human actually wants to open) instead of a URI on every ghost.
    // Absent entirely unless BMC_CONSOLE_LINKS=true.
    ...(includeConsoleLinks
      ? {
          consoleLinks: consoleLinkMeta(
            ghosts[0] ? { id: ghosts[0].id, type: ghosts[0].type, displayName: ghosts[0].endpoint } : null,
            includeRemoteDesk
          ),
        }
      : {}),
    meta: {
      // An estate-wide aggregate, so it owes the scope disclosure. See
      // result-trust.ts. Measured under a scoped key: "21 of 27 endpoints are
      // ghosts" became "8 of 9 endpoints are ghosts", with a DIFFERENT worst
      // offender named, both responses `resultTrustworthy: true`.
      credentialScope: CREDENTIAL_SCOPE_NOTE,
      elapsedMs: Date.now() - startedAt,
      // The shared completeness contract — see result-trust.ts. Conditions:
      // each walk's page-cap bound, each walk's live-measured short-serve, and
      // an outright job-history failure. includeJobHistory=false is a caller
      // choice, not an incompleteness.
      ...assessResultTrust(
        truncationReason("The endpoint listing", estate, "MAX_ENDPOINT_PAGES"),
        estateShortfall,
        jobHistory.status === "failed" ? jobHistoryNote : null,
        jobHistory.status === "ok" && jobHistory.truncated ? jobHistoryNote : null,
        jobShortfall,
      ),
      jobPagesFetched,
      jobInstancesExamined,
      jobTotalItems,
      // LOCAL ADDITION — PER-17. Say what `totals` was computed over, so a
      // truncated estate walk can never be mistaken for a complete one.
      jobOrderBy: JOB_ORDER_BY,
      estate: {
        pagesFetched: estate.pagesFetched,
        totalPages: estate.totalPages,
        totalItems: estateTotalItems,
        rowsExamined: rows.length,
        pageSize: ENDPOINT_PAGE_SIZE,
        orderBy: ENDPOINT_ORDER_BY,
        truncated: estate.truncated,
      },
      ...(estate.truncated
        ? {
            estateNote:
              `INCOMPLETE — stopped after ${estate.pagesFetched} of ${estate.totalPages} endpoint ` +
              `pages (${MAX_ENDPOINT_PAGES}-page cap). Only the first ${rows.length} endpoints by ` +
              `${ENDPOINT_ORDER_BY} were examined, so every total below UNDERSTATES the estate.`,
          }
        : {}),
      note:
        jobHistoryNote ??
        "Job history joined by endpointId rather than filtered with SearchQuery — SearchQuery matches " +
          "display text, not the state enum — to catch endpoints that check in but have never once " +
          "succeeded a job, the signal a not-seen threshold alone misses.",
    },
  };
}
