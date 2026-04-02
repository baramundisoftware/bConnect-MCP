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
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { BConnectClient } from "./bconnect-client.js";
import { validateOrThrow } from "./utils/parameter-validator.js";
import { GroupsRules } from "./utils/mcp-tool-validation-rules.js";

// ── Factory exported for testing ─────────────────────────────────────────────

export function createServer(): { server: Server } {
  const server = new Server(
    {
      name: "bconnect-groups-mcp",
      version: "26.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── Pagination input schema (shared) ────────────────────────────────────────

  const paginationProperties = {
    SearchQuery: { type: "string", description: "Filter results by name or description" },
    Page:        { type: "number", description: "Page number (zero-indexed, default 0)" },
    PageSize:    { type: "number", description: "Results per page (1–1000, default 20)" },
    OrderBy:     { type: "string", description: "Sort order (e.g., 'Name asc')" },
  };

  const logicalGroupIdProp  = { logicalGroupId:          { type: "string", description: "GUID of the logical group"           } };
  const staticGroupIdProp   = { staticGroupId:            { type: "string", description: "GUID of the static group"            } };
  const dynamicGroupIdProp  = { dynamicGroupId:           { type: "string", description: "GUID of the dynamic group"           } };
  const udgIdProp           = { universalDynamicGroupId:  { type: "string", description: "GUID of the universal dynamic group" } };

  // ── ListToolsRequestSchema handler ─────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        // ── Logical Group (9) ──────────────────────────────────────────────
        {
          name: "list_endpoints_by_logical_group",
          description: "List all endpoints (any OS type) belonging to a logical group. Returns paginated endpoint list with GUIDs and properties.",
          inputSchema: { type: "object", properties: { ...logicalGroupIdProp, ...paginationProperties }, required: ["logicalGroupId"] }
        },
        {
          name: "list_android_endpoints_by_logical_group",
          description: "List Android endpoints belonging to a logical group. Returns paginated Android endpoint list.",
          inputSchema: { type: "object", properties: { ...logicalGroupIdProp, ...paginationProperties }, required: ["logicalGroupId"] }
        },
        {
          name: "list_ios_endpoints_by_logical_group",
          description: "List iOS endpoints belonging to a logical group. Returns paginated iOS endpoint list.",
          inputSchema: { type: "object", properties: { ...logicalGroupIdProp, ...paginationProperties }, required: ["logicalGroupId"] }
        },
        {
          name: "list_linux_endpoints_by_logical_group",
          description: "List Linux endpoints belonging to a logical group. Returns paginated Linux endpoint list.",
          inputSchema: { type: "object", properties: { ...logicalGroupIdProp, ...paginationProperties }, required: ["logicalGroupId"] }
        },
        {
          name: "list_mac_endpoints_by_logical_group",
          description: "List macOS endpoints belonging to a logical group. Returns paginated Mac endpoint list.",
          inputSchema: { type: "object", properties: { ...logicalGroupIdProp, ...paginationProperties }, required: ["logicalGroupId"] }
        },
        {
          name: "list_network_endpoints_by_logical_group",
          description: "List network endpoints belonging to a logical group. Returns paginated network endpoint list.",
          inputSchema: { type: "object", properties: { ...logicalGroupIdProp, ...paginationProperties }, required: ["logicalGroupId"] }
        },
        {
          name: "list_windows_endpoints_by_logical_group",
          description: "List Windows endpoints belonging to a logical group. Returns paginated Windows endpoint list.",
          inputSchema: { type: "object", properties: { ...logicalGroupIdProp, ...paginationProperties }, required: ["logicalGroupId"] }
        },
        {
          name: "list_industrial_endpoints_by_logical_group",
          description: "List industrial endpoints belonging to a logical group. Returns paginated industrial endpoint list.",
          inputSchema: { type: "object", properties: { ...logicalGroupIdProp, ...paginationProperties }, required: ["logicalGroupId"] }
        },
        {
          name: "list_logical_groups_by_logical_group",
          description: "List child logical groups belonging to a parent logical group. Returns paginated logical group list.",
          inputSchema: { type: "object", properties: { ...logicalGroupIdProp, ...paginationProperties }, required: ["logicalGroupId"] }
        },

        // ── Static Group (8) ──────────────────────────────────────────────
        {
          name: "list_endpoints_by_static_group",
          description: "List all endpoints (any OS type) belonging to a static group. Returns paginated endpoint list.",
          inputSchema: { type: "object", properties: { ...staticGroupIdProp, ...paginationProperties }, required: ["staticGroupId"] }
        },
        {
          name: "list_android_endpoints_by_static_group",
          description: "List Android endpoints belonging to a static group. Returns paginated Android endpoint list.",
          inputSchema: { type: "object", properties: { ...staticGroupIdProp, ...paginationProperties }, required: ["staticGroupId"] }
        },
        {
          name: "list_ios_endpoints_by_static_group",
          description: "List iOS endpoints belonging to a static group. Returns paginated iOS endpoint list.",
          inputSchema: { type: "object", properties: { ...staticGroupIdProp, ...paginationProperties }, required: ["staticGroupId"] }
        },
        {
          name: "list_linux_endpoints_by_static_group",
          description: "List Linux endpoints belonging to a static group. Returns paginated Linux endpoint list.",
          inputSchema: { type: "object", properties: { ...staticGroupIdProp, ...paginationProperties }, required: ["staticGroupId"] }
        },
        {
          name: "list_mac_endpoints_by_static_group",
          description: "List macOS endpoints belonging to a static group. Returns paginated Mac endpoint list.",
          inputSchema: { type: "object", properties: { ...staticGroupIdProp, ...paginationProperties }, required: ["staticGroupId"] }
        },
        {
          name: "list_network_endpoints_by_static_group",
          description: "List network endpoints belonging to a static group. Returns paginated network endpoint list.",
          inputSchema: { type: "object", properties: { ...staticGroupIdProp, ...paginationProperties }, required: ["staticGroupId"] }
        },
        {
          name: "list_windows_endpoints_by_static_group",
          description: "List Windows endpoints belonging to a static group. Returns paginated Windows endpoint list.",
          inputSchema: { type: "object", properties: { ...staticGroupIdProp, ...paginationProperties }, required: ["staticGroupId"] }
        },
        {
          name: "list_industrial_endpoints_by_static_group",
          description: "List industrial endpoints belonging to a static group. Returns paginated industrial endpoint list.",
          inputSchema: { type: "object", properties: { ...staticGroupIdProp, ...paginationProperties }, required: ["staticGroupId"] }
        },

        // ── Dynamic Group (2) ─────────────────────────────────────────────
        {
          name: "list_endpoints_by_dynamic_group",
          description: "List all endpoints (any OS type) belonging to a dynamic group. Returns paginated endpoint list.",
          inputSchema: { type: "object", properties: { ...dynamicGroupIdProp, ...paginationProperties }, required: ["dynamicGroupId"] }
        },
        {
          name: "list_windows_endpoints_by_dynamic_group",
          description: "List Windows endpoints belonging to a dynamic group. Returns paginated Windows endpoint list.",
          inputSchema: { type: "object", properties: { ...dynamicGroupIdProp, ...paginationProperties }, required: ["dynamicGroupId"] }
        },

        // ── Universal Dynamic Group (8) ───────────────────────────────────
        {
          name: "list_endpoints_by_universal_dynamic_group",
          description: "List all endpoints (any OS type) belonging to a universal dynamic group. Returns paginated endpoint list.",
          inputSchema: { type: "object", properties: { ...udgIdProp, ...paginationProperties }, required: ["universalDynamicGroupId"] }
        },
        {
          name: "list_android_endpoints_by_universal_dynamic_group",
          description: "List Android endpoints belonging to a universal dynamic group. Returns paginated Android endpoint list.",
          inputSchema: { type: "object", properties: { ...udgIdProp, ...paginationProperties }, required: ["universalDynamicGroupId"] }
        },
        {
          name: "list_ios_endpoints_by_universal_dynamic_group",
          description: "List iOS endpoints belonging to a universal dynamic group. Returns paginated iOS endpoint list.",
          inputSchema: { type: "object", properties: { ...udgIdProp, ...paginationProperties }, required: ["universalDynamicGroupId"] }
        },
        {
          name: "list_linux_endpoints_by_universal_dynamic_group",
          description: "List Linux endpoints belonging to a universal dynamic group. Returns paginated Linux endpoint list.",
          inputSchema: { type: "object", properties: { ...udgIdProp, ...paginationProperties }, required: ["universalDynamicGroupId"] }
        },
        {
          name: "list_mac_endpoints_by_universal_dynamic_group",
          description: "List macOS endpoints belonging to a universal dynamic group. Returns paginated Mac endpoint list.",
          inputSchema: { type: "object", properties: { ...udgIdProp, ...paginationProperties }, required: ["universalDynamicGroupId"] }
        },
        {
          name: "list_network_endpoints_by_universal_dynamic_group",
          description: "List network endpoints belonging to a universal dynamic group. Returns paginated network endpoint list.",
          inputSchema: { type: "object", properties: { ...udgIdProp, ...paginationProperties }, required: ["universalDynamicGroupId"] }
        },
        {
          name: "list_windows_endpoints_by_universal_dynamic_group",
          description: "List Windows endpoints belonging to a universal dynamic group. Returns paginated Windows endpoint list.",
          inputSchema: { type: "object", properties: { ...udgIdProp, ...paginationProperties }, required: ["universalDynamicGroupId"] }
        },
        {
          name: "list_industrial_endpoints_by_universal_dynamic_group",
          description: "List industrial endpoints belonging to a universal dynamic group. Returns paginated industrial endpoint list.",
          inputSchema: { type: "object", properties: { ...udgIdProp, ...paginationProperties }, required: ["universalDynamicGroupId"] }
        },
        // ── AD User (6) ────────────────────────────────────────────────────
        {
          name: "list_endpoints_by_ad_user",
          description: "List all endpoints associated with a specific AD user. Returns paginated list of endpoints the user is related to.",
          inputSchema: { type: "object", properties: { adUserId: { type: "string", description: "AD user ID (GUID)" }, ...paginationProperties }, required: ["adUserId"] }
        },
        {
          name: "list_android_endpoints_by_ad_user",
          description: "List Android endpoints associated with a specific AD user. Returns paginated list of Android devices.",
          inputSchema: { type: "object", properties: { adUserId: { type: "string", description: "AD user ID (GUID)" }, ...paginationProperties }, required: ["adUserId"] }
        },
        {
          name: "list_ios_endpoints_by_ad_user",
          description: "List iOS endpoints associated with a specific AD user. Returns paginated list of iOS devices.",
          inputSchema: { type: "object", properties: { adUserId: { type: "string", description: "AD user ID (GUID)" }, ...paginationProperties }, required: ["adUserId"] }
        },
        {
          name: "list_linux_endpoints_by_ad_user",
          description: "List Linux endpoints associated with a specific AD user. Returns paginated list of Linux devices.",
          inputSchema: { type: "object", properties: { adUserId: { type: "string", description: "AD user ID (GUID)" }, ...paginationProperties }, required: ["adUserId"] }
        },
        {
          name: "list_mac_endpoints_by_ad_user",
          description: "List macOS endpoints associated with a specific AD user. Returns paginated list of Mac devices.",
          inputSchema: { type: "object", properties: { adUserId: { type: "string", description: "AD user ID (GUID)" }, ...paginationProperties }, required: ["adUserId"] }
        },
        {
          name: "list_windows_endpoints_by_ad_user",
          description: "List Windows endpoints associated with a specific AD user. Returns paginated list of Windows devices.",
          inputSchema: { type: "object", properties: { adUserId: { type: "string", description: "AD user ID (GUID)" }, ...paginationProperties }, required: ["adUserId"] }
        },
      ]
    };
  });

  // ── CallToolRequestSchema handler ───────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Lazy-initialize client on first tool call (not during testing)
    const getClient = (): BConnectClient => {
      dotenv.config();
      const baseUrl  = process.env.BCONNECT_BASE_URL;
      const username = process.env.BCONNECT_USERNAME;
      const password = process.env.BCONNECT_PASSWORD;

      if (!baseUrl || !username || !password) {
        throw new McpError(ErrorCode.InvalidRequest, "Missing required environment variables: BCONNECT_BASE_URL, BCONNECT_USERNAME, BCONNECT_PASSWORD");
      }

      return new BConnectClient({
        baseUrl,
        username,
        password,
        rejectUnauthorized: process.env.BCONNECT_REJECT_UNAUTHORIZED !== 'false',
      });
    };

    const params = {
      SearchQuery: (args as any)?.SearchQuery,
      Page:        (args as any)?.Page,
      PageSize:    (args as any)?.PageSize,
      OrderBy:     (args as any)?.OrderBy,
    };

    try {
      switch (name) {
        // ── Logical Group ─────────────────────────────────────────────────
        case "list_endpoints_by_logical_group": {
          validateOrThrow(args, GroupsRules.listEndpointsByLogicalGroup());
          const client = getClient();
          const data = await client.groups.getEndpointsByLogicalGroup((args as any).logicalGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_android_endpoints_by_logical_group": {
          validateOrThrow(args, GroupsRules.listAndroidEndpointsByLogicalGroup());
          const client = getClient();
          const data = await client.groups.getAndroidEndpointsByLogicalGroup((args as any).logicalGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_ios_endpoints_by_logical_group": {
          validateOrThrow(args, GroupsRules.listIosEndpointsByLogicalGroup());
          const client = getClient();
          const data = await client.groups.getIosEndpointsByLogicalGroup((args as any).logicalGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_linux_endpoints_by_logical_group": {
          validateOrThrow(args, GroupsRules.listLinuxEndpointsByLogicalGroup());
          const client = getClient();
          const data = await client.groups.getLinuxEndpointsByLogicalGroup((args as any).logicalGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_mac_endpoints_by_logical_group": {
          validateOrThrow(args, GroupsRules.listMacEndpointsByLogicalGroup());
          const client = getClient();
          const data = await client.groups.getMacEndpointsByLogicalGroup((args as any).logicalGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_network_endpoints_by_logical_group": {
          validateOrThrow(args, GroupsRules.listNetworkEndpointsByLogicalGroup());
          const client = getClient();
          const data = await client.groups.getNetworkEndpointsByLogicalGroup((args as any).logicalGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_windows_endpoints_by_logical_group": {
          validateOrThrow(args, GroupsRules.listWindowsEndpointsByLogicalGroup());
          const client = getClient();
          const data = await client.groups.getWindowsEndpointsByLogicalGroup((args as any).logicalGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_industrial_endpoints_by_logical_group": {
          validateOrThrow(args, GroupsRules.listIndustrialEndpointsByLogicalGroup());
          const client = getClient();
          const data = await client.groups.getIndustrialEndpointsByLogicalGroup((args as any).logicalGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_logical_groups_by_logical_group": {
          validateOrThrow(args, GroupsRules.listLogicalGroupsByLogicalGroup());
          const client = getClient();
          const data = await client.groups.getLogicalGroupsByLogicalGroup((args as any).logicalGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        // ── Static Group ──────────────────────────────────────────────────
        case "list_endpoints_by_static_group": {
          validateOrThrow(args, GroupsRules.listEndpointsByStaticGroup());
          const client = getClient();
          const data = await client.groups.getEndpointsByStaticGroup((args as any).staticGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_android_endpoints_by_static_group": {
          validateOrThrow(args, GroupsRules.listAndroidEndpointsByStaticGroup());
          const client = getClient();
          const data = await client.groups.getAndroidEndpointsByStaticGroup((args as any).staticGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_ios_endpoints_by_static_group": {
          validateOrThrow(args, GroupsRules.listIosEndpointsByStaticGroup());
          const client = getClient();
          const data = await client.groups.getIosEndpointsByStaticGroup((args as any).staticGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_linux_endpoints_by_static_group": {
          validateOrThrow(args, GroupsRules.listLinuxEndpointsByStaticGroup());
          const client = getClient();
          const data = await client.groups.getLinuxEndpointsByStaticGroup((args as any).staticGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_mac_endpoints_by_static_group": {
          validateOrThrow(args, GroupsRules.listMacEndpointsByStaticGroup());
          const client = getClient();
          const data = await client.groups.getMacEndpointsByStaticGroup((args as any).staticGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_network_endpoints_by_static_group": {
          validateOrThrow(args, GroupsRules.listNetworkEndpointsByStaticGroup());
          const client = getClient();
          const data = await client.groups.getNetworkEndpointsByStaticGroup((args as any).staticGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_windows_endpoints_by_static_group": {
          validateOrThrow(args, GroupsRules.listWindowsEndpointsByStaticGroup());
          const client = getClient();
          const data = await client.groups.getWindowsEndpointsByStaticGroup((args as any).staticGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_industrial_endpoints_by_static_group": {
          validateOrThrow(args, GroupsRules.listIndustrialEndpointsByStaticGroup());
          const client = getClient();
          const data = await client.groups.getIndustrialEndpointsByStaticGroup((args as any).staticGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        // ── Dynamic Group ─────────────────────────────────────────────────
        case "list_endpoints_by_dynamic_group": {
          validateOrThrow(args, GroupsRules.listEndpointsByDynamicGroup());
          const client = getClient();
          const data = await client.groups.getEndpointsByDynamicGroup((args as any).dynamicGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_windows_endpoints_by_dynamic_group": {
          validateOrThrow(args, GroupsRules.listWindowsEndpointsByDynamicGroup());
          const client = getClient();
          const data = await client.groups.getWindowsEndpointsByDynamicGroup((args as any).dynamicGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        // ── Universal Dynamic Group ───────────────────────────────────────
        case "list_endpoints_by_universal_dynamic_group": {
          validateOrThrow(args, GroupsRules.listEndpointsByUDG());
          const client = getClient();
          const data = await client.groups.getEndpointsByUDG((args as any).universalDynamicGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_android_endpoints_by_universal_dynamic_group": {
          validateOrThrow(args, GroupsRules.listAndroidEndpointsByUDG());
          const client = getClient();
          const data = await client.groups.getAndroidEndpointsByUDG((args as any).universalDynamicGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_ios_endpoints_by_universal_dynamic_group": {
          validateOrThrow(args, GroupsRules.listIosEndpointsByUDG());
          const client = getClient();
          const data = await client.groups.getIosEndpointsByUDG((args as any).universalDynamicGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_linux_endpoints_by_universal_dynamic_group": {
          validateOrThrow(args, GroupsRules.listLinuxEndpointsByUDG());
          const client = getClient();
          const data = await client.groups.getLinuxEndpointsByUDG((args as any).universalDynamicGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_mac_endpoints_by_universal_dynamic_group": {
          validateOrThrow(args, GroupsRules.listMacEndpointsByUDG());
          const client = getClient();
          const data = await client.groups.getMacEndpointsByUDG((args as any).universalDynamicGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_network_endpoints_by_universal_dynamic_group": {
          validateOrThrow(args, GroupsRules.listNetworkEndpointsByUDG());
          const client = getClient();
          const data = await client.groups.getNetworkEndpointsByUDG((args as any).universalDynamicGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_windows_endpoints_by_universal_dynamic_group": {
          validateOrThrow(args, GroupsRules.listWindowsEndpointsByUDG());
          const client = getClient();
          const data = await client.groups.getWindowsEndpointsByUDG((args as any).universalDynamicGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_industrial_endpoints_by_universal_dynamic_group": {
          validateOrThrow(args, GroupsRules.listIndustrialEndpointsByUDG());
          const client = getClient();
          const data = await client.groups.getIndustrialEndpointsByUDG((args as any).universalDynamicGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        // ── AD User ──────────────────────────────────────────────────────────
        case "list_endpoints_by_ad_user": {
          validateOrThrow(args, GroupsRules.listEndpointsByADUser());
          const client = getClient();
          const data = await client.groups.getEndpointsByADUser((args as any).adUserId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        case "list_android_endpoints_by_ad_user": {
          validateOrThrow(args, GroupsRules.listAndroidEndpointsByADUser());
          const client = getClient();
          const data = await client.groups.getAndroidEndpointsByADUser((args as any).adUserId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        case "list_ios_endpoints_by_ad_user": {
          validateOrThrow(args, GroupsRules.listIosEndpointsByADUser());
          const client = getClient();
          const data = await client.groups.getIosEndpointsByADUser((args as any).adUserId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        case "list_linux_endpoints_by_ad_user": {
          validateOrThrow(args, GroupsRules.listLinuxEndpointsByADUser());
          const client = getClient();
          const data = await client.groups.getLinuxEndpointsByADUser((args as any).adUserId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        case "list_mac_endpoints_by_ad_user": {
          validateOrThrow(args, GroupsRules.listMacEndpointsByADUser());
          const client = getClient();
          const data = await client.groups.getMacEndpointsByADUser((args as any).adUserId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        case "list_windows_endpoints_by_ad_user": {
          validateOrThrow(args, GroupsRules.listWindowsEndpointsByADUser());
          const client = getClient();
          const data = await client.groups.getWindowsEndpointsByADUser((args as any).adUserId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      if (error instanceof McpError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InternalError, message);
    }
  });

  return { server };
}

// ── Main entrypoint ──────────────────────────────────────────────────────────

async function main() {
  dotenv.config();

  const baseUrl  = process.env.BCONNECT_BASE_URL;
  const username = process.env.BCONNECT_USERNAME;
  const password = process.env.BCONNECT_PASSWORD;

  if (!baseUrl || !username || !password) {
    console.error("Error: Missing required environment variables.");
    console.error("  BCONNECT_BASE_URL  — e.g. https://bconnect.example.com/bconnect");
    console.error("  BCONNECT_USERNAME  — bConnect API username");
    console.error("  BCONNECT_PASSWORD  — bConnect API password");
    process.exit(1);
  }

  

  
  // Startup connectivity check (REQ-SRV-013)
  dotenv.config();
  {
    const _startupUrl = process.env.BCONNECT_BASE_URL || "https://bms-win22srv:444/bconnect";
    const _startupUser = process.env.BCONNECT_USERNAME;
    const _startupPass = process.env.BCONNECT_PASSWORD;
    if (!_startupUser || !_startupPass) {
      console.error("bconnect-groups-mcp: BCONNECT_USERNAME and BCONNECT_PASSWORD are required");
      process.exit(1);
    }
    const _caCertPath = process.env.BCONNECT_CA_CERT_PATH;
    const _caCert = _caCertPath ? fs.readFileSync(_caCertPath, "utf8") : undefined;
    const _startupClient = new BConnectClient({
      baseUrl: _startupUrl,
      username: _startupUser,
      password: _startupPass,
      rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
      ...(_caCert && { ca: _caCert }),
    });
    console.error(`bconnect-groups-mcp: verifying bConnect API connectivity...`);
    const _connected = await _startupClient.testConnection();
    if (!_connected) {
      console.error(`bconnect-groups-mcp: cannot reach bConnect API at ${_startupUrl}. Check BCONNECT_BASE_URL, credentials, and network.`);
      process.exit(1);
    }
    console.error(`bconnect-groups-mcp: API connectivity verified.`);
  }

  const { server } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("bconnect-groups-mcp server running on stdio");
}

// Only run when this file is the entry point (not imported in tests)
if (process.env.VITEST === undefined) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
