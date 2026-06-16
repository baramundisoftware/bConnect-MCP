#!/usr/bin/env node

/**
 * bconnect-servermanagement-mcp
 *
 * A Model Context Protocol server that provides access to the baramundi
 * bConnect REST API for Server Management — management server info,
 * microservices, security groups/profiles, API keys, and download jobs.
 *
 * 25 tools work in both 25R2 and 26R1. 5 additional tools are only
 * registered when BCONNECT_RELEASE=26R1.
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
import { ServerManagementRules } from "./utils/mcp-tool-validation-rules.js";

// ─── Factory exported for testing ───────────────────────────────────────────

export interface BConnectCredentials {
  baseUrl?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

export function createServer(credentials?: BConnectCredentials): { server: Server } {
  const is26R1 = process.env.BCONNECT_RELEASE === '26R1';

  const server = new Server(
    {
      name: "bconnect-servermanagement-mcp",
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

      // ── Server Information ────────────────────────────────────────────────
      {
        name: "get_management_server",
        description: "Get the baramundi Management Server information and configuration details. Returns server version, hostname, license information, and current operational status of the baramundi Management Suite instance.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "get_gateway",
        description: "Get the Gateway configuration and status for the baramundi Management Suite. Returns gateway hostname, availability status, configuration status, and connection details for the baramundi Gateway component.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "get_dip_status",
        description: "Get the status of all Distribution and Inventory Points (DIPs) configured in baramundi Management Suite. Returns a list of DIP servers with their synchronization status, availability, and operational state information.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "get_vpn_appliance",
        description: "Get the VPN Appliance configuration and status for the baramundi Management Suite. Returns the VPN appliance hostname, status, and connectivity information used for secure baramundi client communication.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },

      // ── Microservices ─────────────────────────────────────────────────────
      {
        name: "list_microservices",
        description: "List all microservices registered and managed in the baramundi Management Suite. Returns a list of microservices with their names, versions, current service state, and operational status information.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "get_microservice",
        description: "Get the details of a specific microservice by its GUID in baramundi Management Suite. Returns the microservice name, version, current service state, and detailed status information for the specified microservice.",
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
        description: "Start a specific microservice identified by its GUID in baramundi Management Suite. Initiates the microservice startup process and requires server setting rights. Returns no content on successful start request.",
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
        description: "Stop a specific microservice identified by its GUID in baramundi Management Suite. Initiates the microservice shutdown process and requires server setting rights. Returns no content on successful stop request.",
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
        description: "Restart a specific microservice identified by its GUID in baramundi Management Suite. Stops and restarts the microservice and requires server setting rights. Returns no content on successful restart request.",
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
        description: "List all Cloud Connectors configured in the baramundi Management Suite. Returns a list of cloud connector instances with their names, connection status, and configuration details for cloud-based endpoint management.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "list_pxe_relays",
        description: "List all PXE Relay servers configured in the baramundi Management Suite. Returns a list of PXE relay servers with their names, IP addresses, and status information used for network-based OS deployment.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },

      // ── Security Groups ───────────────────────────────────────────────────
      {
        name: "list_security_groups",
        description: "List all Security Groups defined in the baramundi Management Suite. Returns a paged list of security groups with their names, descriptions, assigned members, and permission configurations.",
        inputSchema: {
          type: "object",
          properties: {
            OrderBy: { type: "string", description: "Sort by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by searchable properties." },
            Page: { type: "number", description: "Zero-indexed page number (default: 0)." },
            PageSize: { type: "number", description: "Items per page (default: 20, max: 1000)." }
          },
          required: []
        }
      },
      {
        name: "get_security_group",
        description: "Get the details of a specific Security Group by its GUID in baramundi Management Suite. Returns group name, description, assigned members, and permission configuration for the specified security group.",
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
        description: "Create a new Security Group in baramundi Management Suite. Accepts group creation data including name, description, and member assignments, and returns the newly created security group with its assigned GUID.",
        inputSchema: {
          type: "object",
          properties: {
            groupData: { type: "object", description: "Security group creation data including Name and optional Description." }
          },
          required: ["groupData"]
        }
      },
      {
        name: "update_security_group",
        description: "Update an existing Security Group using a JSON Patch document in baramundi Management Suite. Applies patch operations to modify the security group properties such as name, description, or member assignments.",
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
        description: "List all Security Profiles defined in the baramundi Management Suite. Returns a paged list of security profiles with their names, descriptions, assigned permissions, and configuration details.",
        inputSchema: {
          type: "object",
          properties: {
            OrderBy: { type: "string", description: "Sort by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by searchable properties." },
            Page: { type: "number", description: "Zero-indexed page number (default: 0)." },
            PageSize: { type: "number", description: "Items per page (default: 20, max: 1000)." }
          },
          required: []
        }
      },
      {
        name: "get_security_profile",
        description: "Get the details of a specific Security Profile by its GUID in baramundi Management Suite. Returns profile name, description, and detailed permission configuration for the specified security profile.",
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
        description: "Create a new Security Profile in baramundi Management Suite. Accepts profile creation data including name, description, and permission settings, and returns the newly created security profile with its assigned GUID.",
        inputSchema: {
          type: "object",
          properties: {
            profileData: { type: "object", description: "Security profile creation data including Name and optional permissions." }
          },
          required: ["profileData"]
        }
      },
      {
        name: "update_security_profile",
        description: "Update an existing Security Profile using a JSON Patch document in baramundi Management Suite. Applies patch operations to modify the security profile properties such as name, description, or permission assignments.",
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
        description: "Restart the baramundi Management Server. Initiates a server restart and requires server setting rights. Use with caution as this interrupts all active management operations and connections.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "cancel_scheduled_restart",
        description: "Cancel a previously scheduled restart of the baramundi Management Server. Cancels any pending restart operation and requires server setting rights. Returns no content on successful cancellation.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },

    ];

    // ── 26R1-only tools ───────────────────────────────────────────────────
    if (is26R1) {
      tools.push(
        {
          name: "list_api_keys",
          description: "[26R1] List all API keys configured in the baramundi Management Suite. Returns a list of API keys with their names, descriptions, associated permissions, and creation metadata. Available in bConnect 26R1 and later.",
          inputSchema: { type: "object", properties: {}, required: [] }
        },
        {
          name: "simulate_msw_cleanup",
          description: "[26R1] Simulate a Managed Software Wizard (MSW) cleanup operation on the Distribution and Inventory Point. Performs a dry-run cleanup simulation without making actual changes. Available in bConnect 26R1 and later.",
          inputSchema: { type: "object", properties: {}, required: [] }
        },
        {
          name: "msw_cleanup",
          description: "[26R1] Execute a Managed Software Wizard (MSW) cleanup operation on the Distribution and Inventory Point server. Removes obsolete managed software packages from the DIP. Use with caution. Available in bConnect 26R1 and later.",
          inputSchema: { type: "object", properties: {}, required: [] }
        },
        {
          name: "list_download_jobs",
          description: "[26R1] List all download jobs configured and queued in the baramundi Management Suite. Returns a list of download jobs with their status, progress, target packages, and associated distribution details. Available in bConnect 26R1 and later.",
          inputSchema: { type: "object", properties: {}, required: [] }
        },
        {
          name: "get_download_job",
          description: "[26R1] Get the details of a specific download job identified by its GUID in baramundi Management Suite. Returns job name, status, progress, target package details, and download configuration. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "GUID of the download job to retrieve details for." }
            },
            required: ["id"]
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

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // 1. Validate arguments first — pure, no side effects, fails fast on bad input.
    validateToolArguments(name, args);

    // 2. Write-operation gate (REQ-SRV-012).
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
      const sm = bconnect.serverManagement;

      // Helper to enforce 26R1-only tools (defence-in-depth; ListTools already filters)
      const requires26R1 = (): void => {
        if (!is26R1) {
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      };

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        case "get_management_server": {
          const result = await sm.getManagementServer();
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_gateway": {
          const result = await sm.getGateway();
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_dip_status": {
          const result = await sm.getDipStatus();
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_vpn_appliance": {
          const result = await sm.getVpnAppliance();
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_microservices": {
          const result = await sm.getMicroservices();
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_microservice": {
          const result = await sm.getMicroservice(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "start_microservice": {
          await sm.startMicroservice(args!.id as string);
          return { content: [{ type: "text", text: "Microservice started successfully." }] };
        }

        case "stop_microservice": {
          await sm.stopMicroservice(args!.id as string);
          return { content: [{ type: "text", text: "Microservice stopped successfully." }] };
        }

        case "restart_microservice": {
          await sm.restartMicroservice(args!.id as string);
          return { content: [{ type: "text", text: "Microservice restarted successfully." }] };
        }

        case "list_cloud_connectors": {
          const result = await sm.getCloudConnectors();
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_pxe_relays": {
          const result = await sm.getPxeRelays();
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_security_groups": {
          const result = await sm.getSecurityGroups((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_security_group": {
          const result = await sm.getSecurityGroup(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "create_security_group": {
          const result = await sm.createSecurityGroup(args!.groupData as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_security_group": {
          await sm.updateSecurityGroup(args!.id as string, args!.patchOperations as never);
          return { content: [{ type: "text", text: JSON.stringify({ success: true }, null, 2) }] };
        }

        case "delete_security_group": {
          await sm.deleteSecurityGroup(args!.id as string);
          return { content: [{ type: "text", text: "Security group deleted successfully." }] };
        }

        case "list_security_profiles": {
          const result = await sm.getSecurityProfiles((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_security_profile": {
          const result = await sm.getSecurityProfile(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "create_security_profile": {
          const result = await sm.createSecurityProfile(args!.profileData as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_security_profile": {
          await sm.updateSecurityProfile(args!.id as string, args!.patchOperations as never);
          return { content: [{ type: "text", text: JSON.stringify({ success: true }, null, 2) }] };
        }

        case "delete_security_profile": {
          await sm.deleteSecurityProfile(args!.id as string);
          return { content: [{ type: "text", text: "Security profile deleted successfully." }] };
        }

        case "get_access_rights": {
          const result = await sm.getAccessRights(args!.objectId as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_object_permission": {
          await sm.updateObjectPermission(args!.id as string, args!.patchOperations as never);
          return { content: [{ type: "text", text: JSON.stringify({ success: true }, null, 2) }] };
        }

        case "restart_management_server": {
          await sm.restartManagementServer();
          return { content: [{ type: "text", text: "Management server restart initiated." }] };
        }

        case "cancel_scheduled_restart": {
          await sm.cancelScheduledRestart();
          return { content: [{ type: "text", text: "Scheduled restart cancelled." }] };
        }

        // ── 26R1-only tools ───────────────────────────────────────────────

        case "list_api_keys": {
          requires26R1();
          const result = await sm.getApiKeys();
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "simulate_msw_cleanup": {
          requires26R1();
          await sm.simulateMSWCleanup();
          return { content: [{ type: "text", text: "MSW cleanup simulation completed." }] };
        }

        case "msw_cleanup": {
          requires26R1();
          await sm.mswCleanup();
          return { content: [{ type: "text", text: "MSW cleanup executed." }] };
        }

        case "list_download_jobs": {
          requires26R1();
          const result = await sm.getDownloadJobs();
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_download_job": {
          requires26R1();
          const result = await sm.getDownloadJob(args!.id as string);
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
      console.error("bconnect-servermanagement-mcp: Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required");
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
    console.error(`bconnect-servermanagement-mcp: verifying bConnect API connectivity...`);
    const _connected = await _startupClient.testConnection();
    if (!_connected) {
      console.error(`bconnect-servermanagement-mcp: cannot reach bConnect API at ${_startupUrl}. Check BCONNECT_BASE_URL, credentials, and network.`);
      process.exit(1);
    }
    console.error(`bconnect-servermanagement-mcp: API connectivity verified.`);
  }

  const transportMode = process.env.MCP_TRANSPORT ?? "stdio";
  const port = parseInt(process.env.MCP_PORT ?? "3000", 10);
  const serverName = "bconnect-servermanagement-mcp";

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
