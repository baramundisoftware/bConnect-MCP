#!/usr/bin/env node

/**
 * bconnect-groups-mcp
 *
 * A Model Context Protocol server that provides group-scoped endpoint queries
 * for the baramundi bConnect REST API.
 *
 * Two read-only tools cover every route this server serves, all of the form:
 *   GET /endpoints/v2.0/{Container}/{id}/{MemberType}
 *
 * ── TOK-22: 33 tools became 2 ───────────────────────────────────────────────
 * This server used to advertise that single operation as a
 * {logical, static, dynamic, universalDynamic, adUser} x {any, android, ios,
 * linux, mac, network, windows, industrial, child-groups} matrix of 33 tools
 * (30 now: 26R1 removed the IndustrialEndpoints API and the three group-scoped
 * industrial routes went with it — see utils/group-member-matrix.ts):
 * 29,764 bytes of tools/list for 3,189 bytes of description text, the other
 * ~26.5 KB being 33 copies of one pagination-and-filter schema. Every client
 * paid it at session start.
 *
 * The 33 routes are all still reachable — see src/utils/group-member-matrix.ts,
 * which holds the sparse matrix as data and is what the collapsed tools
 * dispatch through. Nothing was dropped; `routeCount()` is asserted to be 33.
 *
 * This is a BREAKING surface change: the 33 old tool names are gone. None of
 * them appear in DEMO-RUN-OF-SHOW.md's protected set.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import express from "express";
// OPT-32 — the unified bootstrap. Read packages/mcp-core/src/run-server.ts
// before changing anything below: it records which behaviour each of the
// thirteen hand-written main()s had and which one survived.
import { runServer, shouldAutoStart, describeConnectionFailure } from "@bconnect/mcp-core";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { BConnectClient } from "./bconnect-client.js";
import {
  createClientProvider,
  serializeToolResult,
  // TOK-20 — declare the catalogue rather than hand-rolling the array, so the
  // write gate, the duplicate-name check and `declaredParameters()` all come
  // from one place. This server declares no write tools, so its advertised
  // surface is identical with the gate open and shut; the machinery is adopted
  // anyway so that stays true by construction rather than by accident.
  defineToolCatalogue,
  // TOK-29 / TOK-10 — one canonical wording for pagination, filters and ids.
  // `Page` is zero-indexed suite-wide; that contradiction is settled in
  // packages/mcp-core/src/schema-fragments.ts.
  paginationProperties,
  exactMatchFilters,
  guidProperty,
  enumProperty,
  includeSubfoldersProperty,
  countOnlyProperty,
  objectSchema,
  // TOK-25 — "how many?" for ~122 bytes instead of a full page of rows.
  isCountOnlyRequest,
  fetchCount,
  // INT-53 — one error channel: 400/403/404/429 come back as readable isError
  // results, faults stay protocol errors.
  handleToolError,
  toolTextResult,
  // Finding A2 / INT-53 — throw BareMcpError, never McpError, out of a request
  // handler: McpError bakes "MCP error <code>: " into .message and the SDK adds
  // it again client-side. See packages/mcp-core/src/protocol-error.ts.
  BareMcpError,
  // The endpoint-row projection. `list_group_members` returns the SAME row as
  // `list_endpoints` for every memberType but `childGroups`, so it uses the same
  // field list rather than a second copy of it — read its header in
  // packages/mcp-core/src/shape-response.ts before changing what it keeps.
  createListShaper,
  ENDPOINT_COMPACT_FIELDS,
  detailProperty,
  fieldsProperty,
  type ListEnvelope,
} from "@bconnect/mcp-core";
// LOCAL FIX (OPT-31 / SEC-1 / INT-49) — this file used to define its own
// validateToolArguments() whose switch had 33 fall-through case labels and no
// statements, while the fully implemented rules beside it were imported by
// nothing. See src/utils/mcp-tool-validation-rules.ts.
import {
  validateToolParameters,
  assertKnownParameters,
  resolveMemberType,
  resolveAdUserEndpointType,
  LIST_GROUP_MEMBERS,
  LIST_AD_USER_ENDPOINTS,
} from "./utils/mcp-tool-validation-rules.js";
import {
  AD_USER_ENDPOINT_TYPES,
  FILTER_NAMES,
  GROUP_KINDS,
  MEMBER_TYPES,
  adUserMethod,
  groupMemberMethod,
  isGroupKind,
} from "./utils/group-member-matrix.js";

// ── TLS verification (LOCAL FIX — OPT-33) ────────────────────────────────────
//
// This server reads BCONNECT_REJECT_UNAUTHORIZED where the other twelve read
// NODE_TLS_REJECT_UNAUTHORIZED; packages/mcp-core/src/client-provider.ts:83-86
// records that divergence as deliberate and it is documented in this server's
// README, so it is preserved here rather than renamed.
//
// What was NOT deliberate is that the two clients inside this one file
// disagreed: the runtime provider read BCONNECT_REJECT_UNAUTHORIZED while the
// startup connectivity check read NODE_TLS_REJECT_UNAUTHORIZED. On a
// self-signed bMS an operator who set the documented knob got a startup client
// that still verified, failed testConnection() and process.exit(1)'d before
// serving a single tool — and conversely a process that got past startup on
// NODE_TLS_REJECT_UNAUTHORIZED=0 would have had every tool call fail against
// the runtime client. Both now go through this one resolver, so startup
// verifies exactly what the tools will verify.
function rejectUnauthorizedFromEnv(): boolean {
  return process.env.BCONNECT_REJECT_UNAUTHORIZED !== "false";
}

// ── Tool catalogue (TOK-22 / TOK-20 / TOK-25) ────────────────────────────────
//
// Two tools, declared at module scope so the catalogue — and therefore the
// duplicate-name check and `declaredParameters()` — is built once and can be
// asserted directly by the tests.

/** The union of every value filter either tool can advertise. */
const allFilters = exactMatchFilters(...FILTER_NAMES);

/** The AD-user routes declare no Name/Dip filters; those are group-only. */
const adUserFilters = exactMatchFilters(
  ...FILTER_NAMES.filter((name) => name !== "Name" && name !== "Dip")
);

/**
 * The endpoint-row projection, and the one member type it must NOT be applied to.
 *
 * `list_group_members` was measured at 19,883 B for a 20-row page — the largest
 * single response in the suite, and 994 B per row — because it returns the full
 * 25-column endpoint record. The compact projection is the one already shipped
 * and reviewed for `list_endpoints`, so this adds no new field-selection
 * judgement.
 *
 * ── Except for `childGroups`, and this is not a detail ───────────────────────
 * The ranking recommended applying the endpoint field list "verbatim". Probed
 * live before doing so: `memberType: 'childGroups'` returns LOGICAL GROUP rows —
 * `{id, name, parentId, parent, comment, dip, defaultDomain}` — not endpoint
 * rows. `id` is the only field the two shapes share, so an endpoint projection
 * would reduce every child-group row to `{id}` and quietly discard its name and
 * parentage. That is not a compaction, it is the answer being deleted.
 *
 * So the projection is gated on the member type actually being an endpoint one.
 * `childGroups` keeps the raw passthrough; shaping it is a separate decision
 * about a different row, and `list_logical_groups` is where that row's
 * projection belongs.
 */
const shapeEndpointMembers = createListShaper({ compactFields: ENDPOINT_COMPACT_FIELDS });

/** Member types whose rows are endpoint records. Everything but `childGroups`. */
const CHILD_GROUPS_MEMBER_TYPE = "childGroups";

export const TOOLS = [
  {
    name: LIST_GROUP_MEMBERS,
    description:
      "List the members of a bConnect group: GET /{GroupKind}Groups/{groupId}/{MemberType}. " +
      "Replaces the 24 list_<type>_endpoints_by_<kind>_group tools. " +
      "The matrix is sparse: 'logical' serves every memberType; 'static' and 'universalDynamic' " +
      "serve all but 'childGroups'; 'dynamic' serves only 'endpoints' and 'windows'. An " +
      "unsupported pair is refused with the list of supported ones. " +
      "Filters depend on memberType — android/ios: DisplayName; windows: DisplayName, HostName, " +
      "Domain, EntraIdDeviceId; childGroups: Name, Dip, Domain; all others: " +
      "DisplayName, HostName. A filter the chosen route does not declare is refused here rather " +
      "than accepted and silently ignored by the API. includeSubfolders applies to 'logical' only. " +
      "Endpoint rows are compact by default — eleven fields including logicalGroupId, with what " +
      "was removed named in meta.projectedAway. childGroups rows are returned unprojected. Use " +
      "detail:true for the raw record, fields:[..] to pick columns, countOnly:true for the count.",
    inputSchema: objectSchema(
      {
        ...enumProperty("groupKind", GROUP_KINDS, "Kind of group holding the members."),
        ...guidProperty("groupId", "group"),
        ...enumProperty(
          "memberType",
          MEMBER_TYPES,
          "What to list (default 'endpoints' = any OS type; 'childGroups' = child logical groups)."
        ),
        ...paginationProperties,
        ...allFilters,
        ...includeSubfoldersProperty,
        ...countOnlyProperty,
        ...detailProperty,
        ...fieldsProperty,
      },
      ["groupKind", "groupId"]
    ),
  },
  {
    name: LIST_AD_USER_ENDPOINTS,
    description:
      "List the endpoints related to an Active Directory user: " +
      "GET /ADUsers/{adUserId}/{EndpointType}. Replaces the 6 " +
      "list_<type>_endpoints_by_ad_user tools. Filters depend on endpointType — android/ios: " +
      "DisplayName; windows: DisplayName, HostName, Domain, EntraIdDeviceId; all others: " +
      "DisplayName, HostName.",
    inputSchema: objectSchema(
      {
        ...guidProperty("adUserId", "AD user"),
        ...enumProperty(
          "endpointType",
          AD_USER_ENDPOINT_TYPES,
          "Endpoint type to list (default 'endpoints' = any OS type)."
        ),
        ...paginationProperties,
        ...adUserFilters,
        ...countOnlyProperty,
      },
      ["adUserId"]
    ),
  },
];

/**
 * TOK-20. This server has no write tools — every route is a GET — so the
 * advertised surface is the same with the gate open and shut. Declaring the
 * catalogue anyway is what keeps that a checked property instead of an
 * assumption, and it is where `declaredParameters()` (the unknown-key guard)
 * comes from.
 */
export const TOOL_CATALOGUE = defineToolCatalogue({ tools: TOOLS, write: [] });

/** name -> the property names its inputSchema declares. Built once. */
const DECLARED_PARAMETERS = TOOL_CATALOGUE.declaredParameters();

/**
 * Query parameters this server will forward upstream, and nothing else.
 *
 * LOCAL FIX — D14b / D14a. This was a four-key whitelist, so any filter added
 * to a tool's inputSchema would have been dropped here, in our own code, and
 * the caller would have received an unfiltered HTTP 200 — the same failure
 * shape as D6, but self-inflicted. It is still a whitelist rather than a spread
 * of the caller's arguments, so a caller cannot smuggle an arbitrary query
 * parameter through this server; it is now derived from the same constants the
 * schemas are built from, so it cannot fall behind them again.
 */
const FORWARDED_PARAMETERS: readonly string[] = [
  "SearchQuery",
  "Page",
  "PageSize",
  "OrderBy",
  ...FILTER_NAMES,
  "includeSubfolders",
];

function forwardedParameters(args: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const key of FORWARDED_PARAMETERS) {
    if (args[key] !== undefined) {
      params[key] = args[key];
    }
  }
  return params;
}

/** Every route in the matrix has this shape. */
type GroupQuery = (id: string, params?: Record<string, unknown>) => Promise<unknown>;

function queryFor(client: BConnectClient, method: string): GroupQuery {
  const groups = client.groups as unknown as Record<string, GroupQuery>;
  return (id, params) => groups[method].call(groups, id, params);
}

// ── Factory exported for testing ─────────────────────────────────────────────

export interface BConnectCredentials {
  baseUrl?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

export function createServer(credentials?: BConnectCredentials): { server: Server; getClient: () => BConnectClient } {
  const server = new Server(
    {
      name: "bconnect-groups-mcp",
      version: "26.1.8"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── ListToolsRequestSchema handler ─────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOL_CATALOGUE.listTools() };
  });

  // ── CallToolRequestSchema handler ───────────────────────────────────────────

  // ── Client lifetime (upstream finding R3) ─────────────────────────────────
  // Built lazily on first tool call, but held HERE, in createServer() scope,
  // not inside the tool-call handler where this used to live. A client
  // constructed per call rebuilt everything stateful it owned on every call,
  // which is why rate limiting never limited (B8) and why the response cache
  // could not have worked even once wired up (B7). The provider is per
  // session and re-keys itself if the resolved credentials change, so a
  // longer-lived client cannot leak across differently-credentialed callers.
  // See packages/mcp-core/src/client-provider.ts.
  const getClient = createClientProvider<BConnectClient>({
    // Enables the optional per-server credential convention
    // (BCONNECT_API_KEY__GROUPS); with no such variable set this
    // changes nothing. See mcp-core/server-scoped-credentials.ts.
    serverName: "bconnect-groups-mcp",
    factory: (config) => new BConnectClient(config),
    credentials,
    rejectUnauthorized: rejectUnauthorizedFromEnv,
    onMissingCredentials: () => {
      throw new BareMcpError(
        ErrorCode.InvalidRequest,
        "Missing required bConnect credentials: BCONNECT_BASE_URL and either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD"
      );
    },
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a: Record<string, unknown> = args ?? {};

    // Unknown keys first: per D6 bConnect answers 200 and ignores a parameter
    // it does not declare, so a misspelt filter is the one mistake that
    // produces a confident wrong answer rather than an error. The declared set
    // comes from the catalogue, i.e. from the schema itself.
    assertKnownParameters(name, a, DECLARED_PARAMETERS.get(name));

    // Then the rules — pure, no side effects, fails fast on bad input. This
    // now genuinely does that: the local stub it replaces was an empty switch
    // that returned silently for every tool (OPT-31 / SEC-1 / INT-49).
    validateToolParameters(name, a);

    const params = forwardedParameters(a);

    try {
      switch (name) {
        case LIST_GROUP_MEMBERS: {
          if (!isGroupKind(a.groupKind)) {
            throw new BareMcpError(
              ErrorCode.InvalidParams,
              `groupKind must be one of: ${GROUP_KINDS.join(", ")}.`
            );
          }
          const memberType = resolveMemberType(a);
          const method = groupMemberMethod(a.groupKind, memberType);
          if (method === undefined) {
            throw new BareMcpError(
              ErrorCode.InvalidParams,
              `memberType '${memberType}' is not available for groupKind '${a.groupKind}'.`
            );
          }
          const run = queryFor(getClient(), method);
          const groupId = String(a.groupId);
          if (isCountOnlyRequest(a)) {
            // TOK-25 — a page past the end returns the envelope with no rows:
            // the count in ~122 bytes instead of a 20-row page.
            const count = await fetchCount((probe) => run(groupId, probe), params);
            return toolTextResult(serializeToolResult(count));
          }
          const page = await run(groupId, params);
          // childGroups rows are logical groups, not endpoints — see
          // shapeEndpointMembers' header. Projecting them with an endpoint field
          // list would leave `{id}` and drop the group's own name.
          if (memberType === CHILD_GROUPS_MEMBER_TYPE) {
            return toolTextResult(serializeToolResult(page));
          }
          return toolTextResult(
            serializeToolResult(
              shapeEndpointMembers(page as ListEnvelope, {
                full: a.detail === true,
                fields: Array.isArray(a.fields) ? (a.fields as string[]) : undefined,
                args: a,
              })
            )
          );
        }

        case LIST_AD_USER_ENDPOINTS: {
          const endpointType = resolveAdUserEndpointType(a);
          const method = adUserMethod(endpointType);
          if (method === undefined) {
            throw new BareMcpError(
              ErrorCode.InvalidParams,
              `endpointType '${endpointType}' is not available for AD users.`
            );
          }
          const run = queryFor(getClient(), method);
          const adUserId = String(a.adUserId);
          if (isCountOnlyRequest(a)) {
            const count = await fetchCount((probe) => run(adUserId, probe), params);
            return toolTextResult(serializeToolResult(count));
          }
          return toolTextResult(serializeToolResult(await run(adUserId, params)));
        }

        default:
          throw new BareMcpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      // INT-53 — expected API failures (400/403/404/429) come back as readable
      // isError tool results; validation, gates and unknown-tool stay protocol
      // errors; 401/5xx/TLS/transport become InternalError with the message
      // unchanged from the hand-written catch-all this replaces.
      return handleToolError(error);
    }
  });

  // Difference 3 — hand the memoised provider back so runServer's startup
  // connectivity check probes the very client tool dispatch will use.
  return { server, getClient: getClient };
}

// ─── Entry point (OPT-32) ────────────────────────────────────────────────────
//
// This server used to hand-write ~85 lines of bootstrap. Every line of it is
// now in `runServer()`, which resolves the six ways the thirteen copies had
// drifted. Two consequences are visible from here and are deliberate:
//
//   - BCONNECT_BASE_URL has NO default any more. The old
//     `|| "https://bms.example.com:443/bconnect"` fallback sent real
//     credentials to a host the vendor does not control whenever the variable
//     was unset. Absent base URL is now exit 1, before any client is built.
//   - The startup connectivity check probes `getClient()` above — the client
//     tool dispatch uses — not a throwaway built from a second reading of the
//     environment. That is why `createServer` returns it.
//
// `express` is injected because mcp-core does not depend on it: this package
// pins ^4.21.0 while the workspace root hoists 5.x.
if (shouldAutoStart()) {
  void runServer({
    name: "bconnect-groups-mcp",
    createServer,
    http: { express },
  }).catch((error) => {
    console.error(`Fatal error: ${describeConnectionFailure(error)}`);
    process.exit(1);
  });
}
