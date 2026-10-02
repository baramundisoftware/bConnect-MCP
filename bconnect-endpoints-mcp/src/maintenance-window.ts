/**
 * The interval rule of maintenance windows (#237, REQ-XC-003 AC 7).
 *
 * bMS rejects a window of type Anytime that still has intervals (live, bMS
 * 26.1.161: "The maintenance window of type 'Anytime' must not contain any
 * intervals"); the spec lists Never as interval-free too, and requires at least
 * one interval for every other type. The create and update tools check the rule
 * before sending, and an update to an interval-free type removes the intervals
 * the previous type left behind.
 */
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { JsonPatchOperation } from "@bconnect/mcp-core";

export const NO_INTERVALS: readonly string[] = ["Anytime", "Never"];

export const INTERVAL_RULE = "Anytime and Never take no intervals; Everyday, WorkdayWeekend and IndividualWeekday need at least one.";

const hasIntervals = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

/** Refuses a call bMS would reject: intervals with an interval-free type, or a type that needs intervals without them. */
export function checkIntervalRule(args: Record<string, unknown>): void {
  const type = args.maintenanceWindowDefinitionType;
  if (typeof type !== "string") {
    return;
  }
  if (NO_INTERVALS.includes(type)) {
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
