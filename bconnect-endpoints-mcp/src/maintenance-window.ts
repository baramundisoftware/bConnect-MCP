/**
 * The interval rule of maintenance windows (#237, REQ-XC-003 AC 7), per bMS release (REQ-SRV-031, #307).
 *
 * bMS rejects a window of type Anytime that still has intervals (live, bMS
 * 26.1.161: "The maintenance window of type 'Anytime' must not contain any
 * intervals"); the spec lists Never as interval-free too, and requires at least
 * one interval for every other type. 25R2 has neither Anytime nor Never: its
 * interval-free type is Unrestricted (its default). The tools leave 26R1's
 * Unrestricted out (REQ-SRV-031 Q2). The create and update tools check the rule
 * before sending, and an update to an interval-free type removes the intervals
 * the previous type left behind.
 */
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { JsonPatchOperation, Release } from "@bconnect/mcp-core";

/** The window types the tools offer per release (bundled specs), the default first. */
export const WINDOW_TYPES: Readonly<Record<Release, readonly string[]>> = {
  "26R1": ["Anytime", "Never", "Everyday", "WorkdayWeekend", "IndividualWeekday"],
  "25R2": ["Unrestricted", "Everyday", "WorkdayWeekend", "IndividualWeekday"],
};

/** The types that take no intervals, per release. */
const NO_INTERVALS_IN: Readonly<Record<Release, readonly string[]>> = {
  "26R1": ["Anytime", "Never"],
  "25R2": ["Unrestricted"],
};

export const NO_INTERVALS: readonly string[] = NO_INTERVALS_IN["26R1"];

/** The rule in words, for the tool descriptions. */
export const intervalRule = (release: Release): string => (release === "25R2"
  ? "Unrestricted takes no intervals; Everyday, WorkdayWeekend and IndividualWeekday need at least one."
  : "Anytime and Never take no intervals; Everyday, WorkdayWeekend and IndividualWeekday need at least one.");

export const INTERVAL_RULE = intervalRule("26R1");

const hasIntervals = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

/**
 * Refuses a call bMS would reject: a window type the release doesn't have, intervals with an
 * interval-free type, or a type that needs intervals without them.
 */
export function checkIntervalRule(args: Record<string, unknown>, release: Release = "26R1"): void {
  const type = args.maintenanceWindowDefinitionType;
  if (typeof type !== "string") {
    return;
  }
  if (!WINDOW_TYPES[release].includes(type)) {
    const hint = type === "Unrestricted" ? " Unrestricted isn't offered on 26R1: use Anytime for a window without restriction." : "";
    throw new McpError(ErrorCode.InvalidParams, `'${type}' isn't a maintenance window type of bMS ${release}: use ${WINDOW_TYPES[release].join(", ")}.${hint}`);
  }
  if (NO_INTERVALS_IN[release].includes(type)) {
    if (hasIntervals(args.intervals)) {
      throw new McpError(ErrorCode.InvalidParams, `A maintenance window of type '${type}' takes no intervals; leave intervals out.`);
    }
  } else if (!hasIntervals(args.intervals)) {
    throw new McpError(ErrorCode.InvalidParams, `A maintenance window of type '${type}' needs at least one interval; pass intervals with it.`);
  }
}

/** The update patch, plus the removal of the old intervals when the type changes to an interval-free one. */
export function withIntervalRemoval(args: Record<string, unknown>, patch: JsonPatchOperation[]): JsonPatchOperation[] {
  const type = args.maintenanceWindowDefinitionType;
  if (typeof type === "string" && NO_INTERVALS.includes(type) && !patch.some((op) => op.path === "/intervals")) {
    return [...patch, { op: "remove", path: "/intervals" }];
  }
  return patch;
}
