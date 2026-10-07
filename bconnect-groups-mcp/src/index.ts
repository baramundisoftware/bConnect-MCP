#!/usr/bin/env node

/**
 * bconnect-groups-mcp
 *
 * A Model Context Protocol server that provides group-scoped endpoint queries
 * for the baramundi bConnect REST API.
 *
 * All 33 tools are read-only GET operations following the pattern:
 *   GET /v2.0/{GroupType}/{groupId}/{EndpointType}
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { BConnectClient } from "./bconnect-client.js";
import { validateOrThrow, toolErrorResult, pickArguments, declaredArgumentsOnly, queryParameters, withQueryProperties, withCountOnly, serverClients, runServer, withToolAnnotations, toolJsonResult, selectedRelease, withReleaseTools, refuseUnavailableTool } from "@bconnect/mcp-core";
import { QUERY_PARAMETERS } from "./query-params.js";
import { TOOL_RELEASES } from "./tool-releases.js";
import { TOOL_METHODS } from "./tool-methods.js";

/** The query parameters a list tool sends: exactly what its route declares in the selected release (#179). */
const sends = (tool: string): string[] => queryParameters(QUERY_PARAMETERS, selectedRelease(), tool);
import type { BConnectCredentials } from "@bconnect/mcp-core";
import { TOOL_RULES } from "./utils/mcp-tool-validation-rules.js";

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

  const logicalGroupIdProp  = { logicalGroupId:          { type: "string", description: "GUID of the logical group"           } };
  const staticGroupIdProp   = { staticGroupId:            { type: "string", description: "GUID of the static group"            } };
  const dynamicGroupIdProp  = { dynamicGroupId:           { type: "string", description: "GUID of the dynamic group"           } };
  const udgIdProp           = { universalDynamicGroupId:  { type: "string", description: "GUID of the universal dynamic group" } };

  // ── ListToolsRequestSchema handler ─────────────────────────────────────────

  const toolCatalog = declaredArgumentsOnly(withQueryProperties(QUERY_PARAMETERS, () => selectedRelease(), async () => {
    return {
      tools: [
        // ── Logical Group (9) ──────────────────────────────────────────────
        {
          name: "list_endpoints_by_logical_group",
          description: "List all endpoints (any OS type) belonging to a logical group. Returns paginated endpoint list with GUIDs and properties.",
          inputSchema: { type: "object", properties: { ...logicalGroupIdProp }, required: ["logicalGroupId"] }
        },
        {
          name: "list_android_endpoints_by_logical_group",
          description: "List Android endpoints belonging to a logical group. Returns paginated Android endpoint list.",
          inputSchema: { type: "object", properties: { ...logicalGroupIdProp }, required: ["logicalGroupId"] }
        },
        {
          name: "list_ios_endpoints_by_logical_group",
          description: "List iOS endpoints belonging to a logical group. Returns paginated iOS endpoint list.",
          inputSchema: { type: "object", properties: { ...logicalGroupIdProp }, required: ["logicalGroupId"] }
        },
        {
          name: "list_linux_endpoints_by_logical_group",
          description: "List Linux endpoints belonging to a logical group. Returns paginated Linux endpoint list.",
          inputSchema: { type: "object", properties: { ...logicalGroupIdProp }, required: ["logicalGroupId"] }
        },
        {
          name: "list_mac_endpoints_by_logical_group",
          description: "List macOS endpoints belonging to a logical group. Returns paginated Mac endpoint list.",
          inputSchema: { type: "object", properties: { ...logicalGroupIdProp }, required: ["logicalGroupId"] }
        },
        {
          name: "list_network_endpoints_by_logical_group",
          description: "List network endpoints belonging to a logical group. Returns paginated network endpoint list.",
          inputSchema: { type: "object", properties: { ...logicalGroupIdProp }, required: ["logicalGroupId"] }
        },
        {
          name: "list_windows_endpoints_by_logical_group",
          description: "List Windows endpoints belonging to a logical group. Returns paginated Windows endpoint list.",
          inputSchema: { type: "object", properties: { ...logicalGroupIdProp }, required: ["logicalGroupId"] }
        },
        {
          name: "list_industrial_endpoints_by_logical_group",
          description: "List industrial endpoints belonging to a logical group. Returns paginated industrial endpoint list.",
          inputSchema: { type: "object", properties: { ...logicalGroupIdProp }, required: ["logicalGroupId"] }
        },
        {
          name: "list_logical_groups_by_logical_group",
          description: "List child logical groups belonging to a parent logical group. Returns paginated logical group list.",
          inputSchema: { type: "object", properties: { ...logicalGroupIdProp }, required: ["logicalGroupId"] }
        },

        // ── Static Group (8) ──────────────────────────────────────────────
        {
          name: "list_endpoints_by_static_group",
          description: "List all endpoints (any OS type) belonging to a static group. Returns paginated endpoint list.",
          inputSchema: { type: "object", properties: { ...staticGroupIdProp }, required: ["staticGroupId"] }
        },
        {
          name: "list_android_endpoints_by_static_group",
          description: "List Android endpoints belonging to a static group. Returns paginated Android endpoint list.",
          inputSchema: { type: "object", properties: { ...staticGroupIdProp }, required: ["staticGroupId"] }
        },
        {
          name: "list_ios_endpoints_by_static_group",
          description: "List iOS endpoints belonging to a static group. Returns paginated iOS endpoint list.",
          inputSchema: { type: "object", properties: { ...staticGroupIdProp }, required: ["staticGroupId"] }
        },
        {
          name: "list_linux_endpoints_by_static_group",
          description: "List Linux endpoints belonging to a static group. Returns paginated Linux endpoint list.",
          inputSchema: { type: "object", properties: { ...staticGroupIdProp }, required: ["staticGroupId"] }
        },
        {
          name: "list_mac_endpoints_by_static_group",
          description: "List macOS endpoints belonging to a static group. Returns paginated Mac endpoint list.",
          inputSchema: { type: "object", properties: { ...staticGroupIdProp }, required: ["staticGroupId"] }
        },
        {
          name: "list_network_endpoints_by_static_group",
          description: "List network endpoints belonging to a static group. Returns paginated network endpoint list.",
          inputSchema: { type: "object", properties: { ...staticGroupIdProp }, required: ["staticGroupId"] }
        },
        {
          name: "list_windows_endpoints_by_static_group",
          description: "List Windows endpoints belonging to a static group. Returns paginated Windows endpoint list.",
          inputSchema: { type: "object", properties: { ...staticGroupIdProp }, required: ["staticGroupId"] }
        },
        {
          name: "list_industrial_endpoints_by_static_group",
          description: "List industrial endpoints belonging to a static group. Returns paginated industrial endpoint list.",
          inputSchema: { type: "object", properties: { ...staticGroupIdProp }, required: ["staticGroupId"] }
        },

        // ── Dynamic Group (2) ─────────────────────────────────────────────
        {
          name: "list_endpoints_by_dynamic_group",
          description: "List all endpoints (any OS type) belonging to a dynamic group. Returns paginated endpoint list.",
          inputSchema: { type: "object", properties: { ...dynamicGroupIdProp }, required: ["dynamicGroupId"] }
        },
        {
          name: "list_windows_endpoints_by_dynamic_group",
          description: "List Windows endpoints belonging to a dynamic group. Returns paginated Windows endpoint list.",
          inputSchema: { type: "object", properties: { ...dynamicGroupIdProp }, required: ["dynamicGroupId"] }
        },

        // ── Universal Dynamic Group (8) ───────────────────────────────────
        {
          name: "list_endpoints_by_universal_dynamic_group",
          description: "List all endpoints (any OS type) belonging to a universal dynamic group. Returns paginated endpoint list.",
          inputSchema: { type: "object", properties: { ...udgIdProp }, required: ["universalDynamicGroupId"] }
        },
        {
          name: "list_android_endpoints_by_universal_dynamic_group",
          description: "List Android endpoints belonging to a universal dynamic group. Returns paginated Android endpoint list.",
          inputSchema: { type: "object", properties: { ...udgIdProp }, required: ["universalDynamicGroupId"] }
        },
        {
          name: "list_ios_endpoints_by_universal_dynamic_group",
          description: "List iOS endpoints belonging to a universal dynamic group. Returns paginated iOS endpoint list.",
          inputSchema: { type: "object", properties: { ...udgIdProp }, required: ["universalDynamicGroupId"] }
        },
        {
          name: "list_linux_endpoints_by_universal_dynamic_group",
          description: "List Linux endpoints belonging to a universal dynamic group. Returns paginated Linux endpoint list.",
          inputSchema: { type: "object", properties: { ...udgIdProp }, required: ["universalDynamicGroupId"] }
        },
        {
          name: "list_mac_endpoints_by_universal_dynamic_group",
          description: "List macOS endpoints belonging to a universal dynamic group. Returns paginated Mac endpoint list.",
          inputSchema: { type: "object", properties: { ...udgIdProp }, required: ["universalDynamicGroupId"] }
        },
        {
          name: "list_network_endpoints_by_universal_dynamic_group",
          description: "List network endpoints belonging to a universal dynamic group. Returns paginated network endpoint list.",
          inputSchema: { type: "object", properties: { ...udgIdProp }, required: ["universalDynamicGroupId"] }
        },
        {
          name: "list_windows_endpoints_by_universal_dynamic_group",
          description: "List Windows endpoints belonging to a universal dynamic group. Returns paginated Windows endpoint list.",
          inputSchema: { type: "object", properties: { ...udgIdProp }, required: ["universalDynamicGroupId"] }
        },
        {
          name: "list_industrial_endpoints_by_universal_dynamic_group",
          description: "List industrial endpoints belonging to a universal dynamic group. Returns paginated industrial endpoint list.",
          inputSchema: { type: "object", properties: { ...udgIdProp }, required: ["universalDynamicGroupId"] }
        },
        // ── AD User (6) ────────────────────────────────────────────────────
        {
          name: "list_endpoints_by_ad_user",
          description: "List all endpoints associated with a specific AD user. Returns paginated list of endpoints the user is related to.",
          inputSchema: { type: "object", properties: { adUserId: { type: "string", description: "AD user ID (GUID)" } }, required: ["adUserId"] }
        },
        {
          name: "list_android_endpoints_by_ad_user",
          description: "List Android endpoints associated with a specific AD user. Returns paginated list of Android devices.",
          inputSchema: { type: "object", properties: { adUserId: { type: "string", description: "AD user ID (GUID)" } }, required: ["adUserId"] }
        },
        {
          name: "list_ios_endpoints_by_ad_user",
          description: "List iOS endpoints associated with a specific AD user. Returns paginated list of iOS devices.",
          inputSchema: { type: "object", properties: { adUserId: { type: "string", description: "AD user ID (GUID)" } }, required: ["adUserId"] }
        },
        {
          name: "list_linux_endpoints_by_ad_user",
          description: "List Linux endpoints associated with a specific AD user. Returns paginated list of Linux devices.",
          inputSchema: { type: "object", properties: { adUserId: { type: "string", description: "AD user ID (GUID)" } }, required: ["adUserId"] }
        },
        {
          name: "list_mac_endpoints_by_ad_user",
          description: "List macOS endpoints associated with a specific AD user. Returns paginated list of Mac devices.",
          inputSchema: { type: "object", properties: { adUserId: { type: "string", description: "AD user ID (GUID)" } }, required: ["adUserId"] }
        },
        {
          name: "list_windows_endpoints_by_ad_user",
          description: "List Windows endpoints associated with a specific AD user. Returns paginated list of Windows devices.",
          inputSchema: { type: "object", properties: { adUserId: { type: "string", description: "AD user ID (GUID)" } }, required: ["adUserId"] }
        },
      ]
    };
  }));
  server.setRequestHandler(ListToolsRequestSchema, withReleaseTools(TOOL_RELEASES, withToolAnnotations(TOOL_METHODS, toolCatalog.list)));

  // ── Argument-validation pre-pass (runs before getBconnect) ─────────────────
  function validateToolArguments(name: string, args: Record<string, unknown> | undefined): void {
    // Own keys only: an inherited name such as "constructor" must not match.
    if (Object.hasOwn(TOOL_RULES, name)) {
      validateOrThrow(args, TOOL_RULES[name]());
    }
  }

  // ── CallToolRequestSchema handler ───────────────────────────────────────────

  // countOnly (#165): count with one 1-row request instead of loading a page.
  server.setRequestHandler(CallToolRequestSchema, withCountOnly(QUERY_PARAMETERS, () => selectedRelease(), async (request) => {
    const { name, arguments: args } = request.params;
    // Refuse arguments the tool doesn't declare, before anything else (REQ-SRV-022).
    await toolCatalog.refuseUndeclared(name, args);
    // A tool the selected release lacks is refused by name, before anything is sent (#159).
    refuseUnavailableTool(TOOL_RELEASES, name);

    // Validate arguments first — pure, no side effects, fails fast on bad input.
    validateToolArguments(name, args);

    // Lazy-initialize client on first tool call (not during testing)
    const getClient = (): BConnectClient => {
      // The server's shared client (REQ-SRV-023). A ClientConfigError (e.g. missing
      // credentials) reaches the catch below and becomes a tool result (REQ-XC-001).
      return clients.get(credentials);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = args as Record<string, any>;

    try {
      switch (name) {
        // ── Logical Group ─────────────────────────────────────────────────
        case "list_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getEndpointsByLogicalGroup(a.logicalGroupId, pickArguments(a ?? {}, sends("list_endpoints_by_logical_group")));
          return toolJsonResult(data);
        }
        case "list_android_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getAndroidEndpointsByLogicalGroup(a.logicalGroupId, pickArguments(a ?? {}, sends("list_android_endpoints_by_logical_group")));
          return toolJsonResult(data);
        }
        case "list_ios_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getIosEndpointsByLogicalGroup(a.logicalGroupId, pickArguments(a ?? {}, sends("list_ios_endpoints_by_logical_group")));
          return toolJsonResult(data);
        }
        case "list_linux_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getLinuxEndpointsByLogicalGroup(a.logicalGroupId, pickArguments(a ?? {}, sends("list_linux_endpoints_by_logical_group")));
          return toolJsonResult(data);
        }
        case "list_mac_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getMacEndpointsByLogicalGroup(a.logicalGroupId, pickArguments(a ?? {}, sends("list_mac_endpoints_by_logical_group")));
          return toolJsonResult(data);
        }
        case "list_network_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getNetworkEndpointsByLogicalGroup(a.logicalGroupId, pickArguments(a ?? {}, sends("list_network_endpoints_by_logical_group")));
          return toolJsonResult(data);
        }
        case "list_windows_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getWindowsEndpointsByLogicalGroup(a.logicalGroupId, pickArguments(a ?? {}, sends("list_windows_endpoints_by_logical_group")));
          return toolJsonResult(data);
        }
        case "list_industrial_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getIndustrialEndpointsByLogicalGroup(a.logicalGroupId, pickArguments(a ?? {}, sends("list_industrial_endpoints_by_logical_group")));
          return toolJsonResult(data);
        }
        case "list_logical_groups_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getLogicalGroupsByLogicalGroup(a.logicalGroupId, pickArguments(a ?? {}, sends("list_logical_groups_by_logical_group")));
          return toolJsonResult(data);
        }

        // ── Static Group ──────────────────────────────────────────────────
        case "list_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getEndpointsByStaticGroup(a.staticGroupId, pickArguments(a ?? {}, sends("list_endpoints_by_static_group")));
          return toolJsonResult(data);
        }
        case "list_android_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getAndroidEndpointsByStaticGroup(a.staticGroupId, pickArguments(a ?? {}, sends("list_android_endpoints_by_static_group")));
          return toolJsonResult(data);
        }
        case "list_ios_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getIosEndpointsByStaticGroup(a.staticGroupId, pickArguments(a ?? {}, sends("list_ios_endpoints_by_static_group")));
          return toolJsonResult(data);
        }
        case "list_linux_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getLinuxEndpointsByStaticGroup(a.staticGroupId, pickArguments(a ?? {}, sends("list_linux_endpoints_by_static_group")));
          return toolJsonResult(data);
        }
        case "list_mac_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getMacEndpointsByStaticGroup(a.staticGroupId, pickArguments(a ?? {}, sends("list_mac_endpoints_by_static_group")));
          return toolJsonResult(data);
        }
        case "list_network_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getNetworkEndpointsByStaticGroup(a.staticGroupId, pickArguments(a ?? {}, sends("list_network_endpoints_by_static_group")));
          return toolJsonResult(data);
        }
        case "list_windows_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getWindowsEndpointsByStaticGroup(a.staticGroupId, pickArguments(a ?? {}, sends("list_windows_endpoints_by_static_group")));
          return toolJsonResult(data);
        }
        case "list_industrial_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getIndustrialEndpointsByStaticGroup(a.staticGroupId, pickArguments(a ?? {}, sends("list_industrial_endpoints_by_static_group")));
          return toolJsonResult(data);
        }

        // ── Dynamic Group ─────────────────────────────────────────────────
        case "list_endpoints_by_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getEndpointsByDynamicGroup(a.dynamicGroupId, pickArguments(a ?? {}, sends("list_endpoints_by_dynamic_group")));
          return toolJsonResult(data);
        }
        case "list_windows_endpoints_by_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getWindowsEndpointsByDynamicGroup(a.dynamicGroupId, pickArguments(a ?? {}, sends("list_windows_endpoints_by_dynamic_group")));
          return toolJsonResult(data);
        }

        // ── Universal Dynamic Group ───────────────────────────────────────
        case "list_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getEndpointsByUDG(a.universalDynamicGroupId, pickArguments(a ?? {}, sends("list_endpoints_by_universal_dynamic_group")));
          return toolJsonResult(data);
        }
        case "list_android_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getAndroidEndpointsByUDG(a.universalDynamicGroupId, pickArguments(a ?? {}, sends("list_android_endpoints_by_universal_dynamic_group")));
          return toolJsonResult(data);
        }
        case "list_ios_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getIosEndpointsByUDG(a.universalDynamicGroupId, pickArguments(a ?? {}, sends("list_ios_endpoints_by_universal_dynamic_group")));
          return toolJsonResult(data);
        }
        case "list_linux_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getLinuxEndpointsByUDG(a.universalDynamicGroupId, pickArguments(a ?? {}, sends("list_linux_endpoints_by_universal_dynamic_group")));
          return toolJsonResult(data);
        }
        case "list_mac_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getMacEndpointsByUDG(a.universalDynamicGroupId, pickArguments(a ?? {}, sends("list_mac_endpoints_by_universal_dynamic_group")));
          return toolJsonResult(data);
        }
        case "list_network_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getNetworkEndpointsByUDG(a.universalDynamicGroupId, pickArguments(a ?? {}, sends("list_network_endpoints_by_universal_dynamic_group")));
          return toolJsonResult(data);
        }
        case "list_windows_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getWindowsEndpointsByUDG(a.universalDynamicGroupId, pickArguments(a ?? {}, sends("list_windows_endpoints_by_universal_dynamic_group")));
          return toolJsonResult(data);
        }
        case "list_industrial_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getIndustrialEndpointsByUDG(a.universalDynamicGroupId, pickArguments(a ?? {}, sends("list_industrial_endpoints_by_universal_dynamic_group")));
          return toolJsonResult(data);
        }

        // ── AD User ──────────────────────────────────────────────────────────
        case "list_endpoints_by_ad_user": {
          const client = getClient();
          const data = await client.groups.getEndpointsByADUser(a.adUserId, pickArguments(a ?? {}, sends("list_endpoints_by_ad_user")));
          return toolJsonResult(data);
        }

        case "list_android_endpoints_by_ad_user": {
          const client = getClient();
          const data = await client.groups.getAndroidEndpointsByADUser(a.adUserId, pickArguments(a ?? {}, sends("list_android_endpoints_by_ad_user")));
          return toolJsonResult(data);
        }

        case "list_ios_endpoints_by_ad_user": {
          const client = getClient();
          const data = await client.groups.getIosEndpointsByADUser(a.adUserId, pickArguments(a ?? {}, sends("list_ios_endpoints_by_ad_user")));
          return toolJsonResult(data);
        }

        case "list_linux_endpoints_by_ad_user": {
          const client = getClient();
          const data = await client.groups.getLinuxEndpointsByADUser(a.adUserId, pickArguments(a ?? {}, sends("list_linux_endpoints_by_ad_user")));
          return toolJsonResult(data);
        }

        case "list_mac_endpoints_by_ad_user": {
          const client = getClient();
          const data = await client.groups.getMacEndpointsByADUser(a.adUserId, pickArguments(a ?? {}, sends("list_mac_endpoints_by_ad_user")));
          return toolJsonResult(data);
        }

        case "list_windows_endpoints_by_ad_user": {
          const client = getClient();
          const data = await client.groups.getWindowsEndpointsByADUser(a.adUserId, pickArguments(a ?? {}, sends("list_windows_endpoints_by_ad_user")));
          return toolJsonResult(data);
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      // API errors, gate refusals and configuration errors are tool results the
      // model can read; only McpErrors stay protocol errors (REQ-XC-001).
      return toolErrorResult(error, selectedRelease());
    }
  }));

  return { server };
}

// ── Main entrypoint ──────────────────────────────────────────────────────────

// ─── Entry point ─────────────────────────────────────────────────────────────

runServer({ name: "bconnect-groups-mcp", createServer, clients });
