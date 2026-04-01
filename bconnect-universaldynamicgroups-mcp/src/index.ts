#!/usr/bin/env node

/**
 * bconnect-universaldynamicgroups-mcp
 *
 * A Model Context Protocol server that provides read-only access to the
 * baramundi bConnect REST API for Universal Dynamic Groups — listing and
 * retrieving UDG definitions and their folder hierarchy.
 *
 * This server is ONLY available for bConnect 26R1 and later.
 * Universal Dynamic Groups do not exist in 25R2.
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

// ─── Factory exported for testing ───────────────────────────────────────────

export function createServer(): { server: Server } {
  const release = process.env.BCONNECT_RELEASE ?? "25R2";
  const is26R1 = release === "26R1";

  const server = new Server(
    {
      name: "bconnect-universaldynamicgroups-mcp",
      version: "26.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── ListToolsRequestSchema handler ────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (!is26R1) {
      return { tools: [] };
    }

    return {
      tools: [
        // ── Universal Dynamic Groups ─────────────────────────────────────
        {
          name: "list_universal_dynamic_groups",
          description: "[26R1] List all Universal Dynamic Groups defined in baramundi Management Suite. Returns a paged list with UDG id, name, comment, and folder assignment for each group. Universal Dynamic Groups are dynamic endpoint groups based on filter criteria. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              Name: { type: "string", description: "Filter results to match this exact Universal Dynamic Group name." },
              OrderBy: { type: "string", description: "Sort results by property name and direction (e.g. 'Name asc'). Possible values: Name, Comment." },
              SearchQuery: { type: "string", description: "Filter results by matching against searchable properties (Name, Comment)." },
              Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
              PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
            },
            required: []
          }
        },
        {
          name: "get_universal_dynamic_group",
          description: "[26R1] Get details of a specific Universal Dynamic Group by its GUID. Returns the UDG id, name, comment, folder id, and filter criteria definition from baramundi Management Suite. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "GUID of the Universal Dynamic Group to retrieve." }
            },
            required: ["id"]
          }
        },
        {
          name: "list_universal_dynamic_groups_by_folder",
          description: "[26R1] List all Universal Dynamic Groups contained in a specific folder identified by its GUID. Returns a paged list of UDGs within that folder with id, name, comment, and filter criteria details. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              folderId: { type: "string", description: "GUID of the folder to list Universal Dynamic Groups from." },
              Name: { type: "string", description: "Filter results to match this exact UDG name." },
              OrderBy: { type: "string", description: "Sort results by property name and direction." },
              SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
              Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
              PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
            },
            required: ["folderId"]
          }
        },

        // ── UDG Folders ──────────────────────────────────────────────────
        {
          name: "list_udg_folders",
          description: "[26R1] List all Universal Dynamic Groups folders in baramundi Management Suite. Returns a paged list with folder id, name, parent folder id, and comment for each folder in the UDG folder hierarchy. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              Name: { type: "string", description: "Filter results to match this exact folder name." },
              OrderBy: { type: "string", description: "Sort results by property name and direction (e.g. 'Name asc')." },
              SearchQuery: { type: "string", description: "Filter results by matching against folder name or comment." },
              Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
              PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
            },
            required: []
          }
        },
        {
          name: "get_udg_folder",
          description: "[26R1] Get details of a specific Universal Dynamic Groups folder by its GUID. Returns folder id, name, parent folder id, and comment for the specified folder in the baramundi Management Suite UDG hierarchy. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "GUID of the UDG folder to retrieve." }
            },
            required: ["id"]
          }
        },
        {
          name: "list_udg_folders_by_folder",
          description: "[26R1] List all sub-folders contained within a specific Universal Dynamic Groups folder identified by its GUID. Returns a paged list of child folders with id, name, parent id, and comment. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              folderId: { type: "string", description: "GUID of the parent UDG folder to list sub-folders for." },
              Name: { type: "string", description: "Filter results to match this exact folder name." },
              OrderBy: { type: "string", description: "Sort results by property name and direction." },
              SearchQuery: { type: "string", description: "Filter results by matching against folder name or comment." },
              Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
              PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
            },
            required: ["folderId"]
          }
        },
      ]
    };
  });

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!is26R1) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `${name} is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.`
      );
    }

    const getBconnect = (): BConnectClient => {
      dotenv.config();
      const baseUrl = process.env.BCONNECT_BASE_URL || "https://bms-server/bconnect";
      const username = process.env.BCONNECT_USERNAME;
      const password = process.env.BCONNECT_PASSWORD;

      if (!username || !password) {
        throw new McpError(
          ErrorCode.InternalError,
          "BCONNECT_USERNAME and BCONNECT_PASSWORD environment variables are required"
        );
      }

      const caCertPath = process.env.BCONNECT_CA_CERT_PATH;
      const caCert = caCertPath ? fs.readFileSync(caCertPath, "utf8") : undefined;

      const auditLevelRaw = process.env.BCONNECT_AUDIT_LEVEL ?? "none";
      const auditLevel = (["none", "security", "write", "all"] as const).includes(auditLevelRaw as never)
        ? (auditLevelRaw as "none" | "security" | "write" | "all")
        : "none";

      return new BConnectClient({
        baseUrl,
        username,
        password,
        rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
        ...(caCert && { ca: caCert }),
        auditLog: { level: auditLevel },
      });
    };

    try {
      const bconnect = getBconnect();
      const udg = bconnect.udg;

      switch (name) {

        case "list_universal_dynamic_groups": {
          const result = await udg.getUniversalDynamicGroups((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_universal_dynamic_group": {
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "get_universal_dynamic_group requires an id (GUID) string parameter");
          }
          const result = await udg.getUniversalDynamicGroup(args.id);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_universal_dynamic_groups_by_folder": {
          if (!args?.folderId || typeof args.folderId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "list_universal_dynamic_groups_by_folder requires a folderId (GUID) string parameter");
          }
          const { folderId, ...params } = args as Record<string, unknown>;
          const result = await udg.getUniversalDynamicGroupsByFolder(folderId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_udg_folders": {
          const result = await udg.getFolders((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_udg_folder": {
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "get_udg_folder requires an id (GUID) string parameter");
          }
          const result = await udg.getFolder(args.id);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_udg_folders_by_folder": {
          if (!args?.folderId || typeof args.folderId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "list_udg_folders_by_folder requires a folderId (GUID) string parameter");
          }
          const { folderId, ...params } = args as Record<string, unknown>;
          const result = await udg.getFoldersByFolder(folderId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `bConnect API error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  return { server };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  dotenv.config();
  

  
  // Startup connectivity check (REQ-SRV-013)
  dotenv.config();
  {
    const _startupUrl = process.env.BCONNECT_BASE_URL || "https://bms-win22srv:444/bconnect";
    const _startupUser = process.env.BCONNECT_USERNAME;
    const _startupPass = process.env.BCONNECT_PASSWORD;
    if (!_startupUser || !_startupPass) {
      console.error("bconnect-universaldynamicgroups-mcp: BCONNECT_USERNAME and BCONNECT_PASSWORD are required");
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
    console.error(`bconnect-universaldynamicgroups-mcp: verifying bConnect API connectivity...`);
    const _connected = await _startupClient.testConnection();
    if (!_connected) {
      console.error(`bconnect-universaldynamicgroups-mcp: cannot reach bConnect API at ${_startupUrl}. Check BCONNECT_BASE_URL, credentials, and network.`);
      process.exit(1);
    }
    console.error(`bconnect-universaldynamicgroups-mcp: API connectivity verified.`);
  }

  const { server } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("bconnect-universaldynamicgroups-mcp started");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
