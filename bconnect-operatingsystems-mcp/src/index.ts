#!/usr/bin/env node

/**
 * bconnect-operatingsystems-mcp
 *
 * A Model Context Protocol server that provides access to the baramundi
 * bConnect REST API for Operating Systems — OS folders and Windows endpoint
 * OS installation information.
 *
 * All 9 tools work in both 25R2 and 26R1.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { BConnectClient } from "./bconnect-client.js";
import { validateOrThrow, toolErrorResult, lazyClient, withUnverifiedWriteMarker, declaredArgumentsOnly, pickArguments, queryParameters, withQueryProperties, serverClients, runServer, withToolAnnotations, withWriteToolsHidden, toolJsonResult } from "@bconnect/mcp-core";
import { QUERY_PARAMETERS } from "./query-params.js";
import { TOOL_METHODS } from "./tool-methods.js";

/** The query parameters a list tool sends: exactly what its route declares in the selected release (#179). */
const sends = (tool: string): string[] => queryParameters(QUERY_PARAMETERS, process.env.BCONNECT_RELEASE, tool);
import type { BConnectCredentials } from "@bconnect/mcp-core";
import { OperatingSystemsRules } from "./utils/mcp-tool-validation-rules.js";

// ─── Factory exported for testing ───────────────────────────────────────────

export type { BConnectCredentials } from "@bconnect/mcp-core";

/** The server's bConnect clients: one shared by every tool call (REQ-SRV-023). */
const clients = serverClients(BConnectClient);

export function createServer(credentials?: BConnectCredentials): { server: Server } {
  const server = new Server(
    {
      name: "bconnect-operatingsystems-mcp",
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
  "create_os_folder",
  "update_os_folder",
  "delete_os_folder",
  "update_os_windows_endpoint",
  ]);

  const toolCatalog = declaredArgumentsOnly(withQueryProperties(QUERY_PARAMETERS, () => process.env.BCONNECT_RELEASE, withUnverifiedWriteMarker(WRITE_TOOLS, async () => {
    const tools = [

      // ── OS Folders ────────────────────────────────────────────────────────
      {
        name: "list_os_folders",
        description: "List all Operating Systems folders in baramundi Management Suite. Returns a paged list of OS folders used to organize operating system configurations with their names, IDs, and hierarchy structure.",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "get_os_folder",
        description: "Get the details of a specific Operating Systems folder by its GUID. Returns the folder name, ID, parent folder reference, and other metadata for the specified OS folder in baramundi Management Suite.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the OS folder to retrieve." }
          },
          required: ["id"]
        }
      },
      {
        name: "list_os_folders_by_folder",
        description: "List all sub-folders within a specific Operating Systems folder identified by its GUID. Returns a paged list of child OS folders contained within the specified parent folder in baramundi Management Suite.",
        inputSchema: {
          type: "object",
          properties: {
            folderId: { type: "string", description: "GUID of the parent OS folder whose sub-folders should be listed." },
          },
          required: ["folderId"]
        }
      },

      // ── Windows Endpoints OS Info ─────────────────────────────────────────
      {
        name: "list_os_windows_endpoints",
        description: "List all Windows endpoints with Operating System installation information managed in baramundi Management Suite. Returns a paged list of Windows endpoints including their OS installation configuration, target OS details, and installation status.",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "get_os_windows_endpoint",
        description: "Get the Operating System installation configuration for a specific Windows endpoint identified by its GUID. Returns the target OS details, installation parameters, and configuration settings for the specified Windows endpoint in baramundi Management Suite.",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "GUID of the Windows endpoint to retrieve OS installation configuration for." }
          },
          required: ["endpointId"]
        }
      },

      // ── OS Folder Write Operations ────────────────────────────────────────
      {
        name: "create_os_folder",
        description: "Create a new Operating Systems folder in baramundi Management Suite. Accepts folder creation data including name and optional parent folder ID, and returns the newly created OS folder with its assigned GUID and metadata.",
        inputSchema: {
          type: "object",
          properties: {
            folderData: {
              type: "object",
              description: "Folder creation properties including Name and optional ParentId."
            }
          },
          required: ["folderData"]
        }
      },
      {
        name: "update_os_folder",
        description: "Update an existing Operating Systems folder using a JSON Patch document. Applies patch operations to modify the specified OS folder properties such as name or parent folder in baramundi Management Suite and returns the updated folder.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the OS folder to update." },
            patchOperations: {
              type: "array",
              description: "JSON Patch operations array. Each item has op (replace/add/remove), path (JSON path), and value fields."
            }
          },
          required: ["id", "patchOperations"]
        }
      },
      {
        name: "delete_os_folder",
        description: "Delete an Operating Systems folder by its GUID. The folder must be empty before deletion. Permanently removes the specified OS folder from baramundi Management Suite. Returns no content on success.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the OS folder to delete. The folder must be empty." }
          },
          required: ["id"]
        }
      },

      // ── Windows Endpoint OS Write Operations ─────────────────────────────
      {
        name: "update_os_windows_endpoint",
        description: "Update the Operating System installation configuration for a specific Windows endpoint using a JSON Patch document. Applies patch operations to modify the OS installation settings for the specified Windows endpoint in baramundi Management Suite.",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "GUID of the Windows endpoint to update OS installation configuration for." },
            patchOperations: {
              type: "array",
              description: "JSON Patch operations array. Each item has op (replace/add/remove), path (JSON path), and value fields."
            }
          },
          required: ["endpointId", "patchOperations"]
        }
      },
    ];

    return { tools };
  })));
  // With writes off, tools/list leaves out the write tools; the gate still refuses them by name (REQ-SRV-026).
  server.setRequestHandler(ListToolsRequestSchema, withWriteToolsHidden(TOOL_METHODS, () => process.env.ALLOW_WRITE_OPERATIONS === "true",
    withToolAnnotations(TOOL_METHODS, toolCatalog.list)));

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  // ── Argument-validation pre-pass (runs before write-gate or bConnect setup) ─
  function validateToolArguments(name: string, args: Record<string, unknown> | undefined): void {
    switch (name) {
      case "list_os_folders":
        validateOrThrow(args, OperatingSystemsRules.listOsFolders());
        return;
      case "get_os_folder":
        validateOrThrow(args, OperatingSystemsRules.getOsFolder());
        return;
      case "list_os_folders_by_folder":
        validateOrThrow(args, OperatingSystemsRules.listOsFoldersByFolder());
        return;
      case "list_os_windows_endpoints":
        validateOrThrow(args, OperatingSystemsRules.listOsWindowsEndpoints());
        return;
      case "get_os_windows_endpoint":
        validateOrThrow(args, OperatingSystemsRules.getOsWindowsEndpoint());
        return;
      case "create_os_folder":
        validateOrThrow(args, OperatingSystemsRules.createOsFolder());
        return;
      case "update_os_folder":
        validateOrThrow(args, OperatingSystemsRules.updateOsFolder());
        return;
      case "delete_os_folder":
        validateOrThrow(args, OperatingSystemsRules.deleteOsFolder());
        return;
      case "update_os_windows_endpoint":
        validateOrThrow(args, OperatingSystemsRules.updateOsWindowsEndpoint());
        return;
      // Unknown tool names are not validated here; dispatch handles MethodNotFound.
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
      const os = lazyClient(() => bconnect.operatingSystems);

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        case "list_os_folders": {
          const result = await os.getFolders(pickArguments(args ?? {}, sends("list_os_folders")));
          return toolJsonResult(result);
        }

        case "get_os_folder": {
          const result = await os.getFolder(args!.id as string);
          return toolJsonResult(result);
        }

        case "list_os_folders_by_folder": {
          const { folderId, ...params } = args as Record<string, unknown>;
          const result = await os.getFoldersByFolderId(folderId as string, pickArguments(params, sends("list_os_folders_by_folder")));
          return toolJsonResult(result);
        }

        case "list_os_windows_endpoints": {
          const result = await os.getWindowsEndpoints(pickArguments(args ?? {}, sends("list_os_windows_endpoints")));
          return toolJsonResult(result);
        }

        case "get_os_windows_endpoint": {
          const result = await os.getWindowsEndpoint(args!.endpointId as string);
          return toolJsonResult(result);
        }

        case "create_os_folder": {
          const result = await os.createFolder(args!.folderData as never);
          return toolJsonResult(result);
        }

        case "update_os_folder": {
          const result = await os.updateFolder(args!.id as string, args!.patchOperations as never);
          return toolJsonResult(result);
        }

        case "delete_os_folder": {
          await os.deleteFolder(args!.id as string);
          return toolJsonResult({ success: true });
        }

        case "update_os_windows_endpoint": {
          const result = await os.updateWindowsEndpoint(args!.endpointId as string, args!.patchOperations as never);
          return toolJsonResult(result);
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

runServer({ name: "bconnect-operatingsystems-mcp", createServer, clients });
