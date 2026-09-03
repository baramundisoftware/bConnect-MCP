/**
 * Is a bConnect job state a FAILURE?
 *
 * One implementation, deliberately. This lived in
 * `bconnect-jobs-mcp/src/modules/explain-job-failure.ts` with the comment
 * "Exported so diagnose-job.ts (and anything else diagnosing failures) shares
 * one classification, rather than growing a third copy that could drift" — and
 * then a third copy grew anyway, in the insights server's patch-readiness
 * composite, and it drifted: it enumerated only FinishedWithError and
 * RescheduledWithError, so a CANCELLED patch job reported as healthy. An
 * adversarial review found it. The classifier now lives in mcp-core, which is
 * where "anything else" can actually reach it.
 *
 * The X5 fix is preserved and is the subtle part: `Rescheduled` READS like a
 * failure and is not one — it means the last run succeeded and the job
 * re-armed, which is the steady state of a healthy recurring job. Treating it
 * as a failure once inflated a failure count from 19 to 46.
 * `RescheduledWithError` is the failure variant and still matches, because the
 * negative lookahead is anchored to the whole string.
 */
const FAILURE_STATE = /error|failed|abort|timeout|cancell?ed/i;
const NOT_A_FAILURE = /^rescheduled$/i;

export const isJobFailureState = (state: unknown): boolean => {
  const s = String(state ?? "");
  return FAILURE_STATE.test(s) && !NOT_A_FAILURE.test(s);
};

/**
 * The state family this module had no words for: the attempt CONCLUDED and the
 * job's work was never executed. In the 26R1 enum (`openapi-specs/26R1/
 * bConnect_Jobs.json`, `State`) that is `RequirementsNotMet` and
 * `SkippedDueToIncompatibility`.
 *
 * ── Why these are not simply failures ───────────────────────────────────────
 * Measured live 2026-08-26: this estate carried four `RequirementsNotMet`
 * instances, all of one "Pre-Condition (Client Time and Day)" job — machines
 * outside a time window, which is that job working AS DESIGNED
 * ("Job […] was not started …: The requirements are not fulfilled",
 * erroneousExecutions 0). Folding these into `isJobFailureState` would inflate
 * failure counts with designed behaviour — the X5 defect again, where
 * `Rescheduled` as a failure turned 19 into 46.
 *
 * ── Why they are not successes either ───────────────────────────────────────
 * The work did not happen. patch-readiness.ts documented exactly this — its
 * pre-fix classifier made "Cancelled, RequirementsNotMet and
 * SkippedDueToIncompatibility all read as success" — and the fix it adopted,
 * `isJobFailureState`, was MEASURED on 2026-08-26 to catch only `Cancelled` of
 * those three. The comment claimed a fix the code did not have, and the test
 * beside it exercised only the one state that worked. A patch-install instance
 * in either state is an endpoint that did not get patched, reading as healthy.
 *
 * So the classification is three-way, split across two predicates that are
 * DISJOINT by construction and tested against the vendor enum: a state is a
 * failure, or concluded-without-executing, or neither (in flight, waiting, or
 * succeeded). `Canceling` stays in neither — it is transitional, and becomes
 * `Cancelled` (a failure) when it lands.
 *
 * Substring style matches FAILURE_STATE, for the same reason: robust to
 * release-to-release variants without enumerating them here.
 */
const NOT_EXECUTED_STATE = /requirement|skipped|incompatib/i;

export const isJobNotExecutedState = (state: unknown): boolean => {
  const s = String(state ?? "");
  return NOT_EXECUTED_STATE.test(s) && !isJobFailureState(s);
};
