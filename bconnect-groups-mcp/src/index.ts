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
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import * as dotenv from "dotenv";
import { BConnectClient } from "./bconnect-client.js";
import { validateOrThrow, clientConfigFromEnv, ClientConfigError, toolErrorResult, pickArguments, declaredArgumentsOnly, queryParameters, withQueryProperties } from "@bconnect/mcp-core";
import { QUERY_PARAMETERS } from "./query-params.js";

/** The query parameters a list tool sends: exactly what its route declares in the selected release (#179). */
const sends = (tool: string): string[] => queryParameters(QUERY_PARAMETERS, process.env.BCONNECT_RELEASE, tool);
import type { BConnectConfig, BConnectCredentials } from "@bconnect/mcp-core";
import { TOOL_RULES } from "./utils/mcp-tool-validation-rules.js";

// ── Factory exported for testing ─────────────────────────────────────────────

export type { BConnectCredentials } from "@bconnect/mcp-core";

export function createServer(credentials?: BConnectCredentials): { server: Server } {
  const server = new Server(
    {
      name: "bconnect-groups-mcp",
      version: "26.1.7"
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

  const toolCatalog = declaredArgumentsOnly(withQueryProperties(QUERY_PARAMETERS, () => process.env.BCONNECT_RELEASE, async () => {
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
  server.setRequestHandler(ListToolsRequestSchema, toolCatalog.list);

  // ── Argument-validation pre-pass (runs before getBconnect) ─────────────────
  function validateToolArguments(name: string, args: Record<string, unknown> | undefined): void {
    // Own keys only: an inherited name such as "constructor" must not match.
    if (Object.hasOwn(TOOL_RULES, name)) {
      validateOrThrow(args, TOOL_RULES[name]());
    }
  }

  // ── CallToolRequestSchema handler ───────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    // Refuse arguments the tool doesn't declare, before anything else (REQ-SRV-022).
    await toolCatalog.refuseUndeclared(name, args);

    // Validate arguments first — pure, no side effects, fails fast on bad input.
    validateToolArguments(name, args);

    // Lazy-initialize client on first tool call (not during testing)
    const getClient = (): BConnectClient => {
      dotenv.config();
      // A ClientConfigError (e.g. missing credentials) reaches the catch below
      // and becomes a tool result (REQ-XC-001).
      return new BConnectClient(clientConfigFromEnv(process.env, credentials));
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = args as Record<string, any>;

    try {
      switch (name) {
        // ── Logical Group ─────────────────────────────────────────────────
        case "list_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getEndpointsByLogicalGroup(a.logicalGroupId, pickArguments(a ?? {}, sends("list_endpoints_by_logical_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_android_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getAndroidEndpointsByLogicalGroup(a.logicalGroupId, pickArguments(a ?? {}, sends("list_android_endpoints_by_logical_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_ios_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getIosEndpointsByLogicalGroup(a.logicalGroupId, pickArguments(a ?? {}, sends("list_ios_endpoints_by_logical_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_linux_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getLinuxEndpointsByLogicalGroup(a.logicalGroupId, pickArguments(a ?? {}, sends("list_linux_endpoints_by_logical_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_mac_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getMacEndpointsByLogicalGroup(a.logicalGroupId, pickArguments(a ?? {}, sends("list_mac_endpoints_by_logical_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_network_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getNetworkEndpointsByLogicalGroup(a.logicalGroupId, pickArguments(a ?? {}, sends("list_network_endpoints_by_logical_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_windows_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getWindowsEndpointsByLogicalGroup(a.logicalGroupId, pickArguments(a ?? {}, sends("list_windows_endpoints_by_logical_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_industrial_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getIndustrialEndpointsByLogicalGroup(a.logicalGroupId, pickArguments(a ?? {}, sends("list_industrial_endpoints_by_logical_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_logical_groups_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getLogicalGroupsByLogicalGroup(a.logicalGroupId, pickArguments(a ?? {}, sends("list_logical_groups_by_logical_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        // ── Static Group ──────────────────────────────────────────────────
        case "list_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getEndpointsByStaticGroup(a.staticGroupId, pickArguments(a ?? {}, sends("list_endpoints_by_static_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_android_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getAndroidEndpointsByStaticGroup(a.staticGroupId, pickArguments(a ?? {}, sends("list_android_endpoints_by_static_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_ios_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getIosEndpointsByStaticGroup(a.staticGroupId, pickArguments(a ?? {}, sends("list_ios_endpoints_by_static_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_linux_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getLinuxEndpointsByStaticGroup(a.staticGroupId, pickArguments(a ?? {}, sends("list_linux_endpoints_by_static_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_mac_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getMacEndpointsByStaticGroup(a.staticGroupId, pickArguments(a ?? {}, sends("list_mac_endpoints_by_static_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_network_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getNetworkEndpointsByStaticGroup(a.staticGroupId, pickArguments(a ?? {}, sends("list_network_endpoints_by_static_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_windows_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getWindowsEndpointsByStaticGroup(a.staticGroupId, pickArguments(a ?? {}, sends("list_windows_endpoints_by_static_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_industrial_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getIndustrialEndpointsByStaticGroup(a.staticGroupId, pickArguments(a ?? {}, sends("list_industrial_endpoints_by_static_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        // ── Dynamic Group ─────────────────────────────────────────────────
        case "list_endpoints_by_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getEndpointsByDynamicGroup(a.dynamicGroupId, pickArguments(a ?? {}, sends("list_endpoints_by_dynamic_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_windows_endpoints_by_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getWindowsEndpointsByDynamicGroup(a.dynamicGroupId, pickArguments(a ?? {}, sends("list_windows_endpoints_by_dynamic_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        // ── Universal Dynamic Group ───────────────────────────────────────
        case "list_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getEndpointsByUDG(a.universalDynamicGroupId, pickArguments(a ?? {}, sends("list_endpoints_by_universal_dynamic_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_android_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getAndroidEndpointsByUDG(a.universalDynamicGroupId, pickArguments(a ?? {}, sends("list_android_endpoints_by_universal_dynamic_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_ios_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getIosEndpointsByUDG(a.universalDynamicGroupId, pickArguments(a ?? {}, sends("list_ios_endpoints_by_universal_dynamic_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_linux_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getLinuxEndpointsByUDG(a.universalDynamicGroupId, pickArguments(a ?? {}, sends("list_linux_endpoints_by_universal_dynamic_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_mac_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getMacEndpointsByUDG(a.universalDynamicGroupId, pickArguments(a ?? {}, sends("list_mac_endpoints_by_universal_dynamic_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_network_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getNetworkEndpointsByUDG(a.universalDynamicGroupId, pickArguments(a ?? {}, sends("list_network_endpoints_by_universal_dynamic_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_windows_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getWindowsEndpointsByUDG(a.universalDynamicGroupId, pickArguments(a ?? {}, sends("list_windows_endpoints_by_universal_dynamic_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_industrial_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getIndustrialEndpointsByUDG(a.universalDynamicGroupId, pickArguments(a ?? {}, sends("list_industrial_endpoints_by_universal_dynamic_group")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        // ── AD User ──────────────────────────────────────────────────────────
        case "list_endpoints_by_ad_user": {
          const client = getClient();
          const data = await client.groups.getEndpointsByADUser(a.adUserId, pickArguments(a ?? {}, sends("list_endpoints_by_ad_user")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        case "list_android_endpoints_by_ad_user": {
          const client = getClient();
          const data = await client.groups.getAndroidEndpointsByADUser(a.adUserId, pickArguments(a ?? {}, sends("list_android_endpoints_by_ad_user")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        case "list_ios_endpoints_by_ad_user": {
          const client = getClient();
          const data = await client.groups.getIosEndpointsByADUser(a.adUserId, pickArguments(a ?? {}, sends("list_ios_endpoints_by_ad_user")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        case "list_linux_endpoints_by_ad_user": {
          const client = getClient();
          const data = await client.groups.getLinuxEndpointsByADUser(a.adUserId, pickArguments(a ?? {}, sends("list_linux_endpoints_by_ad_user")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        case "list_mac_endpoints_by_ad_user": {
          const client = getClient();
          const data = await client.groups.getMacEndpointsByADUser(a.adUserId, pickArguments(a ?? {}, sends("list_mac_endpoints_by_ad_user")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        case "list_windows_endpoints_by_ad_user": {
          const client = getClient();
          const data = await client.groups.getWindowsEndpointsByADUser(a.adUserId, pickArguments(a ?? {}, sends("list_windows_endpoints_by_ad_user")));
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      // API errors, gate refusals and configuration errors are tool results the
      // model can read; only McpErrors stay protocol errors (REQ-XC-001).
      return toolErrorResult(error, process.env.BCONNECT_RELEASE ?? "26R1");
    }
  });

  return { server };
}

// ── Main entrypoint ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  dotenv.config();

  // Startup connectivity check (REQ-SRV-013)
  {
    let _config: Readonly<BConnectConfig>;
    try {
      _config = clientConfigFromEnv(process.env);
    } catch (error) {
      if (!(error instanceof ClientConfigError)) { throw error; }
      console.error(`bconnect-groups-mcp: ${error.message}`);
      process.exit(1);
    }
    const _startupUrl = _config.baseUrl;
    const _startupClient = new BConnectClient(_config);
    console.error(`bconnect-groups-mcp: verifying bConnect API connectivity...`);
    const _connected = await _startupClient.testConnection();
    if (!_connected) {
      console.error(`bconnect-groups-mcp: cannot reach bConnect API at ${_startupUrl}. Check BCONNECT_BASE_URL, credentials, and network.`);
      process.exit(1);
    }
    console.error(`bconnect-groups-mcp: API connectivity verified.`);
  }

  const transportMode = process.env.MCP_TRANSPORT ?? "stdio";
  const port = parseInt(process.env.MCP_PORT ?? "3000", 10);
  const serverName = "bconnect-groups-mcp";

  if (transportMode === "http") {
    const app = express();
    app.use(express.json());

    app.post("/mcp", async (req, res) => {
      const { server } = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    app.get("/mcp", async (req, res) => {
      res.writeHead(405).end(JSON.stringify({ error: "Method Not Allowed. Use POST for MCP requests." }));
    });

    app.delete("/mcp", async (req, res) => {
      res.writeHead(405).end(JSON.stringify({ error: "Method Not Allowed. Session management not supported in stateless mode." }));
    });

    const bind = process.env.MCP_BIND ?? "127.0.0.1";
    // Standalone HTTP mode has no client authentication. Binding to a non-loopback
    // address would expose an unauthenticated bConnect proxy, so fail closed unless
    // the operator explicitly opts in (front it with the authenticated gateway instead).
    const isLoopbackBind = bind === "127.0.0.1" || bind === "::1" || bind === "localhost";
    if (!isLoopbackBind && process.env.MCP_ALLOW_NO_AUTH !== "true") {
      console.error(
        `${serverName}: refusing to bind ${bind} — standalone HTTP mode is unauthenticated. ` +
          `Bind to loopback (the default) and front it with the authenticated gateway, ` +
          `or set MCP_ALLOW_NO_AUTH=true to override.`,
      );
      process.exit(1);
    }
    app.listen(port, bind, () => {
      console.error(`${serverName} listening on http://${bind}:${port}/mcp`);
    });
  } else {
    const { server } = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`${serverName} started on stdio`);
  }
}

// Only run when this file is the entry point (not imported in tests)
if (process.env.VITEST === undefined) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
