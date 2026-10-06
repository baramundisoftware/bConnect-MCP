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
import { DefenseControlRules } from "./utils/mcp-tool-validation-rules.js";

// ─── Factory exported for testing ───────────────────────────────────────────

export type { BConnectCredentials } from "@bconnect/mcp-core";

/** The server's bConnect clients: one shared by every tool call (REQ-SRV-023). */
const clients = serverClients(BConnectClient);

export function createServer(credentials?: BConnectCredentials): { server: Server } {
  const release = process.env.BCONNECT_RELEASE ?? "26R1";
  const is26R1 = release === "26R1";

  const server = new Server(
    {
      name: "bconnect-defensecontrol-mcp",
      version: "26.1.9"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── ListToolsRequestSchema handler ────────────────────────────────────────

  // Old tool names that answer with the new one instead of "unknown tool" (#177).
  const RENAMED_TOOLS = new Map<string, string>([
    ["trigger_update_on_client", "refresh_local_admin_account_expiry"],
  ]);

  // Write tools: gated by ALLOW_WRITE_OPERATIONS, and marked unverified in tools/list
  // until their live check is recorded (REQ-XC-003 AC 5).
  const WRITE_TOOLS = new Set<string>([
  "update_bitlocker_pin",
  "patch_local_admin_user_credentials",
  "refresh_local_admin_account_expiry",
  ]);

  const toolCatalog = declaredArgumentsOnly(withQueryProperties(QUERY_PARAMETERS, () => process.env.BCONNECT_RELEASE, withUnverifiedWriteMarker(WRITE_TOOLS, async () => {
    const tools: object[] = [

      // ── BitLocker ──────────────────────────────────────────────────────
      {
        name: "list_bitlocker_windows_endpoints",
        description: "List all Windows endpoints with BitLocker encryption status managed in baramundi Management Suite. Returns a paged list with volume data, encryption status, BitLocker version, and protection state for each endpoint.",
        inputSchema: {
          type: "object",
          properties: {},
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
        description: "Set the requested expiration date of the managed local administrator account on a Windows endpoint. This is the only thing the operation can change: it can't set a password or user name. A date in the past makes the client generate new credentials. The requested date applies once the client acknowledges it (then the account's expiration date holds the new value); use refresh_local_admin_account_expiry to ask an online client to apply it now. Returns the current local administrator account, which includes its credentials.",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "GUID of the Windows endpoint." },
            requestedExpirationDate: {
              type: "string",
              format: "date-time",
              description: "New expiration date of the local administrator account, ISO 8601 with time zone (e.g. '2026-01-01T00:00:00Z'). A date in the past makes the client generate new credentials."
            }
          },
          required: ["endpointId", "requestedExpirationDate"]
        }
      },
      {
        name: "refresh_local_admin_account_expiry",
        description: "Ask a Windows endpoint's client to apply the requested expiration date of its managed local administrator account now (set it with patch_local_admin_user_credentials). Only works while the client is online. Returns true if the client changed its expiration date, false if it couldn't be reached. It does not refresh any other client data.",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "GUID of the Windows endpoint." },
            timeout: { type: "integer", minimum: 0, maximum: 60, description: "Seconds to wait for the client, 0 to 60 (default 30)." }
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
          properties: {},
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
          properties: {},
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
  })));
  // With writes off, tools/list leaves out the write tools; the gate still refuses them by name (REQ-SRV-026).
  server.setRequestHandler(ListToolsRequestSchema, withWriteToolsHidden(TOOL_METHODS, () => process.env.ALLOW_WRITE_OPERATIONS === "true",
    withToolAnnotations(TOOL_METHODS, toolCatalog.list)));

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
      case "refresh_local_admin_account_expiry":
        validateOrThrow(args, DefenseControlRules.refreshLocalAdminAccountExpiry());
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
    // A renamed tool answers with its new name (#177).
    const renamedTo = RENAMED_TOOLS.get(name);
    if (renamedTo) {
      throw new McpError(ErrorCode.MethodNotFound, `${name} was renamed to ${renamedTo}.`);
    }
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

    // 3. Secret-read gate (REQ-SRV-017). These tools return live secrets
    // (BitLocker recovery keys and startup PIN, cleartext LAPS admin passwords)
    // that would otherwise land in the model context/transcript unredacted.
    // Classified by what the response contains, not by HTTP method: the two write
    // tools return the same secrets, so they need this gate as well as the write
    // gate. Off by default; an operator must opt in explicitly.
    const SECRET_READ_TOOLS = new Set<string>([
      "get_bitlocker_secrets",
      "get_local_admin_accounts",
      "update_bitlocker_pin",
      "patch_local_admin_user_credentials",
    ]);
    if (SECRET_READ_TOOLS.has(name) && process.env.ALLOW_SECRET_READ !== "true") {
      return {
        content: [{
          type: "text" as const,
          text: `Secret-returning operation '${name}' is disabled because it exposes live credentials (BitLocker keys / LAPS passwords). ` +
            `This MCP server was started without ALLOW_SECRET_READ. An operator must set ALLOW_SECRET_READ=true in the server's ` +
            `environment (the MCP host's 'env' block for this server, or the container/service environment) and restart the server; ` +
            `a running process doesn't pick up the change, and the model cannot set it. ` +
            `This gate is independent of ALLOW_WRITE_OPERATIONS: opening writes alone doesn't enable it.`
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
      const dc = lazyClient(() => bconnect.defenseControl);

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        case "list_bitlocker_windows_endpoints": {
          const result = await dc.getBitLockerWindowsEndpoints(pickArguments(args ?? {}, sends("list_bitlocker_windows_endpoints")));
          return toolJsonResult(result);
        }

        case "get_bitlocker_windows_endpoint": {
          const result = await dc.getBitLockerWindowsEndpoint(args!.endpointId as string);
          return toolJsonResult(result);
        }

        case "get_bitlocker_secrets": {
          if (!is26R1) {
            throw new McpError(ErrorCode.MethodNotFound, "get_bitlocker_secrets is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");
          }
          const result = await dc.getBitLockerSecrets(args!.endpointId as string);
          return toolJsonResult(result);
        }

        case "update_bitlocker_pin": {
          if (!is26R1) {
            throw new McpError(ErrorCode.MethodNotFound, "update_bitlocker_pin is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");
          }
          const result = await dc.updateBitLockerPin(args!.endpointId as string, args!.patchOperations as never);
          return toolJsonResult(result);
        }

        case "get_local_admin_accounts": {
          const result = await dc.getLocalAdministrativeAccounts(args!.endpointId as string);
          return toolJsonResult(result);
        }

        case "patch_local_admin_user_credentials": {
          const result = await dc.patchLocalAdminUserCredentials(args!.endpointId as string, args!.requestedExpirationDate as string);
          return toolJsonResult(result);
        }

        case "refresh_local_admin_account_expiry": {
          const timeout = typeof args?.timeout === "number" ? args.timeout : undefined;
          const result = await dc.triggerUpdateOnClient(args!.endpointId as string, timeout);
          return toolJsonResult(result);
        }

        case "list_defender_threats": {
          const result = await dc.getMicrosoftDefenderThreats(pickArguments(args ?? {}, sends("list_defender_threats")));
          return toolJsonResult(result);
        }

        case "get_defender_threat": {
          const result = await dc.getMicrosoftDefenderThreat(args!.threatId as string);
          return toolJsonResult(result);
        }

        case "list_defender_threats_by_endpoint": {
          const { endpointId, ...params } = args as Record<string, unknown>;
          const result = await dc.getMicrosoftDefenderThreatsByEndpoint(endpointId as string, pickArguments(params, sends("list_defender_threats_by_endpoint")));
          return toolJsonResult(result);
        }

        case "list_defender_threats_by_logical_group": {
          const { logicalGroupId, ...params } = args as Record<string, unknown>;
          const result = await dc.getMicrosoftDefenderThreatsByLogicalGroup(logicalGroupId as string, pickArguments(params, sends("list_defender_threats_by_logical_group")));
          return toolJsonResult(result);
        }

        case "list_defender_windows_endpoints": {
          const result = await dc.getMicrosoftDefenderWindowsEndpoints(pickArguments(args ?? {}, sends("list_defender_windows_endpoints")));
          return toolJsonResult(result);
        }

        case "get_defender_windows_endpoint": {
          const result = await dc.getMicrosoftDefenderWindowsEndpoint(args!.endpointId as string);
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
  });

  return { server };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

runServer({ name: "bconnect-defensecontrol-mcp", createServer, clients });
