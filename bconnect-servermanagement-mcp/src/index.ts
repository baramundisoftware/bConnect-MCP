#!/usr/bin/env node

/**
 * bconnect-servermanagement-mcp
 *
 * A Model Context Protocol server that provides access to the baramundi
 * bConnect REST API for Server Management — management server info,
 * microservices, security groups/profiles, API keys, and download jobs.
 *
 * 25 tools work in both 25R2 and 26R1. 5 additional tools are only
 * registered when the selected release (detected at startup, #159) is 26R1.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode
} from "@modelcontextprotocol/sdk/types.js";
import { BConnectClient } from "./bconnect-client.js";
import { validateOrThrow, toolErrorResult, lazyClient, jsonPatchArgument, withUnverifiedWriteMarker, declaredArgumentsOnly, pickArguments, queryParameters, withQueryProperties, withCountOnly, serverClients, runServer, withToolAnnotations, withWriteToolsHidden, toolJsonResult, selectedRelease, withReleaseTools, refuseUnavailableTool, protocolError } from "@bconnect/mcp-core";
import { QUERY_PARAMETERS } from "./query-params.js";
import { TOOL_RELEASES } from "./tool-releases.js";
import { TOOL_METHODS } from "./tool-methods.js";

/** The query parameters a list tool sends: exactly what its route declares in the selected release (#179). */
const sends = (tool: string): string[] => queryParameters(QUERY_PARAMETERS, selectedRelease(), tool);
import type { BConnectCredentials } from "@bconnect/mcp-core";
import { ServerManagementRules } from "./utils/mcp-tool-validation-rules.js";

// ─── Factory exported for testing ───────────────────────────────────────────

export type { BConnectCredentials } from "@bconnect/mcp-core";

/** The server's bConnect clients: one shared by every tool call (REQ-SRV-023). */
const clients = serverClients(BConnectClient);

export function createServer(credentials?: BConnectCredentials): { server: Server } {
  const release = selectedRelease();

  const server = new Server(
    {
      name: "bconnect-servermanagement-mcp",
      version: "26.1.11"
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
  "start_microservice",
  "stop_microservice",
  "restart_microservice",
  "create_security_group",
  "update_security_group",
  "delete_security_group",
  "create_security_profile",
  "update_security_profile",
  "delete_security_profile",
  "update_object_permission",
  "restart_management_server",
  "cancel_scheduled_restart",
  "simulate_msw_cleanup",
  "msw_cleanup",
  ]);

  const toolCatalog = declaredArgumentsOnly(withQueryProperties(QUERY_PARAMETERS, () => selectedRelease(), withUnverifiedWriteMarker(WRITE_TOOLS, async () => {
    const tools = [

      // ── Server Information ────────────────────────────────────────────────
      {
        name: "get_management_server",
        description: "Get the baramundi Management Server of this bMS installation: its name, version, state and planned server restart times. Takes no arguments.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "get_gateway",
        description: "Get the status of the baramundi Gateway that connects endpoints from outside the network: its configuration status, availability and last contact.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "get_dip_status",
        description: "Get the status of all Distribution and Inventory Points (DIPs): for each, its ID, host name, state, last update and details.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "get_vpn_appliance",
        description: "Get the VPN appliance that the baramundi Management Suite uses for endpoint communication: its name and status. Takes no arguments and changes nothing.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },

      // ── Microservices ─────────────────────────────────────────────────────
      {
        name: "list_microservices",
        description: "List all microservices of the baramundi Management Suite: for each, its GUID, name, state and status message. Use the GUID with get_microservice or the start, stop and restart tools.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "get_microservice",
        description: "Get one microservice of the baramundi Management Suite by its GUID: its name, state and status message. Use it to check a start or restart request.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the microservice to retrieve details for." }
          },
          required: ["id"]
        }
      },
      {
        name: "start_microservice",
        description: "Ask bMS to start a microservice, identified by its GUID. Requires server setting rights. bMS only accepts the request; check the result with get_microservice.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the microservice to start." }
          },
          required: ["id"]
        }
      },
      {
        name: "stop_microservice",
        description: "Stop a microservice of the baramundi Management Suite, identified by its GUID. Requires server setting rights. Tools that depend on the microservice stop working until it is started again.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the microservice to stop." }
          },
          required: ["id"]
        }
      },
      {
        name: "restart_microservice",
        description: "Ask bMS to restart a microservice, identified by its GUID. Requires server setting rights. bMS only accepts the request; check the result with get_microservice.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the microservice to restart." }
          },
          required: ["id"]
        }
      },

      // ── Infrastructure ────────────────────────────────────────────────────
      {
        name: "list_cloud_connectors",
        description: "List all Cloud Connectors configured in the baramundi Management Suite: for each, its name and state. Takes no arguments and changes nothing.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "list_pxe_relays",
        description: "List all PXE relays configured in the baramundi Management Suite, which serve network boot for OS installation: for each, its name and state.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },

      // ── Security Groups ───────────────────────────────────────────────────
      {
        name: "list_security_groups",
        description: "List the security groups of the baramundi Management Suite, paged: for each, its GUID, group name and assigned security profiles. Members and rights are not part of the answer.",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "get_security_group",
        description: "Get one security group of the baramundi Management Suite by its GUID: its group name and assigned security profiles. Members and rights are not part of the answer.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the security group to retrieve." }
          },
          required: ["id"]
        }
      },
      {
        name: "create_security_group",
        description: "Create a security group with a name and, optionally, the GUIDs of security profiles to assign. Returns the new group with its GUID. bMS answers 409 when the name is taken.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1, maxLength: 255, description: "Name of the security group." },
            profiles: { type: "array", items: { type: "string" }, description: "GUIDs of the security profiles to assign." }
          },
          required: ["name"]
        }
      },
      {
        name: "update_security_group",
        description: "Update a security group of the baramundi Management Suite with a JSON Patch document, for example its name or its assigned security profiles. Returns the updated group.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the security group to update." },
            patchOperations: { type: "array", description: "JSON Patch operations array with op, path, and value fields." }
          },
          required: ["id", "patchOperations"]
        }
      },
      {
        name: "delete_security_group",
        description: "Delete a Security Group by its GUID from baramundi Management Suite. Permanently removes the specified security group. Returns no content on successful deletion of the security group.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the security group to delete." }
          },
          required: ["id"]
        }
      },

      // ── Security Profiles ─────────────────────────────────────────────────
      {
        name: "list_security_profiles",
        description: "List the security profiles, paged: for each, its GUID, name, comment and whether it shows administrator and endpoint user identities.",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      },
      {
        name: "get_security_profile",
        description: "Get one security profile of the baramundi Management Suite by its GUID: its name, comment, and whether it shows administrator and endpoint user identities.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the security profile to retrieve." }
          },
          required: ["id"]
        }
      },
      {
        name: "create_security_profile",
        description: "Create a security profile with a name and, optionally, a comment and whether it shows administrator and endpoint user identities. Returns the new profile with its GUID. bMS answers 409 when the name is taken.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1, maxLength: 50, description: "Name of the security profile." },
            comment: { type: "string", maxLength: 255, description: "Comment on the security profile." },
            displayAdministratorIdentities: { type: "boolean", description: "Whether the profile shows administrator identities." },
            displayEndpointUserIdentities: { type: "boolean", description: "Whether the profile shows endpoint user identities." }
          },
          required: ["name"]
        }
      },
      {
        name: "update_security_profile",
        description: "Update a security profile of the baramundi Management Suite with a JSON Patch document, for example its name, comment or identity display settings. Returns the updated profile.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the security profile to update." },
            patchOperations: { type: "array", description: "JSON Patch operations array with op, path, and value fields." }
          },
          required: ["id", "patchOperations"]
        }
      },
      {
        name: "delete_security_profile",
        description: "Delete a Security Profile by its GUID from baramundi Management Suite. Permanently removes the specified security profile. Returns no content on successful deletion of the security profile.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the security profile to delete." }
          },
          required: ["id"]
        }
      },

      // ── Object Permissions ────────────────────────────────────────────────
      {
        name: "get_access_rights",
        description: "Get the object permissions and access rights for a specific object identified by its GUID in baramundi Management Suite. Returns permission assignments including read, modify, delete, and specialized operation rights.",
        inputSchema: {
          type: "object",
          properties: {
            objectId: { type: "string", description: "GUID of the object to retrieve access rights for." }
          },
          required: ["objectId"]
        }
      },
      {
        name: "update_object_permission",
        description: "Update the object permissions for a specific object using a JSON Patch document in baramundi Management Suite. Applies patch operations to modify permission assignments for the specified managed object.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the object to update permissions for." },
            patchOperations: { type: "array", description: "JSON Patch operations array with op, path, and value fields." }
          },
          required: ["id", "patchOperations"]
        }
      },

      // ── Server Restart ────────────────────────────────────────────────────
      {
        name: "restart_management_server",
        description: "Restart the baramundi Management Server, immediately or at a scheduled time. Without utcScheduleRestartTime the restart is immediate and interrupts all active management operations and connections; prefer a scheduled time outside working hours. Requires server setting rights; a scheduled restart can be cancelled with cancel_scheduled_restart.",
        inputSchema: {
          type: "object",
          properties: {
            utcScheduleRestartTime: {
              type: "string",
              format: "date-time",
              description: "When to restart, as an ISO 8601 date-time in UTC (e.g. 2026-10-02T22:00:00Z). Omit for an immediate restart.",
            },
          },
          required: [],
        }
      },
      {
        name: "cancel_scheduled_restart",
        description: "Cancel a previously scheduled restart of the baramundi Management Server. Cancels any pending restart operation and requires server setting rights. Returns no content on successful cancellation.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },

    ];

    // ── 26R1-only tools (listed per TOOL_RELEASES, #159) ───────────────────────────────────────────────────
    tools.push(
      {
        name: "list_api_keys",
        description: "[26R1] List the API keys: for each, its name, expiration date, comment, whether it is active and available via the gateway, and its assigned security profiles. Available in bConnect 26R1 and later.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "simulate_msw_cleanup",
        description: "[26R1] Simulate the cleanup of managed software files on the master DIP, without deleting anything. Returns the simulation result and the files a cleanup would delete. Available in bConnect 26R1 and later.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "msw_cleanup",
        description: "[26R1] Clean up managed software files on the master DIP: deletes the files simulate_msw_cleanup lists. Returns whether the cleanup was successful and its result. bMS answers 423 while another cleanup runs. Available in bConnect 26R1 and later.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "list_download_jobs",
        description: "[26R1] List the download jobs, paged: for each, its GUID, name, interval, last execution, last update, state, state message, URL and local path. Available in bConnect 26R1 and later.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "get_download_job",
        description: "[26R1] Get one download job by its GUID: name, interval, last execution, last update, state, state message, URL and local path. Available in bConnect 26R1 and later.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the download job to retrieve details for." }
          },
          required: ["id"]
        }
      }
    );

    return { tools };
  })));
  // With writes off, tools/list leaves out the write tools; the gate still refuses them by name (REQ-SRV-026).
  server.setRequestHandler(ListToolsRequestSchema, withReleaseTools(TOOL_RELEASES, withWriteToolsHidden(TOOL_METHODS, () => process.env.ALLOW_WRITE_OPERATIONS === "true",
    withToolAnnotations(TOOL_METHODS, toolCatalog.list))));

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  // ── Argument-validation pre-pass (runs before write-gate or bConnect setup) ─
  function validateToolArguments(name: string, args: Record<string, unknown> | undefined): void {
    switch (name) {
      // Server Information
      case "get_management_server":
        validateOrThrow(args, ServerManagementRules.getManagementServer()); return;
      case "get_gateway":
        validateOrThrow(args, ServerManagementRules.getGateway()); return;
      case "get_dip_status":
        validateOrThrow(args, ServerManagementRules.getDipStatus()); return;
      case "get_vpn_appliance":
        validateOrThrow(args, ServerManagementRules.getVpnAppliance()); return;
      // Microservices
      case "list_microservices":
        validateOrThrow(args, ServerManagementRules.listMicroservices()); return;
      case "get_microservice":
        validateOrThrow(args, ServerManagementRules.getMicroservice()); return;
      case "start_microservice":
        validateOrThrow(args, ServerManagementRules.startMicroservice()); return;
      case "stop_microservice":
        validateOrThrow(args, ServerManagementRules.stopMicroservice()); return;
      case "restart_microservice":
        validateOrThrow(args, ServerManagementRules.restartMicroservice()); return;
      // Infrastructure
      case "list_cloud_connectors":
        validateOrThrow(args, ServerManagementRules.listCloudConnectors()); return;
      case "list_pxe_relays":
        validateOrThrow(args, ServerManagementRules.listPxeRelays()); return;
      // Security Groups
      case "list_security_groups":
        validateOrThrow(args, ServerManagementRules.listSecurityGroups()); return;
      case "get_security_group":
        validateOrThrow(args, ServerManagementRules.getSecurityGroup()); return;
      case "create_security_group":
        validateOrThrow(args, ServerManagementRules.createSecurityGroup()); return;
      case "update_security_group":
        validateOrThrow(args, ServerManagementRules.updateSecurityGroup()); return;
      case "delete_security_group":
        validateOrThrow(args, ServerManagementRules.deleteSecurityGroup()); return;
      // Security Profiles
      case "list_security_profiles":
        validateOrThrow(args, ServerManagementRules.listSecurityProfiles()); return;
      case "get_security_profile":
        validateOrThrow(args, ServerManagementRules.getSecurityProfile()); return;
      case "create_security_profile":
        validateOrThrow(args, ServerManagementRules.createSecurityProfile()); return;
      case "update_security_profile":
        validateOrThrow(args, ServerManagementRules.updateSecurityProfile()); return;
      case "delete_security_profile":
        validateOrThrow(args, ServerManagementRules.deleteSecurityProfile()); return;
      // Object Permissions
      case "get_access_rights":
        validateOrThrow(args, ServerManagementRules.getAccessRights()); return;
      case "update_object_permission":
        validateOrThrow(args, ServerManagementRules.updateObjectPermission()); return;
      // Server Restart
      case "restart_management_server":
        validateOrThrow(args, ServerManagementRules.restartManagementServer()); return;
      case "cancel_scheduled_restart":
        validateOrThrow(args, ServerManagementRules.cancelScheduledRestart()); return;
      // 26R1-only
      case "list_api_keys":
        validateOrThrow(args, ServerManagementRules.listApiKeys()); return;
      case "simulate_msw_cleanup":
        validateOrThrow(args, ServerManagementRules.simulateMswCleanup()); return;
      case "msw_cleanup":
        validateOrThrow(args, ServerManagementRules.mswCleanup()); return;
      case "list_download_jobs":
        validateOrThrow(args, ServerManagementRules.listDownloadJobs()); return;
      case "get_download_job":
        validateOrThrow(args, ServerManagementRules.getDownloadJob()); return;
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
      const sm = lazyClient(() => bconnect.serverManagement);

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        case "get_management_server": {
          const result = await sm.getManagementServer();
          return toolJsonResult(result);
        }

        case "get_gateway": {
          const result = await sm.getGateway();
          return toolJsonResult(result);
        }

        case "get_dip_status": {
          const result = await sm.getDipStatus();
          return toolJsonResult(result);
        }

        case "get_vpn_appliance": {
          const result = await sm.getVpnAppliance();
          return toolJsonResult(result);
        }

        case "list_microservices": {
          const result = await sm.getMicroservices();
          return toolJsonResult(result);
        }

        case "get_microservice": {
          const result = await sm.getMicroservice(args!.id as string);
          return toolJsonResult(result);
        }

        case "start_microservice": {
          await sm.startMicroservice(args!.id as string);
          return { content: [{ type: "text", text: "Start requested: bMS accepted the request (\"Microservice starting.\"). Check the state with get_microservice." }] };
        }

        case "stop_microservice": {
          await sm.stopMicroservice(args!.id as string);
          return { content: [{ type: "text", text: "Microservice stopped successfully." }] };
        }

        case "restart_microservice": {
          await sm.restartMicroservice(args!.id as string);
          return { content: [{ type: "text", text: "Restart requested: bMS accepted the request (\"Microservice restarting.\"). Check the state with get_microservice." }] };
        }

        case "list_cloud_connectors": {
          const result = await sm.getCloudConnectors();
          return toolJsonResult(result);
        }

        case "list_pxe_relays": {
          const result = await sm.getPxeRelays();
          return toolJsonResult(result);
        }

        case "list_security_groups": {
          const result = await sm.getSecurityGroups(pickArguments(args ?? {}, sends("list_security_groups")));
          return toolJsonResult(result);
        }

        case "get_security_group": {
          const result = await sm.getSecurityGroup(args!.id as string);
          return toolJsonResult(result);
        }

        case "create_security_group": {
          const result = await sm.createSecurityGroup({
            name: args!.name as string,
            ...(args!.profiles !== undefined && { profiles: args!.profiles as string[] }),
          });
          return toolJsonResult(result);
        }

        case "update_security_group": {
          const result = await sm.updateSecurityGroup(args!.id as string, jsonPatchArgument(args!.patchOperations, "patchOperations"));
          return toolJsonResult(result);
        }

        case "delete_security_group": {
          await sm.deleteSecurityGroup(args!.id as string);
          return { content: [{ type: "text", text: "Security group deleted successfully." }] };
        }

        case "list_security_profiles": {
          const result = await sm.getSecurityProfiles(pickArguments(args ?? {}, sends("list_security_profiles")));
          return toolJsonResult(result);
        }

        case "get_security_profile": {
          const result = await sm.getSecurityProfile(args!.id as string);
          return toolJsonResult(result);
        }

        case "create_security_profile": {
          const result = await sm.createSecurityProfile({
            name: args!.name as string,
            ...(args!.comment !== undefined && { comment: args!.comment as string }),
            ...(args!.displayAdministratorIdentities !== undefined && { displayAdministratorIdentities: args!.displayAdministratorIdentities as boolean }),
            ...(args!.displayEndpointUserIdentities !== undefined && { displayEndpointUserIdentities: args!.displayEndpointUserIdentities as boolean }),
          });
          return toolJsonResult(result);
        }

        case "update_security_profile": {
          const result = await sm.updateSecurityProfile(args!.id as string, jsonPatchArgument(args!.patchOperations, "patchOperations"));
          return toolJsonResult(result);
        }

        case "delete_security_profile": {
          await sm.deleteSecurityProfile(args!.id as string);
          return { content: [{ type: "text", text: "Security profile deleted successfully." }] };
        }

        case "get_access_rights": {
          const result = await sm.getAccessRights(args!.objectId as string);
          return toolJsonResult(result);
        }

        case "update_object_permission": {
          const result = await sm.updateObjectPermission(args!.id as string, jsonPatchArgument(args!.patchOperations, "patchOperations"));
          return toolJsonResult(result);
        }

        case "restart_management_server": {
          const scheduled = typeof args?.utcScheduleRestartTime === "string" ? args.utcScheduleRestartTime : undefined;
          const result = await sm.restartManagementServer(scheduled);
          const text = scheduled
            ? `Management server restart scheduled for ${JSON.stringify(result)} (requested: ${scheduled}).`
            : `Management server restart initiated now (bMS reports ${JSON.stringify(result)}).`;
          return { content: [{ type: "text", text }] };
        }

        case "cancel_scheduled_restart": {
          await sm.cancelScheduledRestart();
          return { content: [{ type: "text", text: "Scheduled restart cancelled." }] };
        }

        // ── 26R1-only tools (listed per TOOL_RELEASES, #159) ───────────────────────────────────────────────

        case "list_api_keys": {
          const result = await sm.getApiKeys();
          return toolJsonResult(result);
        }

        case "simulate_msw_cleanup": {
          const result = await sm.simulateMSWCleanup();
          return toolJsonResult(result, { lead: "MSW cleanup simulation completed:" });
        }

        case "msw_cleanup": {
          const result = await sm.mswCleanup();
          // bMS answers 200 for a failed cleanup too; wasSuccessful says which (#327).
          const succeeded = (result as { wasSuccessful?: unknown } | undefined)?.wasSuccessful === true;
          return toolJsonResult(result, { lead: succeeded ? "MSW cleanup succeeded:" : "MSW cleanup did not succeed (wasSuccessful is not true):" });
        }

        case "list_download_jobs": {
          const result = await sm.getDownloadJobs(pickArguments(args ?? {}, sends("list_download_jobs")));
          return toolJsonResult(result);
        }

        case "get_download_job": {
          const result = await sm.getDownloadJob(args!.id as string);
          return toolJsonResult(result);
        }

        default:
          throw protocolError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
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

runServer({ name: "bconnect-servermanagement-mcp", createServer, clients, releases: TOOL_RELEASES });
