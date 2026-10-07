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
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { BConnectClient } from "./bconnect-client.js";
import { validateOrThrow, toolErrorResult, lazyClient, declaredArgumentsOnly, pickArguments, queryParameters, withQueryProperties, withCountOnly, serverClients, runServer, withToolAnnotations, toolJsonResult, selectedRelease, withReleaseTools, refuseUnavailableTool } from "@bconnect/mcp-core";
import { QUERY_PARAMETERS } from "./query-params.js";
import { TOOL_RELEASES } from "./tool-releases.js";
import { TOOL_METHODS } from "./tool-methods.js";

/** The query parameters a list tool sends: exactly what its route declares in the selected release (#179). */
const sends = (tool: string): string[] => queryParameters(QUERY_PARAMETERS, selectedRelease(), tool);
import type { BConnectCredentials } from "@bconnect/mcp-core";
import { UdgRules } from "./utils/mcp-tool-validation-rules.js";

// ─── Factory exported for testing ───────────────────────────────────────────

export type { BConnectCredentials } from "@bconnect/mcp-core";

/** The server's bConnect clients: one shared by every tool call (REQ-SRV-023). */
const clients = serverClients(BConnectClient);

export function createServer(credentials?: BConnectCredentials): { server: Server } {
  const release = selectedRelease();

  const server = new Server(
    {
      name: "bconnect-universaldynamicgroups-mcp",
      version: "26.1.9"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── ListToolsRequestSchema handler ────────────────────────────────────────

  const toolCatalog = declaredArgumentsOnly(withQueryProperties(QUERY_PARAMETERS, () => selectedRelease(), async () => {

    return {
      tools: [
        // ── Universal Dynamic Groups ─────────────────────────────────────
        {
          name: "list_universal_dynamic_groups",
          description: "[26R1] List all Universal Dynamic Groups defined in baramundi Management Suite. Returns a paged list with UDG id, name, comment, and folder assignment for each group. Universal Dynamic Groups are dynamic endpoint groups based on filter criteria. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {},
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
            properties: {},
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
            },
            required: ["folderId"]
          }
        },
      ]
    };
  }));
  server.setRequestHandler(ListToolsRequestSchema, withReleaseTools(TOOL_RELEASES, withToolAnnotations(TOOL_METHODS, toolCatalog.list)));

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  // ── Argument-validation pre-pass (runs before getBconnect) ─────────────────
  function validateToolArguments(name: string, args: Record<string, unknown> | undefined): void {
    switch (name) {
      case "list_universal_dynamic_groups":
        validateOrThrow(args, UdgRules.listUniversalDynamicGroups());
        return;
      case "get_universal_dynamic_group":
        validateOrThrow(args, UdgRules.getUniversalDynamicGroup());
        return;
      case "list_universal_dynamic_groups_by_folder":
        validateOrThrow(args, UdgRules.listUniversalDynamicGroupsByFolder());
        return;
      case "list_udg_folders":
        validateOrThrow(args, UdgRules.listUdgFolders());
        return;
      case "get_udg_folder":
        validateOrThrow(args, UdgRules.getUdgFolder());
        return;
      case "list_udg_folders_by_folder":
        validateOrThrow(args, UdgRules.listUdgFoldersByFolder());
        return;
      // Unknown tool names are not validated here; dispatch handles MethodNotFound.
    }
  }

  // countOnly (#165): count with one 1-row request instead of loading a page.
  server.setRequestHandler(CallToolRequestSchema, withCountOnly(QUERY_PARAMETERS, () => selectedRelease(), async (request) => {
    const { name, arguments: args } = request.params;
    // A tool the selected release lacks is refused by name first, before its arguments are
    // checked against a schema the release doesn't list, and before anything is sent (#159).
    refuseUnavailableTool(TOOL_RELEASES, name);
    // Refuse arguments the tool doesn't declare, before anything else (REQ-SRV-022).
    await toolCatalog.refuseUndeclared(name, args);

    // Validate arguments first — pure, no side effects, fails fast on bad input.
    validateToolArguments(name, args);

    const getBconnect = (): BConnectClient => {
      // The server's shared client (REQ-SRV-023). A ClientConfigError (e.g. missing
      // credentials) reaches the catch below and becomes a tool result (REQ-XC-001).
      return clients.get(credentials);
    };

    try {
      const bconnect = lazyClient(getBconnect);
      const udg = lazyClient(() => bconnect.udg);

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        case "list_universal_dynamic_groups": {
          const result = await udg.getUniversalDynamicGroups(pickArguments(args ?? {}, sends("list_universal_dynamic_groups")));
          return toolJsonResult(result);
        }

        case "get_universal_dynamic_group": {
          const result = await udg.getUniversalDynamicGroup(args!.id as string);
          return toolJsonResult(result);
        }

        case "list_universal_dynamic_groups_by_folder": {
          const { folderId, ...params } = args as Record<string, unknown>;
          const result = await udg.getUniversalDynamicGroupsByFolder(folderId as string, pickArguments(params, sends("list_universal_dynamic_groups_by_folder")));
          return toolJsonResult(result);
        }

        case "list_udg_folders": {
          const result = await udg.getFolders(pickArguments(args ?? {}, sends("list_udg_folders")));
          return toolJsonResult(result);
        }

        case "get_udg_folder": {
          const result = await udg.getFolder(args!.id as string);
          return toolJsonResult(result);
        }

        case "list_udg_folders_by_folder": {
          const { folderId, ...params } = args as Record<string, unknown>;
          const result = await udg.getFoldersByFolder(folderId as string, pickArguments(params, sends("list_udg_folders_by_folder")));
          return toolJsonResult(result);
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      // API errors, gate refusals and configuration errors are tool results the
      // model can read; only McpErrors stay protocol errors (REQ-XC-001).
      return toolErrorResult(error, release);
    }
  }));

  return { server };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

runServer({ name: "bconnect-universaldynamicgroups-mcp", createServer, clients, releases: TOOL_RELEASES });
