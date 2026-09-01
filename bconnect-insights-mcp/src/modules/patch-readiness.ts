/**
 * get_patch_readiness — "what needs patching, and is anything being done?"
 *
 * ── The question, and what it costs today ───────────────────────────────────
 * Measured live: 35,542 B across four tool calls in three servers. The highest
 * byte cost of any question measured, and the only one where the current answer
 * is genuinely HARD rather than merely expensive — it needs a join across
 * update management, compliance and jobs that a model does by hand and can get
 * wrong without knowing.
 *
 * ── What an independent audit changed, before a line was written ────────────
 * Six claims were re-derived by an auditor with the reasoning stripped out.
 * Four came back OVERSTATED and one clause REFUTED, and the corrections are the
 * design:
 *
 *  1. THE TWO PATCH SIGNALS DISAGREE. `missingCriticalUpdates` (Microsoft
 *     Update classification) and CVE detections are different populations, not
 *     two views of one. Measured live: missingCriticalUpdates 0 estate-wide
 *     while one endpoint carried 983 detections above CVSS 7. They are reported
 *     SEPARATELY and never summed. A reader who wants one number is asking a
 *     question bMS does not answer.
 *  2. ZERO USUALLY MEANS UNMEASURED. WIN10CLIENT4 reports
 *     `missingSecurityUpdates: 0` with `updateState: "InventoryOutdated"` and a
 *     `lastInventory` a YEAR stale. Every count here is gated on updateState
 *     and inventory age, and an ungated zero is never presented as clean.
 *  3. PATCH JOBS ARE IDENTIFIED STRUCTURALLY, NOT BY NAME. The claim that only
 *     a job's name identifies it was refuted: `steps[].type` carries
 *     `WindowsMicrosoftUpdateInstallation` / `...Inventory`, and this repo
 *     already keys on that pattern (scan-recency.ts, WindowsComplianceScan).
 *     Name matching is actively WRONG on this estate — `SETTING: Patching
 *     Active` is a variable-setting job, and the real patch job is named
 *     `UPDATE: Microsoft Updates (Patch Profile)`.
 *  4. `Rescheduled` IS SUCCESS for a recurring job — "last run succeeded, job
 *     re-armed" — and the enum carries a separate `RescheduledWithError`.
 *     Treating it as unknown would mark every healthy recurring patch job
 *     indeterminate. But `FinishedSuccessfully` can be an operator OVERRIDE
 *     masking a failed step, so the step states are checked too.
 *  5. THE POPULATIONS DIFFER: 23 update-management rows against 26 endpoints,
 *     5 never scanned, and non-Windows endpoints have no update-management row
 *     at all. The join has holes, and they are reported rather than dropped.
 *
 * ── One trap that does NOT apply here, checked rather than assumed ──────────
 * `list_update_management_endpoints` (the TOOL) drops page-constant columns, so
 * `missingCriticalUpdates` can vanish from `data[]` into `meta.constant`. This
 * composite reads the ROUTE directly, so no projection runs and the field is
 * always present — verified live before relying on it.
 */

import { CREDENTIAL_SCOPE_NOTE, sanitizeEstateText, isJobFailureState, isJobNotExecutedState } from "@bconnect/mcp-core";
import {
  type HttpLike,
  type DimensionUnavailable,
  isUnavailable,
  readRows,
  str,
  daysSince,
  isFutureBeyondSkew,
} from "./paged-read.js";

export interface PatchReadinessOptions {
  /** Inventory older than this many days makes a count untrustworthy. */
  inventoryStaleAfterDays?: number;
  /**
   * A vulnerability scan older than this many days makes a CVE count a
   * historical claim rather than a current one. SEPARATE from
   * inventoryStaleAfterDays on purpose: update-management inventory age and
   * vulnerability-scan age are different measurements of different populations,
   * and collapsing them into one knob is the same conflation this tool exists
   * to prevent. Default matches get_unpatched_endpoints' staleAfterDays.
   */
  scanStaleAfterDays?: number;
  /** Endpoints to name per list. Counts stay exact. */
  maxNamed?: number;
  /** Rows read per source. */
  pageSize?: number;
  now?: () => number;
}

const DEFAULTS = { inventoryStaleAfterDays: 30, scanStaleAfterDays: 30, maxNamed: 10, pageSize: 500 };

/**
 * Step types that ARE Microsoft patching. From the generated JobInstanceStepType
 * enum; the same technique scan-recency.ts uses for WindowsComplianceScan.
 *
 * Deliberately NOT including WindowsManagedSoftware / WindowsApplicationInstallation:
 * `PATCH: 3rd Party Patching (Weekly)` is built from those, and it updates
 * third-party applications rather than applying Microsoft updates. Calling it a
 * patch job would tell a reader Microsoft patching is running when it is not.
 */
const MS_PATCH_STEPS = new Set([
  "WindowsMicrosoftUpdateInstallation",
  "WindowsMicrosoftUpgradeInstallation",
]);
/** Reads update state without installing anything — evidence of measurement, not of patching. */
const MS_INVENTORY_STEPS = new Set(["WindowsMicrosoftUpdateInventory"]);

/**
 * State classification comes from mcp-core, NOT from a set enumerated here.
 *
 * A review found the enumerated version listed only FinishedWithError and
 * RescheduledWithError, so `Cancelled`, `RequirementsNotMet` and
 * `SkippedDueToIncompatibility` all read as success — a cancelled patch
 * programme would have reported zero problems. `explain-job-failure.ts` had
 * carried the canonical classifier for exactly this reason, with a comment
 * warning against "a third copy that could drift"; this was the third copy and
 * it drifted. It now lives in mcp-core where both servers can reach it, and it
 * keeps the X5 subtlety: `Rescheduled` is NOT a failure, `RescheduledWithError`
 * is.
 *
 * ── The fix above was itself half-claimed, measured 2026-08-26 ──────────────
 * The paragraph above stood while `isJobFailureState` caught only `Cancelled`
 * of the three named states, and the test beside it exercised only `Cancelled`.
 * `RequirementsNotMet` and `SkippedDueToIncompatibility` are not failures —
 * live, this estate produces `RequirementsNotMet` as the DESIGNED outcome of a
 * time-gated pre-condition job, so counting them failed would inflate exactly
 * as X5 did — but they are not successes either: the instance concluded
 * without executing, and a patch-install instance in either state is an
 * endpoint that did not get patched. They are now their own bucket,
 * `isJobNotExecutedState`, counted below as `notExecuted` rather than
 * disappearing into the healthy remainder.
 */
const isSuccessState = (state: string | null): boolean =>
  state !== null && state !== "" && !isJobFailureState(state) && !isJobNotExecutedState(state);

export interface PatchReadinessReport {
  query: { inventoryStaleAfterDays: number; scanStaleAfterDays: number; maxNamed: number; pageSize: number };
  headline: string[];
  microsoftUpdates: Record<string, unknown> | DimensionUnavailable;
  cveDetections: Record<string, unknown> | DimensionUnavailable;
  patchJobs: Record<string, unknown> | DimensionUnavailable;
  coverage: Record<string, unknown>;
  meta: {
    /** The unconditional estate-scope disclosure. See result-trust.ts. */
    credentialScope: string;
    dimensionsRead: number;
    dimensionsTotal: number;
    resultTrustworthy: boolean;
    resultTrustworthyReasons: string[];
    truncated: string[];
    note: string;
  };
}

export async function buildPatchReadiness(
  http: HttpLike,
  options: PatchReadinessOptions = {},
): Promise<PatchReadinessReport> {
  const o = {
    inventoryStaleAfterDays: options.inventoryStaleAfterDays ?? DEFAULTS.inventoryStaleAfterDays,
    scanStaleAfterDays: options.scanStaleAfterDays ?? DEFAULTS.scanStaleAfterDays,
    maxNamed: options.maxNamed ?? DEFAULTS.maxNamed,
    pageSize: options.pageSize ?? DEFAULTS.pageSize,
  };
  const now = (options.now ?? Date.now)();

  const umRaw = await readRows(http, "/updatemanagement/v2.0/WindowsEndpoints", o.pageSize);
  const cveRaw = await readRows(http, "/compliance/v2.0/DetectedVulnerabilities", o.pageSize);
  const jobRaw = await readRows(http, "/jobs/v2.0/JobInstances", o.pageSize);
  const epRaw = await readRows(http, "/endpoints/v2.0/Endpoints", o.pageSize);

  const headline: string[] = [];
  const truncated: string[] = [];
  for (const [label, r] of [["microsoftUpdates", umRaw], ["cveDetections", cveRaw], ["patchJobs", jobRaw], ["endpoints", epRaw]] as const) {
    if (!isUnavailable(r) && r.truncated) {truncated.push(label);}
  }

  // ── Microsoft Update state, gated on whether it was measured at all ───────
  let microsoftUpdates: Record<string, unknown> | DimensionUnavailable;
  const umByEndpoint = new Map<string, { name: string; critical: number; security: number; trustworthy: boolean }>();
  if (isUnavailable(umRaw)) {microsoftUpdates = umRaw;}
  else {
    const measured: Array<{ name: string; critical: number; security: number }> = [];
    const unmeasured: Array<{ endpoint: string; why: string }> = [];
    for (const row of umRaw.rows) {
      const name = sanitizeEstateText(str(row.endpointName) ?? "(unnamed)");
      const id = str(row.endpointId);
      const state = str(row.updateState);
      const invAge = daysSince(row.lastInventory, now);
      const critical = typeof row.missingCriticalUpdates === "number" ? row.missingCriticalUpdates : null;
      const security = typeof row.missingSecurityUpdates === "number" ? row.missingSecurityUpdates : null;

      // THE GATE. A count is only meaningful if the endpoint's inventory is
      // current and bMS does not itself say the inventory is outdated.
      const stale = invAge === null || invAge > o.inventoryStaleAfterDays;
      // WHITELIST. Blacklisting InventoryOutdated/Unknown let an ABSENT
      // updateState (the field is optional) and any value outside the enum pass
      // as trustworthy — a missing fact reading as a good one.
      const goodState = state === "Compliant" || state === "NonCompliant";
      const countsPresent = critical !== null && security !== null;
      const trustworthy = !stale && goodState && countsPresent;

      if (trustworthy) {measured.push({ name, critical: critical!, security: security! });}
      else {
        unmeasured.push({
          endpoint: name,
          why: !countsPresent ? "bMS reported no update counts for this endpoint"
            : !goodState ? `updateState is ${state ?? "absent"}`
            // A future-dated inventory is not "never inventoried" — saying so
            // would swap one wrong fact for another. It is a clock disagreement.
            : isFutureBeyondSkew(row.lastInventory, now)
              ? "bMS dates this inventory in the FUTURE — the clocks disagree, so its age is unknown"
            : invAge === null ? "never inventoried"
            : `inventory is ${invAge} days old`,
        });
      }
      if (id) {umByEndpoint.set(id, { name, critical: critical ?? 0, security: security ?? 0, trustworthy });}
    }
    const needing = measured.filter((m) => m.critical > 0 || m.security > 0);
    microsoftUpdates = {
      available: true as const,
      endpointsWithUpdateManagement: umRaw.totalItems ?? umRaw.rows.length,
      countsTrustworthy: measured.length,
      countsNotTrustworthy: unmeasured.length,
      endpointsMissingUpdates: needing.length,
      totalMissingCritical: needing.reduce((a, m) => a + m.critical, 0),
      totalMissingSecurity: needing.reduce((a, m) => a + m.security, 0),
      worst: needing
        .sort((a, b) => b.critical + b.security - (a.critical + a.security))
        .slice(0, o.maxNamed)
        .map((m) => ({ endpoint: m.name, missingCritical: m.critical, missingSecurity: m.security })),
      notTrustworthy: unmeasured.slice(0, o.maxNamed),
      gate: `A count is reported only where updateState is usable AND lastInventory is within ${o.inventoryStaleAfterDays} days. A zero from an un-inventoried endpoint is not a clean endpoint.`,
    };
    if (unmeasured.length > 0) {
      headline.push(
        `${unmeasured.length} of ${umRaw.rows.length} endpoints have NO trustworthy update count ` +
          `(stale or missing inventory) — their zeros mean unmeasured, not clean.`,
      );
    }
    if (needing.length > 0) {
      headline.push(`${needing.length} endpoint(s) are missing Microsoft updates.`);
    }
  }

  // ── CVE detections. A DIFFERENT population; never summed with the above ───
  let cveDetections: Record<string, unknown> | DimensionUnavailable;
  if (isUnavailable(cveRaw)) {cveDetections = cveRaw;}
  else {
    // Each endpoint's count carries the date of the scan that produced it.
    // `detected` is already on these rows, so this costs nothing extra —
    // scan-recency.ts measured 21 of 21 endpoints holding exactly ONE distinct
    // `detected` value across 2,531 rows, which is the scan writing its result
    // set in one pass. max(detected) is therefore the as-of date of the data,
    // and max() rather than first-row is the safe reduction regardless.
    const byEndpoint = new Map<string, { detections: number; scannedAt: string | null; scanAgeDays: number | null }>();
    let ignored = 0;
    for (const row of cveRaw.rows) {
      if (row.ignored === true) {ignored++; continue;}
      const name = sanitizeEstateText(str(row.endpointName) ?? "(unnamed)");
      const cur = byEndpoint.get(name) ?? { detections: 0, scannedAt: null, scanAgeDays: null };
      cur.detections++;
      // daysSince returns null for an absent, malformed or SENTINEL date, so a
      // .NET DateTime.MinValue cannot become a 739,839-day-old scan and an
      // absent date cannot become a recent one. Smallest age wins = newest.
      const age = daysSince(row.detected, now);
      if (age !== null && (cur.scanAgeDays === null || age < cur.scanAgeDays)) {
        cur.scannedAt = str(row.detected);
        cur.scanAgeDays = age;
      }
      byEndpoint.set(name, cur);
    }

    const dated = [...byEndpoint.values()].filter((v) => v.scanAgeDays !== null);
    const ages = dated.map((v) => v.scanAgeDays!).sort((a, b) => a - b);
    const median = ages.length === 0
      ? null
      : ages.length % 2 === 1
        ? ages[(ages.length - 1) / 2]
        : Math.floor((ages[ages.length / 2 - 1] + ages[ages.length / 2]) / 2);
    const staleScans = ages.filter((a) => a > o.scanStaleAfterDays).length;
    const undated = byEndpoint.size - dated.length;

    cveDetections = {
      available: true as const,
      detectionsInEstate: cveRaw.totalItems ?? cveRaw.rows.length,
      detectionsExamined: cveRaw.rows.length,
      ignoredInSample: ignored,
      endpointsAffectedInSample: byEndpoint.size,
      mostAffected: [...byEndpoint.entries()]
        .sort((a, b) => b[1].detections - a[1].detections)
        .slice(0, o.maxNamed)
        .map(([endpoint, v]) => ({
          endpoint,
          detections: v.detections,
          scannedAt: v.scannedAt,
          scanAgeDays: v.scanAgeDays,
          // null, not false: an undated scan is not a fresh one.
          scanIsStale: v.scanAgeDays === null ? null : v.scanAgeDays > o.scanStaleAfterDays,
        })),
      scanRecency: {
        staleAfterDays: o.scanStaleAfterDays,
        endpointsWithScanDate: dated.length,
        endpointsWithoutScanDate: undated,
        newestScanAgeDays: ages.length ? ages[0] : null,
        medianScanAgeDays: median,
        oldestScanAgeDays: ages.length ? ages[ages.length - 1] : null,
        staleEndpoints: staleScans,
        basis:
          "max(detected) per endpoint. This covers only endpoints that HAVE detections: an endpoint scanned clean carries no detection row and therefore no timestamp, so these figures are NOT estate-wide scan coverage. For that, and for the in-progress-scan case, use get_unpatched_endpoints in bconnect-compliance.",
      },
      currencyNote:
        "A detection records what was true when the scan ran, and nothing re-writes it. It cuts BOTH ways: a vulnerability patched since the scan still appears here, and anything installed since has never been checked against the CVE library. A count and its scan date must be read together — by count alone, a fresh scan on an exposed endpoint and an old scan on a clean one are indistinguishable.",
      severityNote:
        "This route carries no CVSS score. Use get_vulnerability_exposure for severity-ranked analysis.",
      populationNote:
        "CVE detections and Microsoft update counts are DIFFERENT populations and are never summed here. Measured on this estate, they disagree: zero missing critical updates alongside hundreds of CVE detections.",
    };
    if (byEndpoint.size > 0) {
      headline.push(`${cveRaw.totalItems ?? cveRaw.rows.length} CVE detection(s) across ${byEndpoint.size} endpoint(s) in the rows read.`);
    }
    if (staleScans > 0) {
      headline.push(
        `${staleScans} of ${dated.length} scanned endpoint(s) were last scanned more than ${o.scanStaleAfterDays} days ago ` +
          `(oldest ${ages[ages.length - 1]} days) — those counts describe scan time, not today.`,
      );
    }
    if (undated > 0) {
      headline.push(`${undated} endpoint(s) with detections carry NO scan date, so their counts cannot be dated at all.`);
    }
  }

  // ── Patch jobs, identified by STEP TYPE ──────────────────────────────────
  let patchJobs: Record<string, unknown> | DimensionUnavailable;
  const endpointsWithPatchJob = new Set<string>();
  if (isUnavailable(jobRaw)) {patchJobs = jobRaw;}
  else {
    let installs = 0, inventories = 0, failing = 0, overridden = 0, notExecuted = 0;
    let errorCountUnknown = 0;
    const failed: Array<{ endpoint: string; job: string; state: string | null }> = [];
    const didNotExecute: Array<{ endpoint: string; job: string; state: string }> = [];
    const pastFailed: Array<{ endpoint: string; job: string; errors: number; successes: number | null }> = [];

    // ── Identification needs two passes, and the reason is measured ──────────
    // `steps` is a RUNTIME record of the LAST execution, not configuration.
    // Measured live 2026-08-26, two ways: an instance that has never executed
    // carries no steps at all (the same definition's instances carry 3 steps
    // in one state and 0 in another — "INVENTORY: (Daily)", Queued — and every
    // RequirementsNotMet row on the estate had zero), and an instance that HAS
    // executed lists only the steps that last ran — BMS-SRV1's "UPDATE:
    // Microsoft Updates" instance, 5 successes, showed a single
    // WindowsInventory step after an inventory-only run and was therefore not
    // identified as a patch job at all. One-pass identification by steps[].type
    // silently dropped both populations: a patch job cancelled before first
    // execution was absent from notSucceeding, and BMS-SRV1 — which has a
    // patch job that has run five times — was accused of "missing updates AND
    // no patch-installation job". So: first collect the definitions that
    // step-bearing rows PROVE to be patch or inventory jobs, then classify
    // every instance of those definitions, whatever their own steps say. A
    // definition with no identifying step-bearing instance at all in the rows
    // read remains invisible — that limitation is disclosed in `identifiedBy`
    // rather than papered over with name matching, which this module rejects
    // for measured reasons (see identifiedBy).
    const patchDefIds = new Set<string>();
    const inventoryDefIds = new Set<string>();
    for (const row of jobRaw.rows) {
      const steps = Array.isArray(row.steps) ? (row.steps as Array<Record<string, unknown>>) : [];
      const defId = str(row.jobDefinitionId);
      if (!defId) {continue;}
      if (steps.some((s) => MS_PATCH_STEPS.has(String(s.type ?? "")))) {patchDefIds.add(defId);}
      if (steps.some((s) => MS_INVENTORY_STEPS.has(String(s.type ?? "")))) {inventoryDefIds.add(defId);}
    }

    for (const row of jobRaw.rows) {
      const steps = Array.isArray(row.steps) ? (row.steps as Array<Record<string, unknown>>) : [];
      const defId = str(row.jobDefinitionId);
      const isInstall =
        steps.some((s) => MS_PATCH_STEPS.has(String(s.type ?? ""))) ||
        (defId !== null && patchDefIds.has(defId));
      const isInventory =
        steps.some((s) => MS_INVENTORY_STEPS.has(String(s.type ?? ""))) ||
        (defId !== null && inventoryDefIds.has(defId));
      if (!isInstall && !isInventory) {continue;}
      if (isInstall) {installs++;} else {inventories++;}

      const epName = sanitizeEstateText(str(row.endpointName) ?? "(unnamed)");
      const epId = str(row.endpointId);
      if (isInstall && epId) {endpointsWithPatchJob.add(epId);}

      const state = str(row.state);
      const stepFailed = steps.some((s) => isJobFailureState(s.state));
      let surfacedByCurrentState = false;
      if (state && isJobFailureState(state)) {
        failing++;
        surfacedByCurrentState = true;
        failed.push({ endpoint: epName, job: sanitizeEstateText(str(row.jobDefinitionName) ?? "(unnamed)"), state });
      } else if (state && isJobNotExecutedState(state)) {
        // Concluded without executing: RequirementsNotMet or
        // SkippedDueToIncompatibility. Not a failure — live, RequirementsNotMet
        // is the designed outcome of a time-gated pre-condition job — but the
        // endpoint was NOT patched by this instance, so it must not vanish
        // into the healthy remainder, which is what it did until 2026-08-26.
        notExecuted++;
        surfacedByCurrentState = true;
        didNotExecute.push({ endpoint: epName, job: sanitizeEstateText(str(row.jobDefinitionName) ?? "(unnamed)"), state });
      } else if (isSuccessState(state) && stepFailed) {
        // The operator-override case the audit surfaced: the instance reads
        // successful while one of its own steps failed.
        overridden++;
        surfacedByCurrentState = true;
        failed.push({ endpoint: epName, job: sanitizeEstateText(str(row.jobDefinitionName) ?? "(unnamed)"), state: `${state} (a step failed)` });
      }

      // Deferred audit item M4, and this suite's own headline discovery
      // (WORKSTATION1: every current state clean, 27 erroneousExecutions in the
      // same rows). "Is patching working" answered from current state alone
      // hides every failed attempt that ended in a later success or a
      // reschedule. Rows already surfaced above are not double-reported; a row
      // with NO counter is not a row with zero errors and lands in its own
      // bucket, per the endpoint-briefing rule.
      const errors = typeof row.erroneousExecutions === "number" ? row.erroneousExecutions : null;
      if (errors === null) {
        errorCountUnknown++;
      } else if (errors > 0 && !surfacedByCurrentState) {
        pastFailed.push({
          endpoint: epName,
          job: sanitizeEstateText(str(row.jobDefinitionName) ?? "(unnamed)"),
          errors,
          successes: typeof row.successfulExecutions === "number" ? row.successfulExecutions : null,
        });
      }
    }
    pastFailed.sort((a, b) => b.errors - a.errors);
    patchJobs = {
      available: true as const,
      identifiedBy: "steps[].type — WindowsMicrosoftUpdateInstallation / …Upgrade… / …Inventory — plus every other instance of a definition so identified, because steps record only the LAST execution: a never-executed instance carries none, and an executed one can show only e.g. WindowsInventory after an inventory-only run (both measured 2026-08-26). A definition none of whose read instances ever ran an identifying step is NOT identified; that population is invisible here. NOT by job name: on this estate 'SETTING: Patching Active' is a variable job and the real patch job is named 'UPDATE: Microsoft Updates (Patch Profile)'.",
      installJobInstances: installs,
      inventoryJobInstances: inventories,
      notSucceeding: failing,
      succeededButAStepFailed: overridden,
      /** Instances that concluded WITHOUT executing — RequirementsNotMet /
       *  SkippedDueToIncompatibility. Not failures (the state can be a job's
       *  designed outcome), but the endpoint was not patched by them. */
      notExecuted,
      notExecutedExamples: didNotExecute.slice(0, o.maxNamed),
      failures: failed.slice(0, o.maxNamed),
      /** Instances whose CURRENT state reads clean while their history carries
       *  failed executions. Counted from erroneousExecutions, not state. */
      pastFailures: pastFailed.length,
      pastFailureExamples: pastFailed.slice(0, o.maxNamed),
      /** Rows carrying no execution counters — unknown history, never zero. */
      errorCountUnknown,
      rowsExamined: jobRaw.rows.length,
    };
    if (installs === 0) {
      headline.push("NO Microsoft patch-installation job instances were found in the rows read.");
    }
    if (failing + overridden > 0) {
      headline.push(`${failing + overridden} patch job instance(s) did not succeed (${overridden} report success while a step failed).`);
    }
    if (notExecuted > 0) {
      headline.push(
        `${notExecuted} patch job instance(s) concluded without executing — requirements not met, or skipped ` +
          `as incompatible. Not failures, but the endpoints they target were not patched by those instances; ` +
          `see patchJobs.notExecutedExamples.`,
      );
    }
    if (pastFailed.length > 0) {
      const worst = pastFailed[0];
      headline.push(
        `${pastFailed.length} patch job instance(s) carry failed executions in history that their ` +
          `current state does not show — worst is "${worst.job}" at ${worst.errors} error(s) to ` +
          `${worst.successes ?? "an unknown number of"} success(es).`,
      );
    }
  }

  // ── The join, and its holes ──────────────────────────────────────────────
  const allEndpoints = isUnavailable(epRaw) ? null : epRaw.rows.length;
  const noUpdateManagement = isUnavailable(epRaw) || isUnavailable(umRaw)
    ? null
    : epRaw.rows.filter((e) => !umByEndpoint.has(str(e.id) ?? "")).length;
  // "Needs patching and nothing is being done" — the set the question is about,
  // and the single most dangerous number in this report.
  //
  // It requires BOTH sources. If the jobs read failed, `endpointsWithPatchJob`
  // is empty and every exposed endpoint is accused of having no patch job — an
  // absence of DATA rendered as an absence of PATCHING. A review found the
  // degrade test already produced exactly that output while asserting nothing
  // about it. Unread is not good news, and here it is not bad news either: it
  // is null.
  const exposedWithoutJob = isUnavailable(umRaw) || isUnavailable(jobRaw)
    ? null
    : [...umByEndpoint.entries()]
        .filter(([id, v]) => v.trustworthy && (v.critical > 0 || v.security > 0) && !endpointsWithPatchJob.has(id))
        .map(([, v]) => v.name);

  const coverage = {
    endpointsInEstate: allEndpoints,
    endpointsWithoutUpdateManagement: noUpdateManagement,
    endpointsWithAPatchInstallJob: isUnavailable(jobRaw) ? null : endpointsWithPatchJob.size,
    endpointsMissingUpdatesWithNoPatchJob: exposedWithoutJob?.length ?? null,
    examples: (exposedWithoutJob ?? []).slice(0, o.maxNamed),
    note: "Populations differ: non-Windows endpoints have no update-management row at all, so 'without update management' is not by itself a fault.",
  };
  if (exposedWithoutJob && exposedWithoutJob.length > 0) {
    headline.unshift(
      `${exposedWithoutJob.length} endpoint(s) are missing Microsoft updates AND have no patch-installation job in the rows read.`,
    );
  }

  const dims = { microsoftUpdates, cveDetections, patchJobs };
  // FOUR sources are read, not three. /endpoints is one of them, and leaving it
  // out of this accounting meant a 403 there produced null coverage figures, no
  // INCOMPLETE line, and resultTrustworthy TRUE — a whole source vanishing
  // under a clean bill of health.
  const unread = [
    ...Object.entries(dims).filter(([, d]) => isUnavailable(d)),
    ...(isUnavailable(epRaw) ? ([["endpoints", epRaw]] as Array<[string, DimensionUnavailable]>) : []),
  ];
  if (unread.length) {
    headline.unshift(`INCOMPLETE: ${unread.length} of 4 sources could not be read (${unread.map(([k]) => k).join(", ")}).`);
  } else if (headline.length === 0) {
    // Reachable only when every count WAS trustworthy and nothing was found —
    // the previous wording claimed the opposite of the state it fires in.
    headline.push("Every endpoint has a current inventory, none is missing Microsoft updates, and no patch job failed.");
  }
  if (truncated.length) {
    headline.push(`Only the first ${o.pageSize} rows were read for: ${truncated.join(", ")}.`);
  }

  return {
    query: o,
    headline,
    ...dims,
    coverage,
    meta: {
      // An estate-wide aggregate, so it owes the scope disclosure. See
      // result-trust.ts. It is disclosed here even though this tool was
      // `resultTrustworthy: false` under BOTH credentials when measured: that
      // is an accident of THIS estate's stale inventory, not a property of the
      // tool. On a healthy estate the flag is true and the divergence — 138 leaf
      // paths, including endpointsWithUpdateManagement 23 -> 9 — is unmarked.
      credentialScope: CREDENTIAL_SCOPE_NOTE,
      // FOUR: update management, CVE detections, job instances, endpoints.
      dimensionsRead: 4 - unread.length,
      dimensionsTotal: 4,
      resultTrustworthy: unread.length === 0 && truncated.length === 0,
      resultTrustworthyReasons: [
        ...unread.map(([k, d]) => `${k}: ${(d as DimensionUnavailable).reason}`),
        ...truncated.map((t) => `${t}: more rows exist than were read`),
      ],
      truncated,
      note: "Microsoft update counts and CVE detections are separate populations and are never combined. Counts are reported only where the endpoint's inventory is current enough to trust them.",
    },
  };
}
