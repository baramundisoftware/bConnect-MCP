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
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { BConnectClient } from "./bconnect-client.js";
import { validateOrThrow, toolErrorResult, lazyClient, withUnverifiedWriteMarker, declaredArgumentsOnly, pickArguments, queryParameters, withQueryProperties, serverClients, runServer } from "@bconnect/mcp-core";
import { QUERY_PARAMETERS } from "./query-params.js";

/** The query parameters a list tool sends: exactly what its route declares in the selected release (#179). */
const sends = (tool: string): string[] => queryParameters(QUERY_PARAMETERS, process.env.BCONNECT_RELEASE, tool);
import type { BConnectCredentials } from "@bconnect/mcp-core";
import { UpdateManagementRules } from "./utils/mcp-tool-validation-rules.js";

// ─── Factory exported for testing ───────────────────────────────────────────

export type { BConnectCredentials } from "@bconnect/mcp-core";

/** The server's bConnect clients: one shared by every tool call (REQ-SRV-023). */
const clients = serverClients(BConnectClient);

export function createServer(credentials?: BConnectCredentials): { server: Server } {
  const server = new Server(
    {
      name: "bconnect-updatemanagement-mcp",
      version: "26.1.9"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── ListToolsRequestSchema handler ────────────────────────────────────────

  // Write tools: gated by ALLOW_WRITE_OPERATIONS, and marked unverified in tools/list
  // until their live check is recorded (REQ-XC-003 AC 5).
  const WRITE_TOOLS = new Set<string>([
  "update_update_management_endpoint",
  ]);

  const toolCatalog = declaredArgumentsOnly(withQueryProperties(QUERY_PARAMETERS, () => process.env.BCONNECT_RELEASE, withUnverifiedWriteMarker(WRITE_TOOLS, async () => {
    return {
      tools: [
        {
          name: "list_update_management_endpoints",
          description: "List all Windows endpoints with their Microsoft Update Management status in baramundi Management Suite. Returns a paged list with endpoint name, update profile name, last inventory date, and last successful update timestamp for each endpoint.",
          inputSchema: {
            type: "object",
            properties: {},
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
  })));
  server.setRequestHandler(ListToolsRequestSchema, toolCatalog.list);

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  // ── Argument-validation pre-pass (runs before write-gate or bConnect setup) ─
  function validateToolArguments(name: string, args: Record<string, unknown> | undefined): void {
    switch (name) {
      case "list_update_management_endpoints":
        validateOrThrow(args, UpdateManagementRules.listUpdateManagementEndpoints());
        return;
      case "get_update_management_endpoint":
        validateOrThrow(args, UpdateManagementRules.getUpdateManagementEndpoint());
        return;
      case "update_update_management_endpoint":
        validateOrThrow(args, UpdateManagementRules.updateUpdateManagementEndpoint());
        return;
      // Unknown tool names are not validated here; the dispatch switch below
      // handles them with MethodNotFound.
    }
  }

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    // Refuse arguments the tool doesn't declare, before anything else (REQ-SRV-022).
    await toolCatalog.refuseUndeclared(name, args);

    // 1. Validate arguments first — pure, no side effects, fails fast on bad input.
    validateToolArguments(name, args);

    // 2. Write-operation gate (REQ-SRV-012).
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
      // The server's shared client (REQ-SRV-023). A ClientConfigError (e.g. missing
      // credentials) reaches the catch below and becomes a tool result (REQ-XC-001).
      return clients.get(credentials);
    };

    try {
      const bconnect = lazyClient(getBconnect);
      const um = lazyClient(() => bconnect.updateManagement);

      // 4. Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        case "list_update_management_endpoints": {
          const result = await um.getWindowsEndpoints(pickArguments(args ?? {}, sends("list_update_management_endpoints")));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_update_management_endpoint": {
          const result = await um.getWindowsEndpoint(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_update_management_endpoint": {
          const result = await um.updateWindowsEndpoint(args!.id as string, args!.patchOperations as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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

// ─── Entry point ─────────────────────────────────────────────────────────────

runServer({ name: "bconnect-updatemanagement-mcp", createServer, clients });
