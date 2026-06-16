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
import * as fs from "fs";
import * as dotenv from "dotenv";
import { BConnectClient } from "./bconnect-client.js";

// ── Factory exported for testing ─────────────────────────────────────────────

export interface BConnectCredentials {
  baseUrl?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

export function createServer(credentials?: BConnectCredentials): { server: Server } {
  const server = new Server(
    {
      name: "bconnect-groups-mcp",
      version: "26.1.4"
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

  // ── Argument-validation pre-pass (runs before getBconnect) ─────────────────
  function validateToolArguments(name: string, _args: Record<string, unknown> | undefined): void {
    switch (name) {
      case "list_endpoints_by_logical_group":
      case "list_android_endpoints_by_logical_group":
      case "list_ios_endpoints_by_logical_group":
      case "list_linux_endpoints_by_logical_group":
      case "list_mac_endpoints_by_logical_group":
      case "list_network_endpoints_by_logical_group":
      case "list_windows_endpoints_by_logical_group":
      case "list_industrial_endpoints_by_logical_group":
      case "list_logical_groups_by_logical_group":
      case "list_endpoints_by_static_group":
      case "list_android_endpoints_by_static_group":
      case "list_ios_endpoints_by_static_group":
      case "list_linux_endpoints_by_static_group":
      case "list_mac_endpoints_by_static_group":
      case "list_network_endpoints_by_static_group":
      case "list_windows_endpoints_by_static_group":
      case "list_industrial_endpoints_by_static_group":
      case "list_endpoints_by_dynamic_group":
      case "list_windows_endpoints_by_dynamic_group":
      case "list_endpoints_by_universal_dynamic_group":
      case "list_android_endpoints_by_universal_dynamic_group":
      case "list_ios_endpoints_by_universal_dynamic_group":
      case "list_linux_endpoints_by_universal_dynamic_group":
      case "list_mac_endpoints_by_universal_dynamic_group":
      case "list_network_endpoints_by_universal_dynamic_group":
      case "list_windows_endpoints_by_universal_dynamic_group":
      case "list_industrial_endpoints_by_universal_dynamic_group":
      case "list_endpoints_by_ad_user":
      case "list_android_endpoints_by_ad_user":
      case "list_ios_endpoints_by_ad_user":
      case "list_linux_endpoints_by_ad_user":
      case "list_mac_endpoints_by_ad_user":
      case "list_windows_endpoints_by_ad_user":
      // Unknown tool names are not validated here; dispatch handles MethodNotFound.
    }
  }

  // ── CallToolRequestSchema handler ───────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Validate arguments first — pure, no side effects, fails fast on bad input.
    validateToolArguments(name, args);

    // Lazy-initialize client on first tool call (not during testing)
    const getClient = (): BConnectClient => {
      dotenv.config();
      const baseUrl  = credentials?.baseUrl ?? process.env.BCONNECT_BASE_URL;
      const username = credentials?.username ?? process.env.BCONNECT_USERNAME;
      const password = credentials?.password ?? process.env.BCONNECT_PASSWORD;
      const apiKey = credentials?.apiKey ?? process.env.BCONNECT_API_KEY;

      if (!baseUrl || (!apiKey && (!username || !password))) {
        throw new McpError(ErrorCode.InvalidRequest, "Missing required bConnect credentials: BCONNECT_BASE_URL and either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD");
      }

      return new BConnectClient({
        baseUrl,
        username,
        password,
        apiKey,
        rejectUnauthorized: process.env.BCONNECT_REJECT_UNAUTHORIZED !== 'false',
      });
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = args as Record<string, any>;
    const params = {
      SearchQuery: a?.SearchQuery,
      Page:        a?.Page,
      PageSize:    a?.PageSize,
      OrderBy:     a?.OrderBy,
    };

    try {
      switch (name) {
        // ── Logical Group ─────────────────────────────────────────────────
        case "list_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getEndpointsByLogicalGroup(a.logicalGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_android_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getAndroidEndpointsByLogicalGroup(a.logicalGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_ios_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getIosEndpointsByLogicalGroup(a.logicalGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_linux_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getLinuxEndpointsByLogicalGroup(a.logicalGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_mac_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getMacEndpointsByLogicalGroup(a.logicalGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_network_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getNetworkEndpointsByLogicalGroup(a.logicalGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_windows_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getWindowsEndpointsByLogicalGroup(a.logicalGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_industrial_endpoints_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getIndustrialEndpointsByLogicalGroup(a.logicalGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_logical_groups_by_logical_group": {
          const client = getClient();
          const data = await client.groups.getLogicalGroupsByLogicalGroup(a.logicalGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        // ── Static Group ──────────────────────────────────────────────────
        case "list_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getEndpointsByStaticGroup(a.staticGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_android_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getAndroidEndpointsByStaticGroup(a.staticGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_ios_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getIosEndpointsByStaticGroup(a.staticGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_linux_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getLinuxEndpointsByStaticGroup(a.staticGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_mac_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getMacEndpointsByStaticGroup(a.staticGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_network_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getNetworkEndpointsByStaticGroup(a.staticGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_windows_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getWindowsEndpointsByStaticGroup(a.staticGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_industrial_endpoints_by_static_group": {
          const client = getClient();
          const data = await client.groups.getIndustrialEndpointsByStaticGroup(a.staticGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        // ── Dynamic Group ─────────────────────────────────────────────────
        case "list_endpoints_by_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getEndpointsByDynamicGroup(a.dynamicGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_windows_endpoints_by_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getWindowsEndpointsByDynamicGroup(a.dynamicGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        // ── Universal Dynamic Group ───────────────────────────────────────
        case "list_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getEndpointsByUDG(a.universalDynamicGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_android_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getAndroidEndpointsByUDG(a.universalDynamicGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_ios_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getIosEndpointsByUDG(a.universalDynamicGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_linux_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getLinuxEndpointsByUDG(a.universalDynamicGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_mac_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getMacEndpointsByUDG(a.universalDynamicGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_network_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getNetworkEndpointsByUDG(a.universalDynamicGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_windows_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getWindowsEndpointsByUDG(a.universalDynamicGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }
        case "list_industrial_endpoints_by_universal_dynamic_group": {
          const client = getClient();
          const data = await client.groups.getIndustrialEndpointsByUDG(a.universalDynamicGroupId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        // ── AD User ──────────────────────────────────────────────────────────
        case "list_endpoints_by_ad_user": {
          const client = getClient();
          const data = await client.groups.getEndpointsByADUser(a.adUserId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        case "list_android_endpoints_by_ad_user": {
          const client = getClient();
          const data = await client.groups.getAndroidEndpointsByADUser(a.adUserId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        case "list_ios_endpoints_by_ad_user": {
          const client = getClient();
          const data = await client.groups.getIosEndpointsByADUser(a.adUserId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        case "list_linux_endpoints_by_ad_user": {
          const client = getClient();
          const data = await client.groups.getLinuxEndpointsByADUser(a.adUserId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        case "list_mac_endpoints_by_ad_user": {
          const client = getClient();
          const data = await client.groups.getMacEndpointsByADUser(a.adUserId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        case "list_windows_endpoints_by_ad_user": {
          const client = getClient();
          const data = await client.groups.getWindowsEndpointsByADUser(a.adUserId, params);
          return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      if (error instanceof McpError) {throw error;}
      const message = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InternalError, message);
    }
  });

  return { server };
}

// ── Main entrypoint ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  dotenv.config();

  const baseUrl  = process.env.BCONNECT_BASE_URL;
  const username = process.env.BCONNECT_USERNAME;
  const password = process.env.BCONNECT_PASSWORD;
  const apiKey = process.env.BCONNECT_API_KEY;

  if (!baseUrl || (!apiKey && (!username || !password))) {
    console.error("Error: Missing required environment variables.");
    console.error("  BCONNECT_BASE_URL  — e.g. https://bconnect.example.com/bconnect");
    console.error("  Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD");
    process.exit(1);
  }

  

  
  // Startup connectivity check (REQ-SRV-013)
  dotenv.config();
  {
    const _startupUrl = process.env.BCONNECT_BASE_URL || "https://bms.example.com:444/bconnect";
    const _startupUser = process.env.BCONNECT_USERNAME;
    const _startupPass = process.env.BCONNECT_PASSWORD;
    const _startupApiKey = process.env.BCONNECT_API_KEY;
    if (!_startupApiKey && (!_startupUser || !_startupPass)) {
      console.error("bconnect-groups-mcp: Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required");
      process.exit(1);
    }
    const _caCertPath = process.env.BCONNECT_CA_CERT_PATH;
    const _caCert = _caCertPath ? fs.readFileSync(_caCertPath, "utf8") : undefined;
    const _startupClient = new BConnectClient({
      baseUrl: _startupUrl,
      username: _startupUser,
      password: _startupPass,
      apiKey: _startupApiKey,
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

    app.listen(port, () => {
      console.error(`${serverName} listening on http://0.0.0.0:${port}/mcp`);
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
