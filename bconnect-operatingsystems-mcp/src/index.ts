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
import { validateOrThrow } from "./utils/parameter-validator.js";
import { OperatingSystemsRules } from "./utils/mcp-tool-validation-rules.js";

// ─── Factory exported for testing ───────────────────────────────────────────

export interface BConnectCredentials {
  baseUrl?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

export function createServer(credentials?: BConnectCredentials): { server: Server } {
  const server = new Server(
    {
      name: "bconnect-operatingsystems-mcp",
      version: "26.1.1"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── ListToolsRequestSchema handler ────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = [

      // ── OS Folders ────────────────────────────────────────────────────────
      {
        name: "list_os_folders",
        description: "List all Operating Systems folders in baramundi Management Suite. Returns a paged list of OS folders used to organize operating system configurations with their names, IDs, and hierarchy structure.",
        inputSchema: {
          type: "object",
          properties: {
            OrderBy: { type: "string", description: "Sort results by property name and direction (e.g. 'Name asc')." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
            Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
            PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
          },
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
            OrderBy: { type: "string", description: "Sort results by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
            Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
            PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
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
          properties: {
            OrderBy: { type: "string", description: "Sort results by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
            Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
            PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
          },
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
  });

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

    // 1. Validate arguments first — pure, no side effects, fails fast on bad input.
    validateToolArguments(name, args);

    // 2. Write-operation gate (REQ-SRV-012).
    const WRITE_TOOLS = new Set<string>([
    "create_os_folder",
    "update_os_folder",
    "delete_os_folder",
    "update_os_windows_endpoint",
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
      const baseUrl = credentials?.baseUrl ?? process.env.BCONNECT_BASE_URL ?? "https://bms-server/bconnect";
      const username = credentials?.username ?? process.env.BCONNECT_USERNAME;
      const password = credentials?.password ?? process.env.BCONNECT_PASSWORD;
      const apiKey = credentials?.apiKey ?? process.env.BCONNECT_API_KEY;

      if (!apiKey && (!username || !password)) {
        throw new McpError(
          ErrorCode.InternalError,
          "Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required"
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
        apiKey,
        rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
        ...(caCert && { ca: caCert }),
        auditLog: { level: auditLevel },
      });
    };

    try {
      const bconnect = getBconnect();
      const os = bconnect.operatingSystems;

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        case "list_os_folders": {
          const result = await os.getFolders((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_os_folder": {
          const result = await os.getFolder(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_os_folders_by_folder": {
          const { folderId, ...params } = args as Record<string, unknown>;
          const result = await os.getFoldersByFolderId(folderId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_os_windows_endpoints": {
          const result = await os.getWindowsEndpoints((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_os_windows_endpoint": {
          const result = await os.getWindowsEndpoint(args!.endpointId as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "create_os_folder": {
          const result = await os.createFolder(args!.folderData as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_os_folder": {
          const result = await os.updateFolder(args!.id as string, args!.patchOperations as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "delete_os_folder": {
          await os.deleteFolder(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify({ success: true }, null, 2) }] };
        }

        case "update_os_windows_endpoint": {
          const result = await os.updateWindowsEndpoint(args!.endpointId as string, args!.patchOperations as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      if (error instanceof McpError) {throw error;}
      throw new McpError(
        ErrorCode.InternalError,
        `bConnect API error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  return { server };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  dotenv.config();


  
  // Startup connectivity check (REQ-SRV-013)
  dotenv.config();
  {
    const _startupUrl = process.env.BCONNECT_BASE_URL || "https://bms.example.com:444/bconnect";
    const _startupUser = process.env.BCONNECT_USERNAME;
    const _startupPass = process.env.BCONNECT_PASSWORD;
    const _startupApiKey = process.env.BCONNECT_API_KEY;
    if (!_startupApiKey && (!_startupUser || !_startupPass)) {
      console.error("bconnect-operatingsystems-mcp: Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required");
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
    console.error(`bconnect-operatingsystems-mcp: verifying bConnect API connectivity...`);
    const _connected = await _startupClient.testConnection();
    if (!_connected) {
      console.error(`bconnect-operatingsystems-mcp: cannot reach bConnect API at ${_startupUrl}. Check BCONNECT_BASE_URL, credentials, and network.`);
      process.exit(1);
    }
    console.error(`bconnect-operatingsystems-mcp: API connectivity verified.`);
  }

  const transportMode = process.env.MCP_TRANSPORT ?? "stdio";
  const port = parseInt(process.env.MCP_PORT ?? "3000", 10);
  const serverName = "bconnect-operatingsystems-mcp";

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

if (!process.env.VITEST) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
