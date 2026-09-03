/**
 * Job-state classification, tested against the vendor's own enum.
 *
 * ── Why the population comes from the spec file and not a list here ─────────
 * This classifier's first defect was an enumerated copy that quietly missed
 * states (patch-readiness listed FinishedWithError/RescheduledWithError only,
 * so a Cancelled patch job read as healthy). Its second was the same shape one
 * layer up: the fix-comment claimed `RequirementsNotMet` and
 * `SkippedDueToIncompatibility` were now caught, the regex caught neither, and
 * the test beside the comment exercised only `Cancelled` — the one state that
 * worked. Measured 2026-08-26, with four live `RequirementsNotMet` rows in the
 * estate at the time.
 *
 * A state list hand-written HERE would be the same defect in a third place. So
 * the population is read from `openapi-specs/26R1/bConnect_Jobs.json`
 * (`components.schemas.State.enum`) — the vendor's enumeration — and the
 * hand-written part is only the PARTITION of that population. A state the
 * vendor adds in a future spec drop lands in no partition bucket and fails
 * loudly, instead of silently classifying as "neither".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isJobFailureState, isJobNotExecutedState } from "@bconnect/mcp-core";

// Same resolution declare-tools.test.ts uses for the same directory: correct
// in the working tree and in a publication cut, whose layouts are parallel.
const SPEC = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "openapi-specs",
  "26R1",
  "bConnect_Jobs.json"
);

const specStates: string[] = (
  JSON.parse(readFileSync(SPEC, "utf8")) as {
    components: { schemas: { State: { enum: string[] } } };
  }
).components.schemas.State.enum;

/**
 * The hand-written judgment, per 26R1 state. Everything else about this file
 * is derived. `Canceling` is deliberately NEITHER: it is transitional and
 * becomes `Cancelled` — a failure — when it lands; counting the transient
 * would double-report against the terminal state that follows it.
 */
const FAILURES = new Set(["FinishedWithError", "Cancelled", "RescheduledWithError"]);
const NOT_EXECUTED = new Set(["RequirementsNotMet", "SkippedDueToIncompatibility"]);

describe("the 26R1 spec enum, partitioned", () => {
  it("reads a real population from the spec (vacuity check)", () => {
    // Counted a second way: the enum this test walks must contain the anchors
    // the partition names, and be at least the 16 states 26R1 ships. An empty
    // or mis-navigated enum must fail here, not pass everything below over
    // nothing.
    expect(specStates.length).toBeGreaterThanOrEqual(16);
    expect(specStates).toContain("FinishedSuccessfully");
    expect(specStates).toContain("RequirementsNotMet");
    expect(new Set(specStates).size).toBe(specStates.length);
  });

  it("every spec state is classified, and the partition covers the enum exactly", () => {
    for (const state of specStates) {
      const expected = FAILURES.has(state)
        ? "failure"
        : NOT_EXECUTED.has(state)
          ? "not-executed"
          : "neither";
      const actual = isJobFailureState(state)
        ? "failure"
        : isJobNotExecutedState(state)
          ? "not-executed"
          : "neither";
      expect(`${state}: ${actual}`).toBe(`${state}: ${expected}`);
    }
    // The reverse direction: a partition entry naming a state the vendor no
    // longer ships is as stale as a missed one.
    for (const state of [...FAILURES, ...NOT_EXECUTED]) {
      expect(specStates).toContain(state);
    }
  });

  it("no state is both a failure and not-executed (disjoint by construction)", () => {
    for (const state of specStates) {
      expect(isJobFailureState(state) && isJobNotExecutedState(state)).toBe(false);
    }
  });
});

describe("the anchors that have each been a defect once", () => {
  it("Rescheduled is NOT a failure; RescheduledWithError is (X5)", () => {
    expect(isJobFailureState("Rescheduled")).toBe(false);
    expect(isJobFailureState("RescheduledWithError")).toBe(true);
  });

  it("RequirementsNotMet and SkippedDueToIncompatibility are not-executed, not failures", () => {
    // The two states the patch-readiness fix-comment claimed were caught and
    // were not. Not failures — the live estate produces RequirementsNotMet as
    // the designed outcome of a time-gated pre-condition job — but never
    // successes either: the work did not run.
    for (const s of ["RequirementsNotMet", "SkippedDueToIncompatibility"]) {
      expect(isJobFailureState(s)).toBe(false);
      expect(isJobNotExecutedState(s)).toBe(true);
    }
  });

  it("Canceling is neither: transitional, and Cancelled catches it when it lands", () => {
    expect(isJobFailureState("Canceling")).toBe(false);
    expect(isJobNotExecutedState("Canceling")).toBe(false);
    expect(isJobFailureState("Cancelled")).toBe(true);
  });
});

describe("inputs the wire can actually produce", () => {
  it("absent and empty states classify as neither, not as anything", () => {
    for (const v of [null, undefined, ""]) {
      expect(isJobFailureState(v)).toBe(false);
      expect(isJobNotExecutedState(v)).toBe(false);
    }
  });

  it("classification is case-insensitive, and catches the single-l US spelling", () => {
    expect(isJobFailureState("CANCELLED")).toBe(true);
    expect(isJobFailureState("Canceled")).toBe(true);
    expect(isJobNotExecutedState("requirementsnotmet")).toBe(true);
  });
});
