#!/usr/bin/env node

/**
 * bconnect-groups-mcp
 *
 * A Model Context Protocol server that provides group-scoped endpoint queries
 * for the baramundi bConnect REST API.
 *
 * Two read-only tools, one per operation (REQ-SRV-029, #174): list_group_members
 * (group kind, group id, member type) and list_ad_user_endpoints (AD user,
 * endpoint type). Each combination is one route, GET /endpoints/v2.0/{GroupKind}s/{id}/{Members};
 * the routes are in src/operations.ts, their releases and query parameters are generated.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { BConnectClient } from "./bconnect-client.js";
import type { GroupQueryParams, GroupsModule } from "./modules/groups.js";
import { validateOrThrow, toolErrorResult, pickArguments, declaredArgumentsOnly, queryParameters, queryProperties, withQueryProperties, withCountOnly, serverClients, runServer, withToolAnnotations, toolJsonResult, selectedRelease, withReleaseTools, refuseUnavailableTool, withVariantSelectors, withToolVariants, variantKey, refuseReplacedTool } from "@bconnect/mcp-core";
import { QUERY_PARAMETERS } from "./query-params.js";
import { TOOL_RELEASES } from "./tool-releases.js";
import { TOOL_METHODS } from "./tool-methods.js";
import { TOOL_VARIANTS } from "./tool-variants.js";
import { REPLACED_TOOLS } from "./replaced-tools.js";

/** The query parameters a route sends: exactly what it declares in the selected release (#179). */
const sends = (route: string): string[] => queryParameters(QUERY_PARAMETERS, selectedRelease(), route);
import type { BConnectCredentials } from "@bconnect/mcp-core";
import { TOOL_RULES } from "./utils/mcp-tool-validation-rules.js";

/** The path argument of each tool's routes. */
const PATH_ARGUMENT: Readonly<Record<string, string>> = {
  list_group_members: "groupId",
  list_ad_user_endpoints: "adUserId",
};

/**
 * The arguments a route takes besides its selectors (REQ-SRV-029): its path argument and its
 * query parameters (selected release, else the other one's). The core refuses any other.
 */
function routeArguments(key: string): string[] {
  return [PATH_ARGUMENT[key.slice(0, key.indexOf("["))], ...Object.keys(queryProperties(QUERY_PARAMETERS, selectedRelease(), key))];
}

/** Per route: the client call (one per API route; the request path is the old tools' path). */
const ROUTES: Readonly<Record<string, (groups: GroupsModule, id: string, query: GroupQueryParams) => Promise<unknown>>> = {
  "list_group_members[groupKind=LogicalGroup,memberType=]": (groups, id, query) => groups.getEndpointsByLogicalGroup(id, query),
  "list_group_members[groupKind=LogicalGroup,memberType=WindowsEndpoint]": (groups, id, query) => groups.getWindowsEndpointsByLogicalGroup(id, query),
  "list_group_members[groupKind=LogicalGroup,memberType=MacEndpoint]": (groups, id, query) => groups.getMacEndpointsByLogicalGroup(id, query),
  "list_group_members[groupKind=LogicalGroup,memberType=LinuxEndpoint]": (groups, id, query) => groups.getLinuxEndpointsByLogicalGroup(id, query),
  "list_group_members[groupKind=LogicalGroup,memberType=AndroidEndpoint]": (groups, id, query) => groups.getAndroidEndpointsByLogicalGroup(id, query),
  "list_group_members[groupKind=LogicalGroup,memberType=IOSEndpoint]": (groups, id, query) => groups.getIosEndpointsByLogicalGroup(id, query),
  "list_group_members[groupKind=LogicalGroup,memberType=NetworkEndpoint]": (groups, id, query) => groups.getNetworkEndpointsByLogicalGroup(id, query),
  "list_group_members[groupKind=LogicalGroup,memberType=IndustrialEndpoint]": (groups, id, query) => groups.getIndustrialEndpointsByLogicalGroup(id, query),
  "list_group_members[groupKind=LogicalGroup,memberType=LogicalGroup]": (groups, id, query) => groups.getLogicalGroupsByLogicalGroup(id, query),
  "list_group_members[groupKind=StaticGroup,memberType=]": (groups, id, query) => groups.getEndpointsByStaticGroup(id, query),
  "list_group_members[groupKind=StaticGroup,memberType=WindowsEndpoint]": (groups, id, query) => groups.getWindowsEndpointsByStaticGroup(id, query),
  "list_group_members[groupKind=StaticGroup,memberType=MacEndpoint]": (groups, id, query) => groups.getMacEndpointsByStaticGroup(id, query),
  "list_group_members[groupKind=StaticGroup,memberType=LinuxEndpoint]": (groups, id, query) => groups.getLinuxEndpointsByStaticGroup(id, query),
  "list_group_members[groupKind=StaticGroup,memberType=AndroidEndpoint]": (groups, id, query) => groups.getAndroidEndpointsByStaticGroup(id, query),
  "list_group_members[groupKind=StaticGroup,memberType=IOSEndpoint]": (groups, id, query) => groups.getIosEndpointsByStaticGroup(id, query),
  "list_group_members[groupKind=StaticGroup,memberType=NetworkEndpoint]": (groups, id, query) => groups.getNetworkEndpointsByStaticGroup(id, query),
  "list_group_members[groupKind=StaticGroup,memberType=IndustrialEndpoint]": (groups, id, query) => groups.getIndustrialEndpointsByStaticGroup(id, query),
  "list_group_members[groupKind=DynamicGroup,memberType=]": (groups, id, query) => groups.getEndpointsByDynamicGroup(id, query),
  "list_group_members[groupKind=DynamicGroup,memberType=WindowsEndpoint]": (groups, id, query) => groups.getWindowsEndpointsByDynamicGroup(id, query),
  "list_group_members[groupKind=UniversalDynamicGroup,memberType=]": (groups, id, query) => groups.getEndpointsByUDG(id, query),
  "list_group_members[groupKind=UniversalDynamicGroup,memberType=WindowsEndpoint]": (groups, id, query) => groups.getWindowsEndpointsByUDG(id, query),
  "list_group_members[groupKind=UniversalDynamicGroup,memberType=MacEndpoint]": (groups, id, query) => groups.getMacEndpointsByUDG(id, query),
  "list_group_members[groupKind=UniversalDynamicGroup,memberType=LinuxEndpoint]": (groups, id, query) => groups.getLinuxEndpointsByUDG(id, query),
  "list_group_members[groupKind=UniversalDynamicGroup,memberType=AndroidEndpoint]": (groups, id, query) => groups.getAndroidEndpointsByUDG(id, query),
  "list_group_members[groupKind=UniversalDynamicGroup,memberType=IOSEndpoint]": (groups, id, query) => groups.getIosEndpointsByUDG(id, query),
  "list_group_members[groupKind=UniversalDynamicGroup,memberType=NetworkEndpoint]": (groups, id, query) => groups.getNetworkEndpointsByUDG(id, query),
  "list_group_members[groupKind=UniversalDynamicGroup,memberType=IndustrialEndpoint]": (groups, id, query) => groups.getIndustrialEndpointsByUDG(id, query),
  "list_ad_user_endpoints[endpointType=]": (groups, id, query) => groups.getEndpointsByADUser(id, query),
  "list_ad_user_endpoints[endpointType=WindowsEndpoint]": (groups, id, query) => groups.getWindowsEndpointsByADUser(id, query),
  "list_ad_user_endpoints[endpointType=MacEndpoint]": (groups, id, query) => groups.getMacEndpointsByADUser(id, query),
  "list_ad_user_endpoints[endpointType=LinuxEndpoint]": (groups, id, query) => groups.getLinuxEndpointsByADUser(id, query),
  "list_ad_user_endpoints[endpointType=AndroidEndpoint]": (groups, id, query) => groups.getAndroidEndpointsByADUser(id, query),
  "list_ad_user_endpoints[endpointType=IOSEndpoint]": (groups, id, query) => groups.getIosEndpointsByADUser(id, query),
};

// ── Factory exported for testing ─────────────────────────────────────────────

export type { BConnectCredentials } from "@bconnect/mcp-core";

/** The server's bConnect clients: one shared by every tool call (REQ-SRV-023). */
const clients = serverClients(BConnectClient);

export function createServer(credentials?: BConnectCredentials): { server: Server } {
  const server = new Server(
    {
      name: "bconnect-groups-mcp",
      version: "26.1.9"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── ListToolsRequestSchema handler ─────────────────────────────────────────

  // The selector values and per-route properties follow the selected release (REQ-SRV-029).
  const toolCatalog = declaredArgumentsOnly(withVariantSelectors(TOOL_VARIANTS, TOOL_RELEASES, routeArguments, withQueryProperties(QUERY_PARAMETERS, () => selectedRelease(), async () => {
    return {
      tools: [
        {
          name: "list_group_members",
          description: "List the members of a group, one page at a time: its endpoints (all, or one memberType), or the child groups of a logical group (memberType LogicalGroup). Not every group kind has every member type; a call without a route is refused with the valid ones.",
          inputSchema: {
            type: "object",
            properties: {
              groupKind: { type: "string", description: "Kind of group." },
              groupId: { type: "string", description: "Group ID (GUID)" },
              memberType: { type: "string", description: "Member type; leave out for all endpoints." },
            },
            required: ["groupKind", "groupId"]
          }
        },
        {
          name: "list_ad_user_endpoints",
          description: "List the endpoints associated with an AD user, one page at a time; with endpointType, only that type's.",
          inputSchema: {
            type: "object",
            properties: {
              endpointType: { type: "string", description: "Endpoint type; leave out for all types." },
              adUserId: { type: "string", description: "AD user ID (GUID)" },
            },
            required: ["adUserId"]
          }
        },
      ]
    };
  })));
  server.setRequestHandler(ListToolsRequestSchema, withReleaseTools(TOOL_RELEASES, withToolAnnotations(TOOL_METHODS, toolCatalog.list)));

  // ── CallToolRequestSchema handler ───────────────────────────────────────────

  // A merged tool's call is checked against its routes for the selected release before anything else (REQ-SRV-029).
  // countOnly (#165): count with one 1-row request instead of loading a page.
  server.setRequestHandler(CallToolRequestSchema, withToolVariants(TOOL_VARIANTS, TOOL_RELEASES, routeArguments, withCountOnly(QUERY_PARAMETERS, () => selectedRelease(), async (request) => {
    const { name } = request.params;
    const args = request.params.arguments ?? {};
    // A removed per-kind, per-type tool answers with its replacement; it never runs (REQ-SRV-029).
    refuseReplacedTool(REPLACED_TOOLS, TOOL_RELEASES, name);
    // A tool the selected release lacks is refused by name first, before its arguments are
    // checked against a schema the release doesn't list, and before anything is sent (#159).
    refuseUnavailableTool(TOOL_RELEASES, name);
    // Refuse arguments the tool doesn't declare, before anything else (REQ-SRV-022).
    await toolCatalog.refuseUndeclared(name, args);

    // The route the arguments chose (checked by withToolVariants).
    const route = variantKey(TOOL_VARIANTS, name, args);
    if (route === undefined) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    // Validate arguments first — pure, no side effects, fails fast on bad input. Every route has rules.
    validateOrThrow(args, TOOL_RULES[route]());

    try {
      // The server's shared client (REQ-SRV-023). A ClientConfigError (e.g. missing
      // credentials) reaches the catch below and becomes a tool result (REQ-XC-001).
      const client = clients.get(credentials);
      // The path argument is a GUID: validated above.
      const data = await ROUTES[route](client.groups, String(args[PATH_ARGUMENT[name]]), pickArguments(args, sends(route)));
      return toolJsonResult(data);
    } catch (error) {
      // API errors, gate refusals and configuration errors are tool results the
      // model can read; only McpErrors stay protocol errors (REQ-XC-001).
      return toolErrorResult(error, selectedRelease());
    }
  })));

  return { server };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

runServer({ name: "bconnect-groups-mcp", createServer, clients });
