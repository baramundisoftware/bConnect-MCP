/**
 * Job failure diagnosis — composite read-only analysis.
 *
 * LOCAL ADDITION (not upstream). Answers "why are jobs failing?", which is the
 * most common operational question there is and which the raw API answers
 * badly:
 *
 *   - `list_job_instances` returns ~1.3 KB per instance with nested `steps`, so
 *     a 222-instance history is ~290 KB across 45 pages at the 5-item default
 *     (upstream D1). Even the 19 failures alone cost 61 KB.
 *   - Failures arrive as free text with an embedded timestamp, so every message
 *     is unique and nothing clusters until it is normalised.
 *   - `SearchQuery` cannot be trusted to find them (see below).
 *   - v2.0 cannot explain a failure once found: the timeout that caused it lives
 *     in v1.1 only (upstream D5).
 *
 * DELIBERATELY DOES NOT USE `SearchQuery`. The API returns
 * `"state": "FinishedWithError"`, but searching for that exact value matches
 * **nothing** — the query is applied to the human-readable `stateDescription`
 * ("Finished with error at ..."), so only `"Error"` matches (upstream D15).
 * Filtering on a display string would also break on a non-English bMS. This
 * pages the full set and filters on the `state` field instead, which is stable.
 *
 * ISSUES NO WRITES. It only reads.
 */

import type { AxiosInstance } from "axios";
import type { JobsModule } from "./jobs.js";
import {
  CREDENTIAL_SCOPE_NOTE,
  assessResultTrust,
  paginateAll,
  sanitizeEstateText,
  shortfallReason,
  truncationReason,
} from "@bconnect/mcp-core";
import { fetchV11Job, v11Configured } from "./v11.js";

const DAY_MS = 86_400_000;
const PAGE_SIZE = 1000;

/**
 * Hard ceiling on the instance walk (M2).
 *
 * This module previously had **no bound at all** — `for (let p = 1; p < totalPages; p++)`
 * straight off the envelope. That is the opposite of the truncation defect and
 * just as bad: a large estate, or a server reporting an implausible `totalPages`,
 * issues that many serial requests with nothing to stop it. 25 x 1000 is the same
 * bound `unpatched.ts` and `scan-recency.ts` settled on, and like theirs it is
 * reported rather than silent.
 */
const MAX_INSTANCE_PAGES = 25;

/**
 * Explicit order for the instance walk (M2).
 *
 * Measured live 2026-08-03 against 26R1 on `/jobs/v2.0/JobInstances`: the default
 * order is not chronological in either direction
 * (`2026-02-04 | 2025-09-30 | 2026-03-27`), `Start desc` is honoured
 * (`2026-08-03 | 2026-08-03 | 2026-08-03`), and an unknown property answers
 * HTTP 400 — the server checks this rather than merely declaring it. Without it
 * a bounded walk reads an arbitrary window that differs between runs; with it,
 * the bound means "the most recent N", which is the window this tool's
 * `sinceDays` filter is asking about anyway.
 */
const INSTANCE_ORDER_BY = "Start desc";

/** Job definitions to look up in v1.1. Bounds the request count on a big estate. */
const MAX_CONFIG_LOOKUPS = 5;

export interface Step {
  type?: string;
  description?: string;
  state?: string;
  stateDescription?: string | null;
}

export interface Instance {
  id?: string;
  jobDefinitionId?: string;
  jobDefinitionName?: string;
  endpointName?: string;
  initiator?: string;
  start?: string | null;
  lastAction?: string | null;
  successfulExecutions?: number;
  erroneousExecutions?: number;
  retries?: number;
  state?: string;
  stateDescription?: string | null;
  steps?: Step[];
}

/**
 * `Rescheduled` reads like a failure and is not one — treating it as one
 * inflated our own failure count from 19 to 46 (upstream X5). Classification is
 * on the `state` enum, and the full state census is returned so the caller can
 * see what was counted rather than trusting this list.
 */
// MOVED to @bconnect/mcp-core (job-state.ts), re-exported here so existing
// importers are unaffected.
//
// It moved because the warning that used to sit on this line came true. It read
// "Exported so diagnose-job.ts (and anything else diagnosing failures) shares
// one classification, rather than growing a third copy that could drift" — and
// a third copy grew anyway, in the insights server's patch-readiness composite,
// where it enumerated only FinishedWithError and RescheduledWithError. A
// CANCELLED patch job therefore reported as healthy. An export from one server
// package is not reachable by another; mcp-core is.
// NOTE the shape: `export { x } from "…"` re-exports without creating a LOCAL
// binding, so this file's own internal calls to isFailure would be undefined.
// Six tests in this package caught that immediately. Import, then export.
import { isJobFailureState } from "@bconnect/mcp-core";
export const isFailure = isJobFailureState;

/**
 * Strip the leading "Finished with error at 27.01.2026 09:06:02: " stamp, then
 * generalise the volatile parts. Without this every message is unique and the
 * clustering returns one bucket per failure.
 */
export function normaliseCause(raw: unknown): string {
  let s = String(raw ?? "").trim();
  if (!s) {return "(no description reported)";}

  s = s.replace(/^.*?\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2}\s*:\s*/, "");
  s = s.replace(/^.*?\d{4}-\d{2}-\d{2}T[\d:.]+Z?\s*:\s*/, "");

  const rules: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
    [/execution timeout/i, () => "Execution timeout — job did not finish within its configured time"],
    [/script ended user defined:?\s*(.+)/i, (m) => `Script ended user-defined: ${m[1].trim()}`],
    [/could not connect to client|unable to reach client/i, () => "Could not connect to client"],
    [/rpc server is unavailable/i, () => "RPC server unavailable (code 1722)"],
    [/error packaging .*?deploy script/i, () => "Error packaging baramundi Deploy script"],
    [/installation of \[(.+?)\] failed:?\s*(.*)/i, (m) =>
      `Installation failed: ${m[1]}${m[2] ? ` — ${m[2].trim()}` : ""}`],
    [/managed software update for software \[(.+?)\]/i, (m) => `Managed Software update failed: ${m[1]}`],
    [/access is denied|access denied/i, () => "Access denied"],
    [/disk|no space left/i, () => "Disk space"],
  ];

  for (const [re, fmt] of rules) {
    const m = s.match(re);
    // sanitizeEstateText, not a bare slice. Several of these rules interpolate
    // a capture group straight out of job output — text an attacker who can
    // make a job fail with a crafted message controls. The `.slice(0, 120)`
    // below guarded ONLY the fallback branch, so every RECOGNISED cause went
    // into model-facing headline prose unbounded, and invisible/bidi
    // characters passed through either way.
    if (m) {return sanitizeEstateText(fmt(m));}
  }

  // Unrecognised: generalise paths, GUIDs and numbers so near-identical
  // messages still land in one bucket.
  return s
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, "{guid}")
    .replace(/[A-Za-z]:\\[^\s,;]+|\\\\[^\s,;]+/g, "{path}")
    .replace(/\b\d{3,}\b/g, "{n}")
    .slice(0, 120)
    .trim();
}

const tally = <T>(rows: T[], key: (r: T) => string): Array<[string, number]> => {
  const m = new Map<string, number>();
  for (const r of rows) {m.set(key(r), (m.get(key(r)) ?? 0) + 1);}
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

/**
 * Conservative, field-grounded next check. Deliberately does not speculate
 * about a cause the data does not support.
 */
function suggestedCheck(cause: string): string | null {
  if (/Execution timeout/i.test(cause))
    {return "Check jobConfiguration below for a per-job timeout. If it reports 0, no per-job limit is set and " +
      "the limit is a bMS-level default the API does not expose — inspect the job in the console rather than " +
      "concluding from this data.";}
  if (/Could not connect/i.test(cause))
    {return "Endpoint was unreachable, not necessarily broken. Check its last check-in before touching the job.";}
  if (/RPC server unavailable/i.test(cause))
    {return "Agent-side RPC/DCOM or firewall on the endpoint, not a job configuration problem.";}
  if (/Script ended user-defined/i.test(cause))
    {return "The script exited deliberately with this message — this is job logic, not infrastructure.";}
  if (/Access denied/i.test(cause))
    {return "Check the execution context the job step runs under.";}
  return null;
}

export interface ExplainOptions {
  sinceDays?: number;
  jobDefinitionId?: string;
  endpointName?: string;
  topClusters?: number;
  includeInstanceIds?: boolean;
}

export async function explainJobFailure(
  jobs: JobsModule,
  client: AxiosInstance,
  opts: ExplainOptions = {}
): Promise<Record<string, unknown>> {
  const topClusters = opts.topClusters ?? 10;
  const startedAt = Date.now();

  // Page the set, bounded and ordered. One request at PageSize 1000 on a typical
  // estate. M2: the bound is new (there was none), and the walk now reports the
  // pages it actually read rather than the pages it intended to read.
  let totalItems: number | null = null;
  const walk = await paginateAll<Instance>(
    async (page) => {
      const res = (await jobs.getJobInstances({
        PageSize: PAGE_SIZE,
        Page: page,
        OrderBy: INSTANCE_ORDER_BY,
      } as never)) as unknown as { data?: Instance[]; totalPages?: number; totalItems?: number };
      if (page === 0 && typeof res.totalItems === "number") {
        totalItems = res.totalItems;
      }
      return { items: res.data ?? [], totalPages: res.totalPages ?? undefined };
    },
    { maxPages: MAX_INSTANCE_PAGES }
  );
  const all: Instance[] = walk.items;

  const now = Date.now();
  const withinWindow = (i: Instance): boolean => {
    if (opts.sinceDays == null) {return true;}
    const t = i.lastAction ?? i.start;
    if (!t) {return false;}
    return (now - new Date(t).getTime()) / DAY_MS <= opts.sinceDays;
  };

  const scoped = all
    .filter(withinWindow)
    .filter((i) => (opts.jobDefinitionId ? i.jobDefinitionId === opts.jobDefinitionId : true))
    .filter((i) => (opts.endpointName ? i.endpointName === opts.endpointName : true));

  const failures = scoped.filter((i) => isFailure(i.state));

  // Currently-green instances that have failed before. Invisible to any
  // state-based query, and often the more useful signal.
  const flapping = scoped
    .filter((i) => !isFailure(i.state) && (i.erroneousExecutions ?? 0) > 0)
    .map((i) => ({
      endpoint: i.endpointName ?? "(unknown)",
      job: i.jobDefinitionName ?? "(unknown)",
      state: i.state ?? null,
      erroneousExecutions: i.erroneousExecutions ?? 0,
      successfulExecutions: i.successfulExecutions ?? 0,
    }))
    .sort((a, b) => b.erroneousExecutions - a.erroneousExecutions);

  // ── Cluster ────────────────────────────────────────────────────────────────
  const causeOf = new Map<Instance, string>();
  for (const f of failures) {
    // Prefer the failing step's own message — it is more specific than the
    // instance-level roll-up when a multi-step job fails partway.
    const badStep = (f.steps ?? []).find((s) => isFailure(s.state));
    causeOf.set(f, normaliseCause(badStep?.stateDescription || f.stateDescription));
  }

  const clusters = tally(failures, (f) => causeOf.get(f)!)
    .slice(0, topClusters)
    .map(([cause, count]) => {
      const members = failures.filter((f) => causeOf.get(f) === cause);
      const stepTypes = [...new Set(members.flatMap((m) => (m.steps ?? []).filter((s) => isFailure(s.state)).map((s) => s.type ?? "?")))];
      return {
        cause,
        count,
        share: `${Math.round((count / Math.max(failures.length, 1)) * 100)}%`,
        jobs: tally(members, (m) => m.jobDefinitionName ?? "(unknown)").map(([n, c]) => ({ job: n, count: c })),
        endpoints: [...new Set(members.map((m) => m.endpointName ?? "(unknown)"))],
        failingStepTypes: stepTypes.length ? stepTypes : null,
        suggestedCheck: suggestedCheck(cause),
        instanceIds: opts.includeInstanceIds ? members.map((m) => m.id) : undefined,
      };
    });

  const neverSucceeded = failures
    .filter((f) => (f.successfulExecutions ?? 0) === 0)
    .map((f) => ({ endpoint: f.endpointName ?? "(unknown)", job: f.jobDefinitionName ?? "(unknown)" }));

  // ── Job configuration for the worst offenders (v1.1 only) ──────────────────
  const rankedJobs = tally(failures, (f) => f.jobDefinitionId ?? "");
  // M2. `configLookups` reported how many lookups were done and never how many
  // were eligible, so a 40-job failure spread returned config for 5 with nothing
  // saying 35 were skipped. Counted here so the two numbers sit side by side.
  const configEligible = rankedJobs.filter(([jobId]) => jobId).length;
  const jobConfiguration: Array<Record<string, unknown>> = [];
  let configNote = "";

  if (!v11Configured()) {
    configNote =
      "Job configuration not read: the bConnect v1.1 surface is off (BCONNECT_ENABLE_V11=true plus " +
      "BCONNECT_V11_USERNAME and BCONNECT_V11_PASSWORD turn it on). " +
      "JobExecutionTimeout and AbortOnError exist only in bConnect v1.1, so timeout failures cannot be " +
      "explained without them.";
  } else {
    // PER-16: these ≤5 lookups are independent of one another and each carries
    // the client's request timeout as its worst case, so running them in series
    // cost up to five of those in pure waiting. Promise.all resolves positionally, so `jobConfiguration`
    // still comes out in rankedJobs order and the loop body is unchanged.
    // fetchV11Job never rejects — it reports failure through `reason` — so
    // there is no fail-fast behaviour to lose here.
    const lookups = rankedJobs.slice(0, MAX_CONFIG_LOOKUPS).filter(([jobId]) => jobId);
    const v11Results = await Promise.all(lookups.map(([jobId]) => fetchV11Job(client, jobId)));

    for (const [index, [jobId, count]] of lookups.entries()) {
      const { job, reason } = v11Results[index]!;
      const name = failures.find((f) => f.jobDefinitionId === jobId)?.jobDefinitionName ?? jobId;
      if (!job) {
        jobConfiguration.push({ job: name, failures: count, unavailable: reason });
        continue;
      }
      const wp = (job.WindowsProperties ?? {}) as Record<string, unknown>;
      const rep = wp.RepeatedExecution as { IsActive?: boolean } | undefined;

      // JobExecutionTimeout is top-level, not under WindowsProperties. It is
      // also uninformative on this bMS: all 162 jobs report 0 while instances
      // still fail with "Execution timeout", so the effective limit lives
      // somewhere neither API version exposes. Reporting a bare 0 would read as
      // "the timeout is zero" and send an operator down the wrong path.
      const rawTimeout = job.JobExecutionTimeout;
      const timeoutUnset = rawTimeout === 0 || rawTimeout == null;

      // AbortOnError is omitted entirely when false (upstream D11), so absence
      // is not the same as "unknown" — say which it is.
      const abortPresent = "AbortOnError" in job;

      jobConfiguration.push({
        job: name,
        failures: count,
        jobExecutionTimeout: rawTimeout ?? null,
        timeoutNote: timeoutUnset
          ? "No per-job timeout is set (reported as 0), so this configuration does not explain a timeout " +
            "failure. The effective limit is a bMS-level or step-level default that neither v2.0 nor v1.1 exposes."
          : null,
        abortOnError: abortPresent ? job.AbortOnError : null,
        abortOnErrorNote: abortPresent
          ? null
          : "Field absent. A false value is omitted rather than serialised, so this is 'false or unset' — not 'unknown'.",
        destructive: job.Destructive ?? null,
        jobStartType: wp.JobStartType ?? null,
        scheduled: rep?.IsActive ?? null,
        stepCount: Array.isArray(job.Steps) ? (job.Steps as unknown[]).length : null,
      });
    }
  }

  const times = failures.map((f) => f.lastAction ?? f.start).filter(Boolean) as string[];
  times.sort();

  // ── Completeness (M2/M4) ──────────────────────────────────────────────────
  //
  // The shared contract from `@bconnect/mcp-core`. Both conditions are real
  // here: every number in `totals` is a count over `all`, so a bounded walk
  // makes each of them a floor, and the direction of the error is always
  // "fewer failures than there are".
  const trust = assessResultTrust(
    truncationReason("The job-instance listing", walk, "MAX_INSTANCE_PAGES"),
    shortfallReason("The job-instance listing walk", all.length, totalItems),
    configEligible > jobConfiguration.length && jobConfiguration.length > 0
      ? `Job configuration was read for ${jobConfiguration.length} of ${configEligible} job definition(s) ` +
        `behind a failure (bounded by MAX_CONFIG_LOOKUPS=${MAX_CONFIG_LOOKUPS}); the remaining ` +
        `${configEligible - jobConfiguration.length} were not looked up.`
      : null
  );
  const complete = trust.resultTrustworthy;

  const headline: string[] = [];
  // An incomplete walk must not be allowed to open with "No failed instances".
  // The flag alone would not fix it — the first line is what a caller reads.
  if (!complete) {
    headline.push(
      `INCOMPLETE READ — this is not an estate-wide answer. Examined ${all.length} of ` +
        `${totalItems ?? "?"} job instance(s) across ${walk.pagesFetched} of ${walk.totalPages} page(s). ` +
        `Every count below is a floor; a job or endpoint absent from the lists was not read, not cleared. ` +
        `See meta.resultTrustworthyReasons.`
    );
  }
  if (!failures.length) {
    headline.push(
      scoped.length
        ? complete
          ? `No failed instances among ${scoped.length} examined.`
          : `No failed instances among the ${scoped.length} examined — this is not a statement about the estate.`
        : "No job instances matched the filter."
    );
  } else {
    const top = clusters[0];
    headline.push(`${failures.length} failed instance(s) of ${scoped.length} examined.`);
    if (top) {headline.push(`${top.count} of ${failures.length} (${top.share}) share one cause: ${top.cause}`);}
    const worstJob = tally(failures, (f) => f.jobDefinitionName ?? "(unknown)")[0];
    if (worstJob && worstJob[1] > 1) {
      headline.push(`${worstJob[1]} failure(s) come from a single job definition: ${worstJob[0]}`);
    }
    if (flapping.length) {
      headline.push(`${flapping.length} instance(s) currently report success but have failed before.`);
    }
  }

  return {
    query: {
      sinceDays: opts.sinceDays ?? null,
      jobDefinitionId: opts.jobDefinitionId ?? null,
      endpointName: opts.endpointName ?? null,
      topClusters,
    },
    totals: {
      instancesExamined: scoped.length,
      // M2. This used to be `all.length` — the length of an unbounded-but-now-bounded
      // walk published under a field name that says "in estate". It is now the
      // server's own `totalItems`, which stays exact even when the walk is
      // bounded, with what was actually read beside it. Same correction H4 made
      // to `unpatched.ts`'s `endpointsInEstate`.
      instancesInEstate: totalItems ?? all.length,
      instancesRead: all.length,
      instanceWalkTruncated: walk.truncated,
      failed: failures.length,
      distinctCauses: new Set([...causeOf.values()]).size,
      endpointsAffected: new Set(failures.map((f) => f.endpointName)).size,
      jobsAffected: new Set(failures.map((f) => f.jobDefinitionId)).size,
      flappingInstances: flapping.length,
    },
    // Returned so the caller can audit the classification rather than trust it —
    // `Rescheduled` in particular is a success, not a failure (upstream X5).
    stateCensus: Object.fromEntries(tally(scoped, (i) => String(i.state ?? "(none)"))),
    headline,
    clusters,
    byEndpoint: tally(failures, (f) => f.endpointName ?? "(unknown)").map(([e, c]) => ({ endpoint: e, failures: c })),
    byJob: tally(failures, (f) => f.jobDefinitionName ?? "(unknown)").map(([j, c]) => ({ job: j, failures: c })),
    neverSucceeded,
    flapping: flapping.slice(0, 20),
    jobConfiguration: jobConfiguration.length ? jobConfiguration : null,
    timeWindow: times.length ? { earliest: times[0], latest: times[times.length - 1] } : null,
    meta: {
      // ESTATE-WIDE. Every option is optional, so called bare this walks every
      // JobInstance there is and clusters the failures — "why are jobs failing"
      // over the whole estate. JobInstances is rights-scoped, 233 -> 133 measured.
      //
      // This was EXEMPT until 2026-08-16 as "per-object: one job definition or
      // instance, reached by an id the caller already holds". That described the
      // arguments it MAY take, not the call it answers by default, and the
      // default IS the aggregate. Measured under a scoped key: distinctCauses
      // 6 -> 1, jobsAffected 8 -> 2, endpointsAffected 15 -> 8, and the
      // Rescheduled row vanishes from stateCensus — with BOTH responses
      // resultTrustworthy: true. "One distinct cause" is the shape of an
      // all-clear.
      credentialScope: CREDENTIAL_SCOPE_NOTE,
      elapsedMs: Date.now() - startedAt,
      // M2. This was `pagesFetched: totalPages` — the number of pages the walk
      // INTENDED to read, reported under a name that says it read them. A caller
      // reading it was reading a value that had never been observed. It is now a
      // counted fact, with the envelope's own figure beside it so the two can
      // never be confused again (the defect `stale-endpoints.ts` documents as
      // fixed in that module).
      pagesFetched: walk.pagesFetched,
      totalPages: walk.totalPages,
      truncated: walk.truncated,
      maxPages: MAX_INSTANCE_PAGES,
      orderBy: INSTANCE_ORDER_BY,
      // The shared completeness contract — see `@bconnect/mcp-core`.
      ...trust,
      configLookups: jobConfiguration.length,
      // M2. How many were eligible, not just how many were done.
      configEligible,
      configNote: configNote || null,
      note:
        "Read-only. Failures are classified on the `state` field, not on SearchQuery — the API returns " +
        "`FinishedWithError` but only matches the display text `Error`, so a value-based search silently " +
        "returns nothing. See stateCensus for what was counted.",
    },
  };
}
