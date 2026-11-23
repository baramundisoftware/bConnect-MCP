/**
 * Fields of the API key write tools, bMS 26R2 (#357).
 *
 * From the 26R2 spec: ApiKeyForCreation for create_api_key, and the PATCH
 * example of UpdateApiKey ("contains all modifiable ApiKey properties") for
 * update_api_key, with the patch paths exactly as that example spells them
 * (/Name, /ExpirationDate, …). The example writes booleans as strings ("true");
 * the tools send JSON booleans, as the ApiKey schema types them.
 *
 * One table drives the input schemas, the validation rules, the create body and
 * the JSON Patch, so they can't drift apart.
 */
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { CommonRules, patchFromArguments, protocolError, type JsonPatchOperation, type ValidationRule } from "@bconnect/mcp-core";

/** ApiKeyForCreation limits in the 26R2 spec. */
export const NAME_MAX = 256;
export const COMMENT_MAX = 4000;
const GUID = /^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface Field {
  path: string;
  schema: Record<string, unknown>;
  rule: ValidationRule;
}

const FIELDS: Readonly<Record<string, Field>> = {
  name: {
    path: "/Name",
    schema: { type: "string", minLength: 1, maxLength: NAME_MAX, description: `Name of the API key (1 to ${NAME_MAX} characters).` },
    rule: { name: "name", required: false, type: "string", minLength: 1, maxLength: NAME_MAX },
  },
  expirationDate: {
    path: "/ExpirationDate",
    schema: { type: "string", format: "date", description: "Expiration date, yyyy-MM-dd (e.g. 2027-06-30)." },
    rule: { name: "expirationDate", required: false, type: "string", pattern: DATE, message: "expirationDate must be a date as yyyy-MM-dd" },
  },
  comment: {
    path: "/Comment",
    schema: { type: "string", maxLength: COMMENT_MAX, description: `Comment (at most ${COMMENT_MAX} characters).` },
    rule: { name: "comment", required: false, type: "string", maxLength: COMMENT_MAX },
  },
  isActive: {
    path: "/IsActive",
    schema: { type: "boolean", description: "Whether the key is active and can be used." },
    rule: { name: "isActive", required: false, type: "boolean" },
  },
  isAvailableViaGateway: {
    path: "/IsAvailableViaGateway",
    schema: { type: "boolean", description: "Whether the key can be used via the baramundi Gateway." },
    rule: { name: "isAvailableViaGateway", required: false, type: "boolean" },
  },
  securityProfiles: {
    path: "/SecurityProfiles",
    schema: { type: "array", minItems: 1, items: { type: "string", format: "guid" }, description: "GUIDs of the security profiles the key gets (at least one). They decide what the key may do in bMS." },
    rule: { name: "securityProfiles", required: false, type: "array", minLength: 1 },
  },
};

const schemas = Object.fromEntries(Object.entries(FIELDS).map(([name, f]) => [name, f.schema]));

export const createApiKeySchema = {
  type: "object",
  properties: schemas,
  required: ["name"],
};

export const updateApiKeySchema = {
  type: "object",
  properties: { id: { type: "string", description: "GUID of the API key to change." }, ...schemas },
  required: ["id"],
  // id plus at least one field to change.
  minProperties: 2,
};

/** Each security profile must be a GUID: the validator checks the array, this its items. */
function checkSecurityProfiles(args: Record<string, unknown> | undefined): void {
  const profiles = args?.securityProfiles;
  if (Array.isArray(profiles) && profiles.some((p) => typeof p !== "string" || !GUID.test(p))) {
    throw protocolError(ErrorCode.InvalidParams, "Invalid parameters: every securityProfiles entry must be a security profile GUID");
  }
}

export const createApiKeyRules = (): ValidationRule[] => [
  { ...FIELDS.name.rule, required: true },
  ...Object.entries(FIELDS).filter(([name]) => name !== "name").map(([, f]) => f.rule),
];

export const updateApiKeyRules = (): ValidationRule[] => [
  CommonRules.guid("id"),
  ...Object.values(FIELDS).map((f) => f.rule),
];

/** The checks the rules can't express: security profile GUIDs; for update, at least one field. */
export function checkApiKeyArguments(tool: "create_api_key" | "update_api_key", args: Record<string, unknown> | undefined): void {
  checkSecurityProfiles(args);
  if (tool === "update_api_key" && updateApiKeyPatch(args ?? {}).length === 0) {
    throw protocolError(ErrorCode.InvalidParams, `update_api_key needs at least one field to change: ${Object.keys(FIELDS).join(", ")}.`);
  }
}

/** The create body: the declared fields the caller gave, under ApiKeyForCreation's names. */
export function createApiKeyBody(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(FIELDS).filter((name) => args[name] !== undefined).map((name) => [name, args[name]]));
}

/** The JSON Patch replacing each field the caller gave; empty when none. */
export function updateApiKeyPatch(args: Record<string, unknown>): JsonPatchOperation[] {
  return patchFromArguments(args, Object.fromEntries(Object.entries(FIELDS).map(([name, f]) => [name, f.path])));
}
