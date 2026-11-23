/**
 * Fields of the threshold write tools, bMS 26R2 (#355).
 *
 * From the 26R2 spec: ThresholdForCreation for create_threshold, and the PATCH
 * example of UpdateThreshold ("contains all modifiable threshold properties";
 * the group and the security profile can't be changed) for update_threshold,
 * with the patch paths exactly as that example spells them (/Value, /Type, …).
 * `type` leaves out the spec's "Unknown": it isn't a value to set.
 *
 * One table drives the input schemas, the validation rules, the create body and
 * the JSON Patch, so they can't drift apart.
 */
import { CommonRules, patchFromArguments, type JsonPatchOperation, type ValidationRule } from "@bconnect/mcp-core";

export const THRESHOLD_TYPES = ["UpperLimit", "LowerLimit"] as const;
export const THRESHOLD_SEVERITIES = ["Info", "Warning", "Error"] as const;
/** ThresholdForCreation.comment maxLength in the 26R2 spec. */
export const COMMENT_MAX = 4000;

interface Field {
  /** The UpdateThreshold patch path; absent for a field that can only be set at creation. */
  path?: string;
  schema: Record<string, unknown>;
  rule: ValidationRule;
}

const FIELDS: Readonly<Record<string, Field>> = {
  value: {
    path: "/Value",
    schema: { type: "integer", minimum: 0, description: "The value the group's endpoint count is compared with (0 or more)." },
    rule: { name: "value", required: false, type: "number", integer: true, min: 0 },
  },
  type: {
    path: "/Type",
    schema: { type: "string", enum: [...THRESHOLD_TYPES], description: "UpperLimit: notify when the endpoint count exceeds value; LowerLimit: when it falls below." },
    rule: { name: "type", required: false, type: "string", enum: [...THRESHOLD_TYPES] },
  },
  severity: {
    path: "/Severity",
    schema: { type: "string", enum: [...THRESHOLD_SEVERITIES], description: "Severity of the notification raised when the threshold is reached." },
    rule: { name: "severity", required: false, type: "string", enum: [...THRESHOLD_SEVERITIES] },
  },
  isActive: {
    path: "/IsActive",
    schema: { type: "boolean", description: "Whether the threshold is evaluated (true: right away)." },
    rule: { name: "isActive", required: false, type: "boolean" },
  },
  comment: {
    path: "/Comment",
    schema: { type: "string", maxLength: COMMENT_MAX, description: `Comment (at most ${COMMENT_MAX} characters).` },
    rule: { name: "comment", required: false, type: "string", maxLength: COMMENT_MAX },
  },
};

const UPDATABLE = Object.keys(FIELDS).filter((name) => FIELDS[name].path !== undefined);
const schemas = (names: readonly string[]): Record<string, unknown> => Object.fromEntries(names.map((name) => [name, FIELDS[name].schema]));

export const createThresholdSchema = {
  type: "object",
  properties: {
    dynamicGroupId: { type: "string", description: "GUID of the Universal Dynamic Group the threshold is for (can't be changed later)." },
    securityProfileId: { type: "string", description: "GUID of the security profile the notification is for (can't be changed later)." },
    ...schemas(Object.keys(FIELDS)),
  },
  required: ["dynamicGroupId", "securityProfileId"],
};

export const updateThresholdSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "GUID of the threshold to change." },
    ...schemas(UPDATABLE),
  },
  required: ["id"],
  // id plus at least one field to change.
  minProperties: 2,
};

export const createThresholdRules = (): ValidationRule[] => [
  CommonRules.guid("dynamicGroupId"),
  CommonRules.guid("securityProfileId"),
  ...Object.values(FIELDS).map((f) => f.rule),
];

export const updateThresholdRules = (): ValidationRule[] => [
  CommonRules.guid("id"),
  ...UPDATABLE.map((name) => FIELDS[name].rule),
];

/** The create body: the declared fields the caller gave, under ThresholdForCreation's names. */
export function createThresholdBody(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(["dynamicGroupId", "securityProfileId", ...Object.keys(FIELDS)].filter((name) => args[name] !== undefined).map((name) => [name, args[name]]));
}

/** The JSON Patch replacing each changeable field the caller gave; empty when none. */
export function updateThresholdPatch(args: Record<string, unknown>): JsonPatchOperation[] {
  return patchFromArguments(args, Object.fromEntries(UPDATABLE.map((name) => [name, FIELDS[name].path as string])));
}

/** The changeable fields, for the "nothing to change" message. */
export const UPDATABLE_THRESHOLD_FIELDS: readonly string[] = UPDATABLE;
