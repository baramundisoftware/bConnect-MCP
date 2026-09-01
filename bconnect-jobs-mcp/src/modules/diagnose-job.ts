/**
 * Job diagnosis — "why is THIS job unreliable?" in one call.
 *
 * LOCAL ADDITION (not upstream). Roadmapped in UPSTREAM-FEEDBACK.md §12.5 as
 * `diagnose_job` ("definition + config + recent instances + step outcomes in
 * one response") and expanded on in §12.3, "Close the diagnostic gap between
 * v1.1 and v2.0":
 *
 *   > v1.1 exposes job configuration v2.0 does not (D5), so anyone doing
 *   > remediation needs both APIs and two auth schemes — v1.1 is Basic-only.
 *
 * That is the gap this tool closes for a caller, even though it cannot close
 * it for baramundi. `get_job_definition` is field-for-field identical to the
 * list entry (D5) — it does not even return `Steps`. Everything that actually
 * explains an unreliable job — `Steps`, `JobExecutionTimeout`,
 * `RepeatedExecution`, `AbortOnError`, `Destructive` — lives only in v1.1
 * (BCONNECT-V11-VS-V20.md §3), which `v11.ts` already bridges and which
 * `preview-assignment.ts` already reads for the `Destructive` flag. This
 * module folds that same v1.1 read together with this job's own recent
 * instance history and per-step outcomes into one verdict, instead of a
 * caller re-deriving it by hand (which is exactly how BCONNECT-V11-VS-V20.md
 * §5 arrived at its "self-perpetuating failure" finding for the weekly patch
 * job — RepeatedExecution.ErrorBehavior=PlanNew plus UserActionType=CanDelay
 * against endpoints that are rarely online).
 *
 * SIGNALS CHOSEN FOR "UNRELIABLE", AND WHY:
 *
 *   1. Recent failure rate — the obvious one. Scoped to THIS job definition
 *      via `/JobDefinitions/{id}/JobInstances`, not the whole-estate paging
 *      explain-job-failure.ts does, because that scope is already narrow
 *      (D1's ~290KB/45-page problem is a fleet-wide number; one job's history
 *      is small by comparison). Still capped (see MAX_INSTANCES) and reports
 *      whether it was capped, because "small" is a property of this estate,
 *      not a guarantee.
 *
 *   2. Timeout-vs-error split. `Execution timeout` and a genuine script/step
 *      error demand different remediation — one is a duration problem, the
 *      other is a logic problem — so they are reported as separate shares of
 *      the failure total, not folded into one "failed" bucket. Per D16,
 *      `JobExecutionTimeout` reads `0` on every job on this estate, so a
 *      dominant timeout share is reported as a real, load-bearing finding
 *      while the configured timeout value is reported as uninformative,
 *      exactly as explain-job-failure.ts already does — see D16's note that
 *      a bare `0` reads as "the timeout is zero" when the true meaning is
 *      "no per-job override; the effective limit is a bMS default neither
 *      API version exposes."
 *
 *   3. AbortOnError x multi-step interaction. A job with N>1 steps and
 *      AbortOnError effectively true fails as a unit the moment step 1 of N
 *      breaks — steps 2..N never even attempt to run. That changes what a
 *      per-step failure breakdown MEANS: a 100% failure rate on step 2 does
 *      not imply step 2 is broken if step 1 gates it. This tool reports the
 *      step-level failure tally and states this caveat explicitly rather
 *      than implying independence between steps. Per D11, AbortOnError is
 *      omitted (not `false`) 32 of 162 times on this estate with zero
 *      observed `false` values, so "absent" is reported as "false-or-unset",
 *      never silently coerced to a boolean.
 *
 *   4. Repeated execution against endpoints that are never online. A job
 *      with `RepeatedExecution.IsActive=true` will retry indefinitely; if
 *      the endpoints behind its failures have not checked in for a long
 *      time, the retries cannot succeed no matter how many times they run.
 *      Cross-referencing failed instances' endpoint names against
 *      `/endpoints/v2.0/Endpoints.lastSeen` (same source `preview-assignment.ts`
 *      already reads for "online now") surfaces this. Combined with
 *      `ErrorBehavior=PlanNew` (schedules a fresh run on failure rather than
 *      giving up) this is flagged as SELF-PERPETUATING — the failure rate
 *      will not improve on its own.
 *
 * DEGRADATION: v1.1 is a liability by design (Basic auth only, a second
 * credential, sunsetting per BCONNECT-V11-VS-V20.md §4), so it is opt-in —
 * BCONNECT_ENABLE_V11 plus the two credentials. If the surface is off or the
 * read fails, this tool does NOT fail — it returns everything derivable from v2.0 alone
 * (failure rate, timeout/error split, per-step tally, stale-endpoint check)
 * and sets `configuration.available: false` with an explicit
 * `unavailableReason`, plus `meta.missingSignals` naming exactly which
 * signals could not be computed (AbortOnError interaction, Destructive,
 * RepeatedExecution/self-perpetuation). A caller — human or model — must be
 * able to tell "this job looks reliable" apart from "half the analysis
 * silently didn't run."
 *
 * DELIBERATELY DOES NOT USE `SearchQuery` for state filtering (upstream
 * D15 — it matches display text, not the enum). Failure classification reuses
 * `isFailure` / `normaliseCause` from explain-job-failure.ts, the tool that
 * already carries the fix for X5 (`Rescheduled` is a success, not a failure).
 *
 * ISSUES NO WRITES. It only reads.
 */

import type { AxiosInstance } from "axios";
import {
  CREDENTIAL_SCOPE_NOTE,
  assessResultTrust,
  paginateAll,
  shortfallReason,
  truncationReason,
} from "@bconnect/mcp-core";
import type { JobsModule } from "./jobs.js";
import { fetchV11Job } from "./v11.js";
import { isFailure, normaliseCause, type Instance } from "./explain-job-failure.js";

const DAY_MS = 86_400_000;
const PAGE_SIZE = 100;
/** Bounds request count. A single job's history is small relative to the
 *  whole-estate case (D1), but still capped and the cap is reported. */
const MAX_INSTANCES = 300;

const ENDPOINT_PAGE_SIZE = 1000;
/** Same bound and same reasoning as `unpatched.ts` — 25 x 1000 endpoints. */
const MAX_ENDPOINT_PAGES = 25;

/**
 * Explicit order for the endpoint walk (M1).
 *
 * Measured live 2026-08-03 against 26R1: `/endpoints/v2.0/Endpoints` returns an
 * unsorted default order (`WIN10CLIENT4 | WIN10CLIENT1 | WIN10CLIENT3`),
 * honours `DisplayName asc` (`A-DC-01 | BMS-SRV1 | A-SRV-02`), and answers
 * HTTP 400 on an unknown property — so the server checks this value rather than
 * merely declaring it. A bounded walk of an unordered collection reads an
 * arbitrary subset that differs between runs; ordered, it reads a contiguous,
 * nameable slice. `DisplayName` is also the key the failing-instance names join
 * on, which is what makes the slice meaningful here.
 */
const ENDPOINT_ORDER_BY = "DisplayName asc";

interface EndpointRow {
  displayName?: string;
  lastSeen?: string | null;
  isDeactivated?: boolean;
}

/** What one bounded read of the endpoint listing actually covered. */
interface EndpointWalk {
  byName: Map<string, EndpointRow>;
  rowsExamined: number;
  pagesFetched: number;
  totalPages: number;
  /** `totalItems` from page 0 — the server's own statement of the estate size,
   *  which stays exact even when the walk is bounded. */
  totalItems: number | null;
  truncated: boolean;
}

/**
 * Page the endpoint listing, bounded and ordered, and report what was covered.
 *
 * M1: this used to be a single `client.get(..., { PageSize: 1000 })` with no
 * `Page` and no loop. Past 1,000 endpoints every endpoint on page 2+ was simply
 * absent from the index, and the caller below counted an absent name as stale —
 * so the page bound manufactured `staleCount`, which flipped `selfPerpetuating`
 * to true, which overwrote the verdict with "UNRELIABLE — SELF-PERPETUATING".
 * A diagnostic that invents a severe verdict out of its own bound erodes trust
 * in every verdict it gives, so the bound is now real, reported, and — crucially
 * — is no longer allowed to masquerade as evidence.
 */
async function loadEndpointIndex(client: AxiosInstance): Promise<EndpointWalk> {
  const byName = new Map<string, EndpointRow>();
  let totalItems: number | null = null;
  let rowsExamined = 0;

  const walk = await paginateAll<never>(
    async (page) => {
      const res = await client.get("/endpoints/v2.0/Endpoints", {
        params: { PageSize: ENDPOINT_PAGE_SIZE, Page: page, OrderBy: ENDPOINT_ORDER_BY },
      });
      const body = (res.data ?? {}) as {
        data?: EndpointRow[];
        totalPages?: number;
        totalItems?: number;
      };
      if (page === 0 && typeof body.totalItems === "number") {
        totalItems = body.totalItems;
      }
      for (const e of body.data ?? []) {
        rowsExamined++;
        if (e.displayName) {
          byName.set(e.displayName.toLowerCase(), e);
        }
      }
      // Rows are absorbed into the map here, so nothing is accumulated twice.
      return { items: [], totalPages: body.totalPages ?? undefined };
    },
    { maxPages: MAX_ENDPOINT_PAGES }
  );

  return {
    byName,
    rowsExamined,
    pagesFetched: walk.pagesFetched,
    totalPages: walk.totalPages,
    totalItems,
    truncated: walk.truncated,
  };
}

interface InstancesFetchResult {
  instances: Instance[];
  /** Page-0 `totalItems`: the server's own count, or null when the envelope
   *  omitted it. Never defaulted to the walk's own length — that made the
   *  shortfall assertion below compare a number with itself. */
  totalItems: number | null;
  /** Rows the walk absorbed before the maxInstances slice. */
  rowsExamined: number;
  pagesFetched: number;
  truncated: boolean;
  /** Which bound actually stopped a truncated walk — the loop has three exits,
   *  and reporting "bounded by maxInstances" when MAX_HISTORY_PAGES stopped it
   *  is a confident wrong diagnosis (adversarial review, M3). */
  boundedBy: "maxInstances" | "MAX_HISTORY_PAGES" | null;
  /** Set only when the fetch itself failed (e.g. an unknown jobDefinitionId
   *  404s) — kept distinct from "genuinely zero instances". */
  fetchError?: string;
}

const tally = <T>(rows: T[], key: (r: T) => string): Array<[string, number]> => {
  const m = new Map<string, number>();
  for (const r of rows) {m.set(key(r), (m.get(key(r)) ?? 0) + 1);}
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

const pct = (n: number, d: number): string => (d > 0 ? `${Math.round((n / d) * 100)}%` : "n/a");

/**
 * The walk's OWN page bound. `maxInstances` bounds rows, and rows never
 * advance across an empty page — the API has been MEASURED serving 200s with
 * an empty data[] under an intact header — so without this, the loop below
 * issued one request per server-declared page, unbounded by anything this
 * module owns. Same defect family MAX_INSTANCE_PAGES closed in
 * explain-job-failure.ts, same ceiling.
 */
const MAX_HISTORY_PAGES = 25;

async function fetchInstances(
  jobs: JobsModule,
  jobDefinitionId: string,
  maxInstances: number
): Promise<InstancesFetchResult> {
  const all: Instance[] = [];
  let page = 0;
  let totalPages = 1;
  let totalItems: number | null = null;
  while (all.length < maxInstances && page < totalPages && page < MAX_HISTORY_PAGES) {
    const res = await jobs.getJobInstancesByJobDefinition(jobDefinitionId, {
      PageSize: PAGE_SIZE,
      Page: page,
      OrderBy: "Start desc",
    } as never);
    const body = res as unknown as { data?: Instance[]; totalPages?: number; totalItems?: number };
    all.push(...(body.data ?? []));
    totalPages = body.totalPages ?? 1;
    if (page === 0 && typeof body.totalItems === "number") {totalItems = body.totalItems;}
    page++;
  }
  const truncated = page < totalPages || all.length > maxInstances;
  return {
    instances: all.slice(0, maxInstances),
    totalItems,
    rowsExamined: all.length,
    pagesFetched: page,
    truncated,
    boundedBy: !truncated ? null
      : all.length >= maxInstances ? "maxInstances"
      : "MAX_HISTORY_PAGES",
  };
}

export interface DiagnoseOptions {
  jobDefinitionId: string;
  sinceDays?: number;
  maxInstances?: number;
  /** An endpoint with no check-in inside this many days is treated as "never
   *  online" for the self-perpetuating-failure signal. Deliberately longer
   *  than preview-assignment's 7-day "online now" window — this signal asks
   *  a different question ("will retrying ever help?"), not "is it up now?" */
  staleAfterDays?: number;
}

export async function diagnoseJob(
  jobs: JobsModule,
  client: AxiosInstance,
  opts: DiagnoseOptions
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const maxInstances = opts.maxInstances ?? MAX_INSTANCES;
  const staleAfterDays = opts.staleAfterDays ?? 30;

  // v2.0 definition — thin (D5), but it's the only source for name/folder/type.
  // PER-16: independent of the instance history and the v1.1 lookup below, so
  // it joins their Promise.all instead of costing its own round trip first.
  // The catch stays: a missing definition is non-fatal — diagnosis can proceed
  // on instance history alone, and surfaces via job.name === null.
  const defPromise: Promise<Record<string, unknown>> = jobs
    .getJobDefinition(opts.jobDefinitionId)
    .then((d) => d as unknown as Record<string, unknown>)
    .catch(() => ({}) as Record<string, unknown>);

  // Wrapped rather than left in the Promise.all directly: an unknown
  // jobDefinitionId 404s on /JobDefinitions/{id}/JobInstances (unlike
  // list-and-filter tools, this endpoint is scoped server-side), and that
  // must not crash the whole diagnosis — a bad ID is informative on its own
  // and should surface as "UNKNOWN", not as an unhandled tool error.
  const instancesPromise: Promise<InstancesFetchResult> = fetchInstances(jobs, opts.jobDefinitionId, maxInstances).catch(
    (err: unknown) => {
      const e = err as { message?: string };
      return {
        instances: [],
        totalItems: null,
        rowsExamined: 0,
        pagesFetched: 0,
        truncated: false,
        boundedBy: null,
        fetchError: e.message ?? String(err),
      };
    }
  );
  const [def, { instances, totalItems, rowsExamined, pagesFetched, truncated, boundedBy, fetchError }, v11Result] = await Promise.all([
    defPromise,
    instancesPromise,
    fetchV11Job(client, opts.jobDefinitionId),
  ]);

  const now = Date.now();
  const scoped = instances.filter((i) => {
    if (opts.sinceDays == null) {return true;}
    const t = i.lastAction ?? i.start;
    if (!t) {return false;}
    return (now - new Date(t).getTime()) / DAY_MS <= opts.sinceDays;
  });

  const failures = scoped.filter((i) => isFailure(i.state));
  const causeOf = new Map<Instance, string>();
  for (const f of failures) {
    const badStep = (f.steps ?? []).find((s) => isFailure(s.state));
    causeOf.set(f, normaliseCause(badStep?.stateDescription || f.stateDescription));
  }
  const timeoutFailures = failures.filter((f) => /timeout/i.test(causeOf.get(f) ?? ""));
  const neverSucceeded = scoped.filter((i) => (i.successfulExecutions ?? 0) === 0 && isFailure(i.state));
  const flapping = scoped.filter((i) => !isFailure(i.state) && (i.erroneousExecutions ?? 0) > 0);

  // ── Signal 3: per-step outcome tally ────────────────────────────────────
  const stepTotals = new Map<string, number>();
  const stepFailed = new Map<string, number>();
  for (const inst of scoped) {
    for (const s of inst.steps ?? []) {
      const t = s.type ?? "?";
      stepTotals.set(t, (stepTotals.get(t) ?? 0) + 1);
      if (isFailure(s.state)) {stepFailed.set(t, (stepFailed.get(t) ?? 0) + 1);}
    }
  }
  const stepOutcomes = [...stepTotals.entries()]
    .map(([step, total]) => {
      const failed = stepFailed.get(step) ?? 0;
      return { step, total, failed, failureRate: pct(failed, total) };
    })
    .sort((a, b) => b.failed - a.failed);

  // ── v1.1 configuration (may be unavailable — degrade, don't fail) ──────
  const v11 = v11Result.job;
  const wp = (v11?.WindowsProperties ?? {}) as Record<string, unknown>;
  const rep = wp.RepeatedExecution as
    | { IsActive?: boolean; RepetitionEntries?: Array<{ Minutes?: number }>; ErrorBehavior?: string }
    | undefined;
  const stepTypes = v11 ? ((v11.Steps as unknown[]) ?? []).map((s) => (s as { Type?: string }).Type ?? "?") : null;

  // v1.1's Steps and v2.0's per-instance `steps` do NOT share a vocabulary or
  // granularity. v1.1 lists CONFIGURED steps (e.g. one step, type
  // "ManagedSoftware"); v2.0 instance records list RUNTIME executions, and a
  // single ManagedSoftware step fans out into one per-application entry each
  // (types like "WindowsApplicationInstallation" / "WindowsApplicationUninstall"),
  // so stepOutcomes below can show far more distinct types (and far more total
  // executions) than configuration.stepCount. Observed live: a job configured
  // with 1 step produced 3 distinct runtime step types across 102 executions
  // in 13 instances. Flagged rather than silently presented as 1:1.
  const stepOutcomesNote =
    stepTypes && stepOutcomes.length !== stepTypes.length
      ? `configuration.steps lists ${stepTypes.length} configured step(s) (${stepTypes.join(", ")}), but ` +
        `${stepOutcomes.length} distinct runtime step type(s) were observed in instance history. v1.1 Steps ` +
        `and v2.0 instance steps are not the same granularity — a single configured step (e.g. ManagedSoftware) ` +
        `can execute as multiple per-application runtime steps. Do not assume a 1:1 mapping between the two.`
      : null;

  const rawTimeout = v11?.JobExecutionTimeout;
  const timeoutUnset = rawTimeout === 0 || rawTimeout == null;
  const abortPresent = v11 ? "AbortOnError" in v11 : false;
  const abortOnError = abortPresent ? Boolean(v11!.AbortOnError) : null;

  const missingSignals: string[] = [];
  if (!v11) {
    missingSignals.push(
      "Destructive flag (v1.1 unavailable)",
      "AbortOnError x multi-step interaction (v1.1 unavailable)",
      "RepeatedExecution / self-perpetuating-failure check (v1.1 unavailable)"
    );
  }

  // ── Signal 3 continued: AbortOnError x multi-step interaction ──────────
  let abortOnErrorRisk: string | null = null;
  if (v11 && Array.isArray(v11.Steps) && (v11.Steps as unknown[]).length > 1) {
    const n = (v11.Steps as unknown[]).length;
    if (abortOnError !== false) {
      abortOnErrorRisk =
        `Job has ${n} steps and AbortOnError is ${abortPresent ? "true" : "absent from the v1.1 record — reported as 'false-or-unset', not coerced to false"}. ` +
        `If AbortOnError effectively applies, the first failing step ends the run — later steps never attempt to execute, ` +
        `so the per-step failure tally below cannot be read as independent step reliability.`;
    } else {
      abortOnErrorRisk =
        `Job has ${n} steps and AbortOnError is explicitly false — later steps still run after an earlier one fails, ` +
        `so the per-step failure tally below reflects each step's own reliability.`;
    }
  }

  // ── Signal 4: repeated execution against endpoints that are never online ─
  let staleEndpointRisk: Record<string, unknown> | null = null;
  let selfPerpetuating: boolean | null = null;
  let endpointWalk: EndpointWalk | null = null;
  let endpointLookupError: string | null = null;
  const failingEndpointNames = [...new Set(failures.map((f) => f.endpointName).filter(Boolean))] as string[];

  if (v11 && rep?.IsActive === true && failingEndpointNames.length > 0) {
    try {
      endpointWalk = await loadEndpointIndex(client);
      const byName = endpointWalk.byName;

      // M1. The three outcomes were previously two, and the collapse is the
      // whole defect: `if (!ep?.lastSeen) return true` counted "this name is not
      // in my index" as "this endpoint is stale". On a complete walk that
      // inference is sound — a name absent from the full listing really has been
      // renamed or deleted. On a bounded walk it is not an inference at all, it
      // is the page bound talking, and it always talks in the direction of a
      // worse verdict.
      const staleEndpoints: string[] = [];
      const unresolvedEndpoints: string[] = [];
      for (const name of failingEndpointNames) {
        const ep = byName.get(name.toLowerCase());
        if (!ep) {
          // Not in the index. Only means "gone" if the index is the whole estate.
          if (endpointWalk.truncated) {unresolvedEndpoints.push(name);}
          else {staleEndpoints.push(name);}
          continue;
        }
        if (!ep.lastSeen) {
          // Present in the listing and has genuinely never checked in. This is
          // a real observation, not an absence — WIN10CLIENT10 on the reference
          // estate is exactly this case — so it stays stale either way.
          staleEndpoints.push(name);
          continue;
        }
        const ageDays = (now - new Date(ep.lastSeen).getTime()) / DAY_MS;
        if (ageDays > staleAfterDays) {staleEndpoints.push(name);}
      }

      const errorBehavior = String(rep.ErrorBehavior ?? "");
      const planNew = errorBehavior === "PlanNew";

      // Truncation cannot falsify a positive: a stale endpoint that WAS resolved
      // is evidence no unread page can withdraw. It can only make a negative
      // undecidable — the unread pages might hold the stale endpoint that would
      // have flipped this. So the third state is `null`, not `false`.
      if (!planNew) {
        selfPerpetuating = false;
      } else if (staleEndpoints.length > 0) {
        selfPerpetuating = true;
      } else if (unresolvedEndpoints.length > 0) {
        selfPerpetuating = null;
      } else {
        selfPerpetuating = false;
      }

      const undecidable = selfPerpetuating === null;
      staleEndpointRisk = {
        endpointsBehindFailures: failingEndpointNames.length,
        neverOnlineWithin: `${staleAfterDays}d`,
        staleCount: staleEndpoints.length,
        staleEndpoints,
        // Named separately and never folded into `staleCount`: these endpoints
        // were not measured, and a count that mixes "measured stale" with "not
        // read" is the undercount-as-total failure in miniature.
        unresolvedCount: unresolvedEndpoints.length,
        unresolvedEndpoints,
        errorBehavior: rep.ErrorBehavior ?? null,
        endpointWalk: {
          rowsExamined: endpointWalk.rowsExamined,
          pagesFetched: endpointWalk.pagesFetched,
          totalPages: endpointWalk.totalPages,
          totalItems: endpointWalk.totalItems,
          truncated: endpointWalk.truncated,
          orderBy: ENDPOINT_ORDER_BY,
          maxPages: MAX_ENDPOINT_PAGES,
        },
        note: selfPerpetuating
          ? `RepeatedExecution is active with ErrorBehavior=PlanNew, and ${staleEndpoints.length} of ` +
            `${failingEndpointNames.length} endpoint(s) behind a failure have not checked in within ${staleAfterDays} ` +
            `day(s). A failed run is rescheduled automatically rather than stopping, so this job will keep retrying ` +
            `against endpoints that cannot currently succeed — the failure rate will not self-correct.`
          : undecidable
            ? `RepeatedExecution reschedules on failure (ErrorBehavior=PlanNew). Whether that is ` +
              `self-perpetuating could NOT be determined: the endpoint listing was read to page ` +
              `${endpointWalk.pagesFetched} of ${endpointWalk.totalPages}, and ${unresolvedEndpoints.length} ` +
              `endpoint(s) behind a failure were not found in the portion that was read. None of the endpoints ` +
              `that WERE resolved is stale, so this is reported as undetermined rather than as either verdict.`
            : planNew
              ? "RepeatedExecution reschedules on failure (ErrorBehavior=PlanNew), but every endpoint behind a " +
                "failure was resolved and is reachable within the staleness window, so this does not look " +
                "self-perpetuating."
              : null,
      };
    } catch (err) {
      const e = err as { message?: string };
      staleEndpointRisk = { unavailable: `endpoint lookup failed: ${e.message ?? "unknown error"}` };
      endpointLookupError = e.message ?? "unknown error";
    }
  }

  // ── Verdict ──────────────────────────────────────────────────────────────
  const failureRate = scoped.length > 0 ? failures.length / scoped.length : null;
  let verdict: string;
  if (fetchError) {
    verdict = "UNKNOWN — instance history could not be fetched";
  } else if (scoped.length === 0) {
    verdict = "UNKNOWN — no instance history for this job in the examined window";
  } else if (failureRate === 0) {
    verdict = "RELIABLE";
  } else if (failureRate! < 0.2) {
    verdict = "MOSTLY RELIABLE";
  } else if (failureRate! < 0.5) {
    verdict = "FLAKY";
  } else {
    verdict = "UNRELIABLE";
  }
  if (selfPerpetuating) {verdict = "UNRELIABLE — SELF-PERPETUATING";}

  // ── Completeness (M1/M4) ────────────────────────────────────────────────
  //
  // Assembled before the prose, because the prose depends on it. The shared
  // contract from `@bconnect/mcp-core` — see result-trust.ts for what
  // `resultTrustworthy: false` does and does not mean.
  //
  // The instance-history cap is a real condition, not a formality: `history.failed`,
  // `neverSucceeded` and `flappingInstances` are absolute counts rendered over a
  // bounded walk, so past the cap each is a floor. The failure *rate* survives
  // the bound (it is a rate over the newest N, and the walk is ordered
  // `Start desc`), which is why the verdict is qualified rather than withheld.
  const trust = assessResultTrust(
    fetchError
      ? `The instance history for this job could not be fetched: ${fetchError}. No reliability ` +
        `signal could be computed from history.`
      : null,
    truncated
      ? `The instance history was read to ${scoped.length} instance(s) across ${pagesFetched} page(s), ` +
        `bounded by ${boundedBy === "maxInstances" ? `maxInstances=${maxInstances}` : `MAX_HISTORY_PAGES=${MAX_HISTORY_PAGES}`}, out of ` +
        `${totalItems ?? "an unknown number of"} instance(s) the server reports for ` +
        `this job. Counts below are a floor over the most recent instances, not totals; the failure rate ` +
        `is a rate over that window.`
      : null,
    // The companion the endpoint walk below always had and this walk did not:
    // the module captured the envelope's totalItems, PUBLISHED it as
    // history.totalInstancesForThisJob, and never asserted it against what the
    // walk absorbed. Measured live: an empty page under an intact header made a
    // 40-instance job read "UNKNOWN — no instance history" with
    // resultTrustworthy TRUE beside the 40. Skipped when the fetch itself
    // failed (that path carries its own reason above) and when the walk was
    // TRUNCATED — a bounded walk is expected to absorb fewer rows than
    // totalItems, that condition belongs to the truncation reason alone, and a
    // by-design maxInstances sample is not an anomaly (adversarial review,
    // M1/M2).
    fetchError || truncated ? null : shortfallReason("The job-instance history walk", rowsExamined, totalItems),
    endpointWalk
      ? truncationReason("The endpoint listing", endpointWalk, "MAX_ENDPOINT_PAGES")
      : null,
    endpointWalk
      ? shortfallReason("The endpoint listing walk", endpointWalk.rowsExamined, endpointWalk.totalItems)
      : null,
    // `endpointWalk !== null` is the whole condition, and leaving it out was a
    // real defect — found by a different pass while writing coverage for this
    // file, and worth recording because it is the SAME failure family this fix
    // was addressing, pointing the other way.
    //
    // `selfPerpetuating` is declared `null` and only assigned inside
    // `if (v11 && rep?.IsActive === true && failingEndpointNames.length > 0)`.
    // So `null` means two different things: "we walked the listing and the
    // answer is genuinely undecidable", and "this signal never applied to this
    // job at all" — which is the overwhelming majority, since most jobs have no
    // RepeatedExecution and no recent failures.
    //
    // Conflating them put a specific, confident, FALSE sentence — "the endpoint
    // listing was bounded" — into ordinary diagnoses whose endpoint listing was
    // never requested (`meta.endpointWalk` is null), and dropped them to
    // `resultTrustworthy: false` for no reason. A fix against presenting
    // incomplete data as complete had started presenting complete data as
    // incomplete, which erodes the flag just as fast.
    selfPerpetuating === null && endpointWalk !== null
      ? `The self-perpetuating-failure signal is UNDETERMINED — the endpoint listing was bounded and some ` +
        `endpoints behind a failure were not in the portion read. Absence from staleEndpoints here means ` +
        `"not read", not "reachable".`
      : null,
    endpointLookupError
      ? `The endpoint listing could not be read (${endpointLookupError}), so the stale-endpoint and ` +
        `self-perpetuating-failure signals were not evaluated.`
      : null
  );
  const complete = trust.resultTrustworthy;

  // A verdict is a headline. Leaving "RELIABLE" unqualified over a partial read
  // and putting the qualification in `meta` would just move the lie one field to
  // the left — the same rule `get_security_posture` follows for its headline.
  if (!complete && !fetchError) {
    verdict = `${verdict} (PARTIAL READ — see meta.resultTrustworthyReasons)`;
  }

  const reasons: string[] = [];
  if (!complete) {
    reasons.push(
      `INCOMPLETE READ — this verdict is over what was read, not over everything that exists. ` +
        trust.resultTrustworthyReasons.join(" ")
    );
  }
  if (fetchError) {
    reasons.push(
      `Instance history could not be fetched for jobDefinitionId ${opts.jobDefinitionId}: ${fetchError}. ` +
        "This usually means the ID does not exist. No reliability signal can be computed without history."
    );
  }
  if (scoped.length > 0) {
    reasons.push(`${failures.length} of ${scoped.length} examined instance(s) failed (${pct(failures.length, scoped.length)}).`);
  }
  if (timeoutFailures.length > 0) {
    reasons.push(
      `${timeoutFailures.length} of ${failures.length} failure(s) (${pct(timeoutFailures.length, failures.length)}) are Execution timeout.` +
        (!v11
          ? " Configured timeout unknown — v1.1 was not read (see below), so whether a per-job limit exists cannot be determined here."
          : timeoutUnset
            ? " JobExecutionTimeout reads 0 on this job — no per-job limit is configured; the effective limit is a " +
              "bMS-level default neither v1.1 nor v2.0 exposes."
            : ` Configured JobExecutionTimeout: ${rawTimeout}.`)
    );
  }
  if (failures.length > timeoutFailures.length && failures.length > 0) {
    reasons.push(`${failures.length - timeoutFailures.length} failure(s) are non-timeout errors — see clusters below.`);
  }
  if (abortOnErrorRisk) {reasons.push(abortOnErrorRisk);}
  if (staleEndpointRisk && (staleEndpointRisk as { note?: string }).note) {
    reasons.push((staleEndpointRisk as { note: string }).note);
  }
  if (v11?.Destructive === true) {
    reasons.push("Job is flagged Destructive (contains a wipe step) — unreliability here carries higher stakes than a normal retry.");
  }
  if (neverSucceeded.length > 0) {
    reasons.push(`${neverSucceeded.length} instance(s) in the examined window have never once succeeded.`);
  }
  if (!v11) {
    reasons.push(`v1.1 configuration unavailable (${v11Result.reason}) — AbortOnError, Destructive and RepeatedExecution signals could not be evaluated.`);
  }

  const clusters = tally(failures, (f) => causeOf.get(f)!)
    .slice(0, 8)
    .map(([cause, count]) => ({ cause, count, share: pct(count, failures.length) }));

  return {
    query: {
      jobDefinitionId: opts.jobDefinitionId,
      sinceDays: opts.sinceDays ?? null,
      maxInstances,
      staleAfterDays,
    },
    job: {
      name: (def.name as string) ?? null,
      folder: def.folder ?? null,
      type: def.type ?? null,
      note: "get_job_definition returns only name/folder/type — the v2.0 definition carries no configuration.",
    },
    configuration: {
      source: v11 ? "bConnect v1.1" : null,
      available: Boolean(v11),
      unavailableReason: v11 ? null : v11Result.reason,
      destructive: v11 ? v11.Destructive === true : null,
      stepCount: stepTypes ? stepTypes.length : null,
      steps: stepTypes,
      jobExecutionTimeout: v11 ? (rawTimeout ?? null) : null,
      timeoutNote:
        v11 && timeoutUnset
          ? "Reported as 0 — no per-job override is set. This does NOT mean unlimited; it means the effective " +
            "limit is a bMS-level default neither API version exposes."
          : null,
      abortOnError,
      // D11: the field is omitted rather than serialised as `false` (32 of 162
      // jobs on the reference estate, zero explicit `false` values), so absence
      // and an explicit false are indistinguishable here. The note says that
      // without asserting which one the caller's bMS is doing.
      abortOnErrorNote: v11 && !abortPresent
        ? "Field absent from the v1.1 record for this job. Reported as 'false-or-unset' rather than false: " +
          "an absent field cannot be told apart from an explicit false here, so it is not coerced either way."
        : null,
      repeatedExecution: rep
        ? {
            isActive: rep.IsActive ?? null,
            intervalMinutes: rep.RepetitionEntries?.[0]?.Minutes ?? null,
            errorBehavior: rep.ErrorBehavior ?? null,
          }
        : null,
    },
    history: {
      instancesExamined: scoped.length,
      totalInstancesForThisJob: totalItems,
      pagesFetched,
      truncated,
      fetchError: fetchError ?? null,
      failed: failures.length,
      failureRate: failureRate == null ? null : pct(failures.length, scoped.length),
      neverSucceeded: neverSucceeded.length,
      flappingInstances: flapping.length,
      stateCensus: Object.fromEntries(tally(scoped, (i) => String(i.state ?? "(none)"))),
    },
    failureClusters: clusters,
    stepOutcomes,
    stepOutcomesNote,
    reliabilitySignals: {
      timeoutShare: failures.length > 0 ? pct(timeoutFailures.length, failures.length) : null,
      abortOnErrorRisk,
      staleEndpointRisk,
      selfPerpetuating,
    },
    verdict,
    reasons,
    meta: {
      // Aggregates one job's instance history, and instances are endpoint-derived
      // and therefore rights-scoped. See result-trust.ts.
      //
      // This was EXEMPT until 2026-08-16, on the argument that it is per-object
      // because the caller supplies the id. Measured, the argument does not hold:
      // the id bounds which job, not which ENDPOINTS' instances of it are visible.
      // On this estate the scoped key 404s the sub-resource outright — a key that
      // sees no job definition at all sees none of their instances — and the
      // refusal below is correct and complete for that case. But a profile that
      // grants a job definition while restricting endpoints is exactly what
      // delegated administration is, and it yields a SMALLER
      // totalInstancesForThisJob with resultTrustworthy true. That shape is
      // reachable and this estate cannot produce it, so it is disclosed rather
      // than argued away a second time.
      credentialScope: CREDENTIAL_SCOPE_NOTE,
      elapsedMs: Date.now() - startedAt,
      diagnosisComplete: Boolean(v11),
      missingSignals: missingSignals.length ? missingSignals : null,
      // The shared completeness contract (M4). Distinct from `diagnosisComplete`,
      // which is about whether v1.1 answered — a signal being unavailable is not
      // the same failure as a signal being computed over a partial read.
      ...trust,
      endpointWalk: endpointWalk
        ? {
            rowsExamined: endpointWalk.rowsExamined,
            pagesFetched: endpointWalk.pagesFetched,
            totalPages: endpointWalk.totalPages,
            totalItems: endpointWalk.totalItems,
            truncated: endpointWalk.truncated,
            orderBy: ENDPOINT_ORDER_BY,
            maxPages: MAX_ENDPOINT_PAGES,
          }
        : null,
      note:
        "Read-only. Failures classified on the `state` field the API returns, not by SearchQuery — SearchQuery " +
        "matches display text rather than the state enum, so it cannot be used to select failures. " +
        "Configuration read from bConnect v1.1 when available; if unavailable, this is a " +
        "partial diagnosis and meta.missingSignals names exactly what could not be evaluated.",
    },
  };
}
