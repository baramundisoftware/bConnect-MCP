#!/usr/bin/env node

/**
 * bconnect-updatemanagement-mcp
 *
 * A Model Context Protocol server that provides access to the baramundi
 * bConnect REST API for Update Management — listing and managing Windows
 * endpoint update profiles (Microsoft Update Management integration).
 *
 * Supports both 25R2 and 26R1.
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
  const server = new Server(
    {
      name: "bconnect-updatemanagement-mcp",
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
    return {
      tools: [
        {
          name: "list_update_management_endpoints",
          description: "List all Windows endpoints with their Microsoft Update Management status in baramundi Management Suite. Returns a paged list with endpoint name, update profile name, last inventory date, and last successful update timestamp for each endpoint.",
          inputSchema: {
            type: "object",
            properties: {
              OrderBy: { type: "string", description: "Sort results by property name and direction (e.g. 'EndpointName asc'). Possible values: EndpointName, LastInventory, LastSuccessfulUpdate." },
              SearchQuery: { type: "string", description: "Filter results by matching against EndpointName or UpdateProfileName." },
              Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
              PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
            },
            required: []
          }
        },
        {
          name: "get_update_management_endpoint",
          description: "Get the Microsoft Update Management status for a specific Windows endpoint identified by its GUID. Returns the endpoint name, assigned update profile name, last inventory date, last successful update date, and update profile configuration details.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "GUID of the Windows endpoint to retrieve Update Management status for." }
            },
            required: ["id"]
          }
        },
        {
          name: "update_update_management_endpoint",
          description: "Update the Microsoft Update Management profile assignment for a specific Windows endpoint using a JSON Patch document. Allows changing the assigned update profile or resetting it to null (no profile). Returns the updated endpoint with its new update profile configuration.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "GUID of the Windows endpoint to update the Update Management profile for." },
              patchOperations: {
                type: "array",
                description: "JSON Patch operations array. Use op=replace, path=/updateProfileId, value=<profile-guid> (or null to remove profile)."
              }
            },
            required: ["id", "patchOperations"]
          }
        },
      ]
    };
  });

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // ── Write-operation gate (REQ-SRV-012) ───────────────────────────────────
    const WRITE_TOOLS = new Set<string>([
    "update_update_management_endpoint",
    ]);
    if (WRITE_TOOLS.has(name) && process.env.ALLOW_WRITE_OPERATIONS !== "true") {
      return {
        content: [{
          type: "text" as const,
          text: `Write operation '${name}' is disabled. Set ALLOW_WRITE_OPERATIONS=true to enable write operations.`
        }],
        isError: true
      };
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
      const um = bconnect.updateManagement;

      switch (name) {

        case "list_update_management_endpoints": {
          const result = await um.getWindowsEndpoints((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_update_management_endpoint": {
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "get_update_management_endpoint requires an id (GUID) string parameter");
          }
          const result = await um.getWindowsEndpoint(args.id);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_update_management_endpoint": {
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "update_update_management_endpoint requires an id (GUID) string parameter");
          }
          if (!Array.isArray(args?.patchOperations)) {
            throw new McpError(ErrorCode.InvalidParams, "update_update_management_endpoint requires a patchOperations array");
          }
          const result = await um.updateWindowsEndpoint(args.id, args.patchOperations as never);
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
      console.error("bconnect-updatemanagement-mcp: BCONNECT_USERNAME and BCONNECT_PASSWORD are required");
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
    console.error(`bconnect-updatemanagement-mcp: verifying bConnect API connectivity...`);
    const _connected = await _startupClient.testConnection();
    if (!_connected) {
      console.error(`bconnect-updatemanagement-mcp: cannot reach bConnect API at ${_startupUrl}. Check BCONNECT_BASE_URL, credentials, and network.`);
      process.exit(1);
    }
    console.error(`bconnect-updatemanagement-mcp: API connectivity verified.`);
  }

  const { server } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("bconnect-updatemanagement-mcp started");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
