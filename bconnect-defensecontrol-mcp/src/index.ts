#!/usr/bin/env node

/**
 * bconnect-defensecontrol-mcp
 *
 * A Model Context Protocol server that provides access to the baramundi
 * bConnect REST API for Defense Control — BitLocker encryption management,
 * Local Admin account credentials, and Microsoft Defender threat monitoring.
 *
 * Supports both 25R2 and 26R1. Operations exclusive to 26R1 (get_bitlocker_secrets,
 * update_bitlocker_pin) are only registered when BCONNECT_RELEASE === '26R1'.
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
import { DefenseControlRules } from "./utils/mcp-tool-validation-rules.js";

// ─── Factory exported for testing ───────────────────────────────────────────

export function createServer(): { server: Server } {
  const release = process.env.BCONNECT_RELEASE ?? "25R2";
  const is26R1 = release === "26R1";

  const server = new Server(
    {
      name: "bconnect-defensecontrol-mcp",
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

      // ── BitLocker ──────────────────────────────────────────────────────
      {
        name: "list_bitlocker_windows_endpoints",
        description: "List all Windows endpoints with BitLocker encryption status managed in baramundi Management Suite. Returns a paged list with volume data, encryption status, BitLocker version, and protection state for each endpoint.",
        inputSchema: {
          type: "object",
          properties: {
            OrderBy: { type: "string", description: "Sort results by property name and direction (e.g. 'EndpointName asc')." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
            Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
            PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
          },
          required: []
        }
      },
      {
        name: "get_bitlocker_windows_endpoint",
        description: "Get the BitLocker encryption status and volume details for a specific Windows endpoint identified by its GUID. Returns volume data, conversion status, encryption percentage, BitLocker version, and protection state for the endpoint.",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "GUID of the Windows endpoint to retrieve BitLocker status for." }
          },
          required: ["endpointId"]
        }
      },

      // ── Local Admin ────────────────────────────────────────────────────
      {
        name: "get_local_admin_accounts",
        description: "Get the Local Administrator account credentials for a specific Windows endpoint managed in baramundi Management Suite. Returns the current local admin account details including username and password managed by baramundi LAPS.",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "GUID of the Windows endpoint to retrieve local admin account credentials for." }
          },
          required: ["endpointId"]
        }
      },
      {
        name: "patch_local_admin_user_credentials",
        description: "Update the Local Administrator account credentials for a specific Windows endpoint using a JSON Patch document. Allows modifying password or username for the managed local admin account on the specified baramundi-managed Windows endpoint.",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "GUID of the Windows endpoint to patch local admin credentials for." },
            patchOperations: {
              type: "array",
              description: "JSON Patch operations array. Each item has op (replace/add/remove), path (JSON path), and value fields."
            }
          },
          required: ["endpointId", "patchOperations"]
        }
      },
      {
        name: "trigger_update_on_client",
        description: "Trigger an immediate update of managed information on a specific Windows endpoint client in baramundi Management Suite. Forces the baramundi client to refresh its managed data from the server, with an optional timeout for the operation.",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "GUID of the Windows endpoint to trigger the update on." },
            timeout: { type: "number", description: "Optional timeout in seconds to wait for the update to complete." }
          },
          required: ["endpointId"]
        }
      },

      // ── Microsoft Defender Threats ─────────────────────────────────────
      {
        name: "list_defender_threats",
        description: "List all Microsoft Defender threat detections across all Windows endpoints managed in baramundi Management Suite. Returns a paged list of threats with threat identifiers, names, severity, categories, and detection status information.",
        inputSchema: {
          type: "object",
          properties: {
            OrderBy: { type: "string", description: "Sort results by property name and direction (e.g. 'ThreatName asc')." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable threat properties." },
            Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
            PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
          },
          required: []
        }
      },
      {
        name: "get_defender_threat",
        description: "Get the details of a specific Microsoft Defender threat detection by its GUID. Returns threat name, severity, category, detection status, and affected endpoint information for the specified threat recorded in baramundi Management Suite.",
        inputSchema: {
          type: "object",
          properties: {
            threatId: { type: "string", description: "GUID of the Microsoft Defender threat to retrieve details for." }
          },
          required: ["threatId"]
        }
      },
      {
        name: "list_defender_threats_by_endpoint",
        description: "List all Microsoft Defender threat detections for a specific Windows endpoint identified by its GUID. Returns a paged list of threats detected on that endpoint including threat names, severity levels, and detection timestamps.",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "GUID of the Windows endpoint to retrieve Defender threats for." },
            OrderBy: { type: "string", description: "Sort results by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by matching against threat properties." },
            Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
            PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
          },
          required: ["endpointId"]
        }
      },
      {
        name: "list_defender_threats_by_logical_group",
        description: "List all Microsoft Defender threat detections for endpoints within a specific logical group identified by its GUID. Returns a paged list of threats across all endpoints in that group with threat details and endpoint names.",
        inputSchema: {
          type: "object",
          properties: {
            logicalGroupId: { type: "string", description: "GUID of the logical group to retrieve Defender threats for." },
            OrderBy: { type: "string", description: "Sort results by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by matching against threat properties." },
            Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
            PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
          },
          required: ["logicalGroupId"]
        }
      },

      // ── Microsoft Defender States ──────────────────────────────────────
      {
        name: "list_defender_windows_endpoints",
        description: "List all Windows endpoints with Microsoft Defender status managed in baramundi Management Suite. Returns a paged list of endpoints with Defender protection state, real-time protection status, signature version, and last scan information.",
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
        name: "get_defender_windows_endpoint",
        description: "Get the Microsoft Defender status for a specific Windows endpoint identified by its GUID. Returns the Defender protection state, real-time protection enabled status, signature version, engine version, and last full scan timestamp.",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "GUID of the Windows endpoint to retrieve Microsoft Defender status for." }
          },
          required: ["endpointId"]
        }
      },
    ];

    // 26R1-only tools
    if (is26R1) {
      tools.splice(2, 0,
        {
          name: "get_bitlocker_secrets",
          description: "[26R1] Get the BitLocker secrets including recovery keys and startup PIN for a specific Windows endpoint. Returns the initial startup PIN and BitLocker recovery keys stored for the specified managed Windows endpoint. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              endpointId: { type: "string", description: "GUID of the Windows endpoint to retrieve BitLocker secrets for." }
            },
            required: ["endpointId"]
          }
        },
        {
          name: "update_bitlocker_pin",
          description: "[26R1] Update the BitLocker startup PIN for a specific Windows endpoint using a JSON Patch document. Modifies the InitialStartupPin field for the specified managed Windows endpoint and returns the updated BitLocker secrets. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              endpointId: { type: "string", description: "GUID of the Windows endpoint to update the BitLocker PIN for." },
              patchOperations: {
                type: "array",
                description: "JSON Patch operations array. Use op=replace, path=/InitialStartupPin, value=<new-pin>."
              }
            },
            required: ["endpointId", "patchOperations"]
          }
        }
      );
    }

    return { tools };
  });

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  // ── Argument-validation pre-pass (runs before write-gate or bConnect setup) ─
  function validateToolArguments(name: string, args: Record<string, unknown> | undefined): void {
    switch (name) {
      case "list_bitlocker_windows_endpoints":
        validateOrThrow(args, DefenseControlRules.listBitlockerWindowsEndpoints());
        return;
      case "get_bitlocker_windows_endpoint":
        validateOrThrow(args, DefenseControlRules.getBitlockerWindowsEndpoint());
        return;
      case "get_bitlocker_secrets":
        validateOrThrow(args, DefenseControlRules.getBitlockerSecrets());
        return;
      case "update_bitlocker_pin":
        validateOrThrow(args, DefenseControlRules.updateBitlockerPin());
        return;
      case "get_local_admin_accounts":
        validateOrThrow(args, DefenseControlRules.getLocalAdminAccounts());
        return;
      case "patch_local_admin_user_credentials":
        validateOrThrow(args, DefenseControlRules.patchLocalAdminUserCredentials());
        return;
      case "trigger_update_on_client":
        validateOrThrow(args, DefenseControlRules.triggerUpdateOnClient());
        return;
      case "list_defender_threats":
        validateOrThrow(args, DefenseControlRules.listDefenderThreats());
        return;
      case "get_defender_threat":
        validateOrThrow(args, DefenseControlRules.getDefenderThreat());
        return;
      case "list_defender_threats_by_endpoint":
        validateOrThrow(args, DefenseControlRules.listDefenderThreatsByEndpoint());
        return;
      case "list_defender_threats_by_logical_group":
        validateOrThrow(args, DefenseControlRules.listDefenderThreatsByLogicalGroup());
        return;
      case "list_defender_windows_endpoints":
        validateOrThrow(args, DefenseControlRules.listDefenderWindowsEndpoints());
        return;
      case "get_defender_windows_endpoint":
        validateOrThrow(args, DefenseControlRules.getDefenderWindowsEndpoint());
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
    "update_bitlocker_pin",
    "patch_local_admin_user_credentials",
    "trigger_update_on_client",
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
      const apiKey = process.env.BCONNECT_API_KEY;

      if (!apiKey && (!username || !password)) {
        throw new McpError(
          ErrorCode.InternalError,
          "Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD environment variables are required"
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
      const dc = bconnect.defenseControl;

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        case "list_bitlocker_windows_endpoints": {
          const result = await dc.getBitLockerWindowsEndpoints((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_bitlocker_windows_endpoint": {
          const result = await dc.getBitLockerWindowsEndpoint(args!.endpointId as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_bitlocker_secrets": {
          if (!is26R1) {
            throw new McpError(ErrorCode.MethodNotFound, "get_bitlocker_secrets is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");
          }
          const result = await dc.getBitLockerSecrets(args!.endpointId as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_bitlocker_pin": {
          if (!is26R1) {
            throw new McpError(ErrorCode.MethodNotFound, "update_bitlocker_pin is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");
          }
          const result = await dc.updateBitLockerPin(args!.endpointId as string, args!.patchOperations as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_local_admin_accounts": {
          const result = await dc.getLocalAdministrativeAccounts(args!.endpointId as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "patch_local_admin_user_credentials": {
          const result = await dc.patchLocalAdminUserCredentials(args!.endpointId as string, args!.patchOperations as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "trigger_update_on_client": {
          const timeout = typeof args?.timeout === "number" ? args.timeout : undefined;
          const result = await dc.triggerUpdateOnClient(args!.endpointId as string, timeout);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_defender_threats": {
          const result = await dc.getMicrosoftDefenderThreats((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_defender_threat": {
          const result = await dc.getMicrosoftDefenderThreat(args!.threatId as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_defender_threats_by_endpoint": {
          const { endpointId, ...params } = args as Record<string, unknown>;
          const result = await dc.getMicrosoftDefenderThreatsByEndpoint(endpointId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_defender_threats_by_logical_group": {
          const { logicalGroupId, ...params } = args as Record<string, unknown>;
          const result = await dc.getMicrosoftDefenderThreatsByLogicalGroup(logicalGroupId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_defender_windows_endpoints": {
          const result = await dc.getMicrosoftDefenderWindowsEndpoints((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_defender_windows_endpoint": {
          const result = await dc.getMicrosoftDefenderWindowsEndpoint(args!.endpointId as string);
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
      console.error("bconnect-defensecontrol-mcp: Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required");
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
    console.error(`bconnect-defensecontrol-mcp: verifying bConnect API connectivity...`);
    const _connected = await _startupClient.testConnection();
    if (!_connected) {
      console.error(`bconnect-defensecontrol-mcp: cannot reach bConnect API at ${_startupUrl}. Check BCONNECT_BASE_URL, credentials, and network.`);
      process.exit(1);
    }
    console.error(`bconnect-defensecontrol-mcp: API connectivity verified.`);
  }

  const transportMode = process.env.MCP_TRANSPORT ?? "stdio";
  const port = parseInt(process.env.MCP_PORT ?? "3000", 10);
  const serverName = "bconnect-defensecontrol-mcp";

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
