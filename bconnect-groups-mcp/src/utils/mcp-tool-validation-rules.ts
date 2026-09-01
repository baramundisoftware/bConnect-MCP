/**
 * MCP Tool Validation Rules — bconnect-groups-mcp
 *
 * Input validation for the two tools this server now advertises:
 * `list_group_members` and `list_ad_user_endpoints`.
 *
 * ── Why this file exists at all (OPT-31 / SEC-1 / INT-49) ───────────────────
 * src/index.ts once ran a local `validateToolArguments()` whose switch had 33
 * fall-through case labels and no statements, so a caller-supplied group id went
 * straight into a template-literal URL path. `basePath` is only a prefix, so a
 * `../` segment escaped the module: the sibling servers' live evidence is
 * `get_job_definition {id: "../../../servermanagement/v2.0/ApiKeys"}` returning
 * the bMS API-key inventory. `validateToolParameters()` below is what
 * src/index.ts calls, and every id still goes through `assertSafePathSegment()`
 * from @bconnect/mcp-core before anything else — belt and braces beside GUID
 * validation, so a traversal attempt keeps producing a precise -32602 even if a
 * rule is later loosened from GUID to a free-form id.
 *
 * ── What the TOK-22 collapse added here ─────────────────────────────────────
 * Two enums replaced 33 tool names, and the validation had to grow to match,
 * because the surface a tool advertises is now WIDER than the route it will
 * call. Three checks exist for that reason and would be pointless without the
 * collapse:
 *
 *   1. unknown parameters are refused (`assertKnownParameters`). Per D6 the API
 *      answers 200 and ignores what it does not recognise, so a misspelt filter
 *      used to produce a confident, unfiltered answer. The declared set comes
 *      from the tool catalogue itself, so it cannot drift from the schema.
 *   2. an unsupported (groupKind, memberType) pair is refused with the list of
 *      pairs that kind does support — the matrix is sparse (dynamic groups
 *      serve only `endpoints` and `windows`; `childGroups` exists only under
 *      `logical`), and 12 of the 45 name-able combinations are not real.
 *   3. a filter the chosen route does not declare is refused, naming the ones it
 *      does. Advertising the union once is the token saving; refusing the
 *      inapplicable members of that union is what stops the saving from
 *      becoming D6 by construction.
 *
 * All three are caller-correctable mistakes in the request itself, so they are
 * protocol errors (-32602) rather than `isError` results — the split INT-53
 * draws in @bconnect/mcp-core/tool-error.ts.
 */

import {
  ValidationRule,
  CommonRules,
  validateOrThrow,
  assertSafePathSegment,
  BareMcpError,
} from "@bconnect/mcp-core";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import {
  AD_USER_ENDPOINT_TYPES,
  DEFAULT_MEMBER_TYPE,
  FILTER_NAMES,
  GROUP_KINDS,
  MEMBER_TYPES,
  explainRemovedMemberType,
  filtersFor,
  groupMemberMethod,
  isAdUserEndpointType,
  isGroupKind,
  isMemberType,
  supportedMemberTypes,
  supportsSubfolders,
  type AdUserEndpointType,
  type GroupKind,
  type MemberType,
} from "./group-member-matrix.js";

/** Tool names this server advertises. Exported so the tests cannot misspell them. */
export const LIST_GROUP_MEMBERS = "list_group_members";
export const LIST_AD_USER_ENDPOINTS = "list_ad_user_endpoints";

const paginationRules = (): ValidationRule[] => [
  CommonRules.page(),
  CommonRules.pageSize(),
  CommonRules.searchQuery(),
  CommonRules.orderBy(),
];

/** Every advertised filter is an optional string; applicability is checked separately. */
const filterRules = (names: readonly string[]): ValidationRule[] =>
  names.map((name): ValidationRule => ({
    name,
    required: false,
    type: "string",
    minLength: 1,
    maxLength: 255,
  }));

const booleanRule = (name: string): ValidationRule => ({ name, required: false, type: "boolean" });

export const GroupsRules = {
  listGroupMembers: (): ValidationRule[] => [
    CommonRules.guid("groupId"),
    { name: "groupKind", required: true, type: "string", enum: [...GROUP_KINDS] },
    { name: "memberType", required: false, type: "string", enum: [...MEMBER_TYPES] },
    ...paginationRules(),
    ...filterRules(FILTER_NAMES),
    booleanRule("includeSubfolders"),
    booleanRule("countOnly"),
    // The tool declares detail/fields, so the rules must accept them.
    // `assertKnownParameters` builds its allowlist from the declared schema and
    // refuses anything else with -32602 BEFORE dispatch — so without these two
    // the projection's own "Pass detail:true for the full API record" hint would
    // be a lie the first time anyone followed it.
    booleanRule("detail"),
    { name: "fields", required: false, type: "array" },
  ],

  listAdUserEndpoints: (): ValidationRule[] => [
    CommonRules.guid("adUserId"),
    { name: "endpointType", required: false, type: "string", enum: [...AD_USER_ENDPOINT_TYPES] },
    ...paginationRules(),
    ...filterRules(FILTER_NAMES.filter((f) => f !== "Name" && f !== "Dip")),
    booleanRule("countOnly"),
  ],
};

function invalid(message: string): never {
  throw new BareMcpError(ErrorCode.InvalidParams, message);
}

/**
 * Refuse any argument the tool's own `inputSchema` does not declare.
 *
 * @param declared property names from `catalogue.declaredParameters()` — the
 *                 schema itself, so this check cannot drift away from it.
 */
export function assertKnownParameters(
  toolName: string,
  args: Record<string, unknown> | undefined,
  declared: ReadonlySet<string> | undefined
): void {
  if (!declared) {
    return;
  }
  const unknown = Object.keys(args ?? {}).filter((key) => !declared.has(key));
  if (unknown.length > 0) {
    invalid(
      `Unknown parameter(s) for ${toolName}: ${unknown.join(", ")}. ` +
        `This tool accepts: ${[...declared].join(", ")}. ` +
        "bConnect answers HTTP 200 and ignores parameters it does not declare, so an " +
        "unrecognised one would have produced an unfiltered result that looks filtered."
    );
  }
}

/** The member type asked for, defaulted. Assumes enum validation has run. */
export function resolveMemberType(args: Record<string, unknown> | undefined): MemberType {
  const value = args?.memberType;
  return isMemberType(value) ? value : DEFAULT_MEMBER_TYPE;
}

/** The AD-user endpoint type asked for, defaulted. */
export function resolveAdUserEndpointType(
  args: Record<string, unknown> | undefined
): AdUserEndpointType {
  const value = args?.endpointType;
  return isAdUserEndpointType(value) ? value : DEFAULT_MEMBER_TYPE;
}

/** Refuse a filter the chosen route does not declare, naming the ones it does. */
function assertFiltersApply(
  args: Record<string, unknown> | undefined,
  memberType: MemberType,
  selector: string
): void {
  const allowed = filtersFor(memberType);
  const offered = FILTER_NAMES.filter(
    (name) => args?.[name] !== undefined && !allowed.includes(name)
  );
  if (offered.length > 0) {
    invalid(
      `Filter(s) ${offered.join(", ")} do not apply to ${selector} '${memberType}'. ` +
        (allowed.length > 0
          ? `That route declares: ${allowed.join(", ")}.`
          : "That route declares no value filters.")
    );
  }
}

function assertGroupCombination(args: Record<string, unknown> | undefined, kind: GroupKind): MemberType {
  const memberType = resolveMemberType(args);
  if (groupMemberMethod(kind, memberType) === undefined) {
    invalid(
      `memberType '${memberType}' is not available for groupKind '${kind}'. ` +
        `That group kind supports: ${supportedMemberTypes(kind).join(", ")}.`
    );
  }
  if (args?.includeSubfolders !== undefined && !supportsSubfolders(kind)) {
    invalid(
      `includeSubfolders applies to groupKind 'logical' only; '${kind}' groups have no ` +
        "sub-group hierarchy. Omit it rather than sending it — bConnect would accept the " +
        "request with HTTP 200 and ignore the flag."
    );
  }
  assertFiltersApply(args, memberType, "memberType");
  return memberType;
}

/**
 * Run the path-segment guard over the id this tool interpolates into its URL,
 * then the rule set. The guard runs first so a traversal attempt is reported as
 * a traversal rather than as bad GUID formatting.
 */
function validate(
  args: Record<string, unknown> | undefined,
  rules: ValidationRule[],
  pathSegment: string
): void {
  const value = args?.[pathSegment];
  if (value !== undefined && value !== null) {
    assertSafePathSegment(value, pathSegment);
  }
  validateOrThrow(args, rules);
}

/**
 * Dispatch function — validates tool parameters by tool name.
 *
 * Called from the CallTool handler in src/index.ts before any client is built.
 * Unknown names fall through untouched; dispatch answers those with
 * MethodNotFound.
 */
export function validateToolParameters(
  toolName: string,
  args: Record<string, unknown> | undefined
): void {
  switch (toolName) {
    case LIST_GROUP_MEMBERS: {
      // Decision 4 — a value that was removed rather than mistyped must say so.
      // This runs BEFORE the enum rule, because the enum rule's message is
      // "memberType must be one of: endpoints, android, ..." and a caller
      // written against v26.1.7 reading that would conclude they had a typo,
      // then look for the right spelling of a thing that no longer exists.
      const removed = explainRemovedMemberType(args?.memberType);
      if (removed !== undefined) {
        invalid(removed);
      }
      validate(args, GroupsRules.listGroupMembers(), "groupId");
      // Only reachable once the enum rule above has accepted `groupKind`.
      const kind = args?.groupKind;
      if (isGroupKind(kind)) {
        assertGroupCombination(args, kind);
      }
      return;
    }

    case LIST_AD_USER_ENDPOINTS: {
      validate(args, GroupsRules.listAdUserEndpoints(), "adUserId");
      assertFiltersApply(args, resolveAdUserEndpointType(args), "endpointType");
      return;
    }

    default:
      // Unknown tool — no validation rules defined; dispatch answers with
      // MethodNotFound.
      break;
  }
}
