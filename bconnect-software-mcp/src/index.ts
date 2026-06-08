#!/usr/bin/env node

/**
 * bconnect-software-mcp
 *
 * A Model Context Protocol server that provides access to the baramundi
 * bConnect REST API for Software — installed Windows software inventory
 * and software bundle management (bundles, applications, folders).
 *
 * Installed software tools are available in both 25R2 and 26R1.
 * Bundle and folder management tools are exclusive to 26R1 (new in that release).
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
import { SoftwareRules } from "./utils/mcp-tool-validation-rules.js";

// ─── Factory exported for testing ───────────────────────────────────────────

export function createServer(): { server: Server } {
  const release = process.env.BCONNECT_RELEASE ?? "25R2";
  const is26R1 = release === "26R1";

  const server = new Server(
    {
      name: "bconnect-software-mcp",
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
    const tools: object[] = [

      // ── Installed Software (25R2 + 26R1) ──────────────────────────────
      {
        name: "list_installed_windows_software",
        description: "List all installed Windows software across all endpoints managed in baramundi Management Suite. Returns a paged list with software name, vendor, version, install date, and associated endpoint information for every installed application tracked.",
        inputSchema: {
          type: "object",
          properties: {
            OrderBy: { type: "string", description: "Sort results by property name and direction (e.g. 'SoftwareName asc')." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
            Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
            PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
          },
          required: []
        }
      },
      {
        name: "list_installed_software_by_endpoint",
        description: "List all installed Windows software on a specific endpoint identified by its GUID. Returns a paged list of applications installed on that endpoint including software name, vendor, version, install date, and architecture details.",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "GUID of the Windows endpoint to retrieve installed software for." },
            OrderBy: { type: "string", description: "Sort results by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
            Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
            PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
          },
          required: ["endpointId"]
        }
      },
      {
        name: "list_installed_software_by_logical_group",
        description: "List all installed Windows software on endpoints within a specific logical group identified by its GUID. Returns a paged list of installed applications across all group members with software name, vendor, version, and endpoint association details.",
        inputSchema: {
          type: "object",
          properties: {
            logicalGroupId: { type: "string", description: "GUID of the logical group to retrieve installed software for." },
            OrderBy: { type: "string", description: "Sort results by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
            Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
            PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
          },
          required: ["logicalGroupId"]
        }
      },
      {
        name: "list_installed_software_by_dynamic_group",
        description: "List all installed Windows software on endpoints within a specific Universal Dynamic Group identified by its GUID. Returns a paged list of installed applications across all group members with software name, vendor, version, and endpoint association details.",
        inputSchema: {
          type: "object",
          properties: {
            universalDynamicGroupId: { type: "string", description: "GUID of the Universal Dynamic Group to retrieve installed software for." },
            OrderBy: { type: "string", description: "Sort results by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
            Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
            PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
          },
          required: ["universalDynamicGroupId"]
        }
      },
    ];

    // 26R1-only tools: bundle and folder management
    if (is26R1) {
      tools.push(

        // ── Software Bundles ─────────────────────────────────────────────
        {
          name: "list_software_bundles",
          description: "[26R1] List all software bundles defined in baramundi Management Suite. Returns a paged list with bundle id, name, folder, and associated applications for each bundle. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              OrderBy: { type: "string", description: "Sort results by property name and direction (e.g. 'Name asc')." },
              SearchQuery: { type: "string", description: "Filter results by matching against searchable bundle properties." },
              Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
              PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
            },
            required: []
          }
        },
        {
          name: "get_software_bundle",
          description: "[26R1] Get details of a specific software bundle by its GUID. Returns bundle id, name, folder id, and list of contained applications defined in baramundi Management Suite. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              bundleId: { type: "string", description: "GUID of the software bundle to retrieve." }
            },
            required: ["bundleId"]
          }
        },
        {
          name: "create_software_bundle",
          description: "[26R1] Create a new software bundle in baramundi Management Suite. Requires a name and optional folder id to place the bundle within the folder hierarchy. Returns the newly created bundle with its assigned GUID. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string", description: "Display name for the new software bundle." },
              folderId: { type: "string", description: "Optional GUID of the folder to place the bundle in." }
            },
            required: ["name"]
          }
        },
        {
          name: "delete_software_bundle",
          description: "[26R1] Delete a software bundle from baramundi Management Suite by its GUID. The operation returns no content on success (204). If the bundle does not exist, the operation is treated as successful. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              bundleId: { type: "string", description: "GUID of the software bundle to delete." }
            },
            required: ["bundleId"]
          }
        },

        // ── Bundle Applications ──────────────────────────────────────────
        {
          name: "list_bundle_applications",
          description: "[26R1] List all bundle application assignments across all software bundles in baramundi Management Suite. Returns a paged list with bundle name, application name, vendor, and order index for each assignment. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              OrderBy: { type: "string", description: "Sort results by property name and direction (e.g. 'ApplicationName asc')." },
              SearchQuery: { type: "string", description: "Filter results by matching against bundle or application properties." },
              Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
              PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
            },
            required: []
          }
        },
        {
          name: "list_bundle_applications_by_bundle",
          description: "[26R1] List all applications contained in a specific software bundle identified by its GUID. Returns a paged list with application id, name, vendor, and order within the bundle. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              bundleId: { type: "string", description: "GUID of the software bundle to list applications for." },
              OrderBy: { type: "string", description: "Sort results by property name and direction." },
              SearchQuery: { type: "string", description: "Filter results by matching against application properties." },
              Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
              PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
            },
            required: ["bundleId"]
          }
        },
        {
          name: "add_application_to_bundle",
          description: "[26R1] Assign an application to a software bundle in baramundi Management Suite. Requires the bundle GUID and the application GUID to add. Returns the created bundle application assignment with order index. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              bundleId: { type: "string", description: "GUID of the software bundle to add the application to." },
              applicationId: { type: "string", description: "GUID of the application to assign to the bundle." },
              order: { type: "number", description: "Optional installation order within the bundle." }
            },
            required: ["bundleId", "applicationId"]
          }
        },
        {
          name: "delete_bundle_application",
          description: "[26R1] Remove an application assignment from a software bundle in baramundi Management Suite by the assignment GUID. Returns no content on success (204). If the assignment does not exist, the operation is treated as successful. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "GUID of the bundle application assignment to delete." }
            },
            required: ["id"]
          }
        },
        {
          name: "replace_application_in_bundle",
          description: "[26R1] Replace an application within a software bundle using a JSON Patch document. Updates the ApplicationId field of the bundle application assignment to point to a different application. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              bundleId: { type: "string", description: "GUID of the software bundle containing the assignment." },
              id: { type: "string", description: "GUID of the bundle application assignment to update." },
              patchOperations: {
                type: "array",
                description: "JSON Patch operations array. Use op=replace, path=/ApplicationId, value=<new-app-guid>."
              }
            },
            required: ["bundleId", "id", "patchOperations"]
          }
        },

        // ── Bundle Folders ───────────────────────────────────────────────
        {
          name: "list_bundle_folders",
          description: "[26R1] List all software bundle folders in baramundi Management Suite. Returns a paged list with folder id, name, parent folder id, and optional comment for each folder in the bundle folder hierarchy. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              OrderBy: { type: "string", description: "Sort results by property name and direction (e.g. 'Name asc')." },
              SearchQuery: { type: "string", description: "Filter results by matching against folder name or comment." },
              Name: { type: "string", description: "Filter results to match this exact folder name." },
              Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
              PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
            },
            required: []
          }
        },
        {
          name: "get_bundle_folder",
          description: "[26R1] Get details of a specific software bundle folder by its GUID. Returns folder id, name, parent folder id, and comment for the specified folder in the baramundi Management Suite bundle hierarchy. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "GUID of the bundle folder to retrieve." }
            },
            required: ["id"]
          }
        },
        {
          name: "list_bundle_folders_by_folder",
          description: "[26R1] List all sub-folders contained within a specific software bundle folder identified by its GUID. Optionally include all nested sub-folders recursively. Returns folder id, name, parent id, and comment for each contained folder. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              folderId: { type: "string", description: "GUID of the parent bundle folder to list sub-folders for." },
              includeSubfolders: { type: "boolean", description: "If true, recursively include all nested sub-folders." },
              OrderBy: { type: "string", description: "Sort results by property name and direction." },
              SearchQuery: { type: "string", description: "Filter results by matching against folder name or comment." },
              Name: { type: "string", description: "Filter results to match this exact folder name." },
              Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
              PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
            },
            required: ["folderId"]
          }
        },
        {
          name: "create_bundle_folder",
          description: "[26R1] Create a new software bundle folder in baramundi Management Suite. Requires a name and optional parent folder id and comment. Returns the newly created folder with its assigned GUID. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string", description: "Display name for the new bundle folder." },
              parentId: { type: "string", description: "Optional GUID of the parent folder (creates in root if omitted)." },
              comment: { type: "string", description: "Optional comment or description for the folder." }
            },
            required: ["name"]
          }
        },
        {
          name: "delete_bundle_folder",
          description: "[26R1] Delete a software bundle folder from baramundi Management Suite by its GUID. The folder must be empty before deletion. Returns no content on success (204). If the folder does not exist, the operation is treated as successful. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "GUID of the bundle folder to delete." }
            },
            required: ["id"]
          }
        },
        {
          name: "update_bundle_folder",
          description: "[26R1] Update a software bundle folder in baramundi Management Suite using a JSON Patch document. Supports modifying name, parentId (move folder), and comment fields. Returns the updated folder with all current properties. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "GUID of the bundle folder to update." },
              patchOperations: {
                type: "array",
                description: "JSON Patch operations array. Supported paths: /name, /parentId, /comment. Use op=replace."
              }
            },
            required: ["id", "patchOperations"]
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
      // Installed Software (base)
      case "list_installed_windows_software":
        validateOrThrow(args, SoftwareRules.listInstalledWindowsSoftware()); return;
      case "list_installed_software_by_endpoint":
        validateOrThrow(args, SoftwareRules.listInstalledSoftwareByEndpoint()); return;
      case "list_installed_software_by_logical_group":
        validateOrThrow(args, SoftwareRules.listInstalledSoftwareByLogicalGroup()); return;
      case "list_installed_software_by_dynamic_group":
        validateOrThrow(args, SoftwareRules.listInstalledSoftwareByDynamicGroup()); return;
      // Software Bundles (26R1)
      case "list_software_bundles":
        validateOrThrow(args, SoftwareRules.listSoftwareBundles()); return;
      case "get_software_bundle":
        validateOrThrow(args, SoftwareRules.getSoftwareBundle()); return;
      case "create_software_bundle":
        validateOrThrow(args, SoftwareRules.createSoftwareBundle()); return;
      case "delete_software_bundle":
        validateOrThrow(args, SoftwareRules.deleteSoftwareBundle()); return;
      // Bundle Applications (26R1)
      case "list_bundle_applications":
        validateOrThrow(args, SoftwareRules.listBundleApplications()); return;
      case "list_bundle_applications_by_bundle":
        validateOrThrow(args, SoftwareRules.listBundleApplicationsByBundle()); return;
      case "add_application_to_bundle":
        validateOrThrow(args, SoftwareRules.addApplicationToBundle()); return;
      case "delete_bundle_application":
        validateOrThrow(args, SoftwareRules.deleteBundleApplication()); return;
      case "replace_application_in_bundle":
        validateOrThrow(args, SoftwareRules.replaceApplicationInBundle()); return;
      // Bundle Folders (26R1)
      case "list_bundle_folders":
        validateOrThrow(args, SoftwareRules.listBundleFolders()); return;
      case "get_bundle_folder":
        validateOrThrow(args, SoftwareRules.getBundleFolder()); return;
      case "list_bundle_folders_by_folder":
        validateOrThrow(args, SoftwareRules.listBundleFoldersByFolder()); return;
      case "create_bundle_folder":
        validateOrThrow(args, SoftwareRules.createBundleFolder()); return;
      case "delete_bundle_folder":
        validateOrThrow(args, SoftwareRules.deleteBundleFolder()); return;
      case "update_bundle_folder":
        validateOrThrow(args, SoftwareRules.updateBundleFolder()); return;
      // Unknown tool names are not validated here; dispatch handles MethodNotFound.
    }
  }

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // 1. Validate arguments first — pure, no side effects, fails fast on bad input.
    validateToolArguments(name, args);

    // 2. Write-operation gate (REQ-SRV-012).
    const WRITE_TOOLS = new Set<string>([
    "create_software_bundle",
    "delete_software_bundle",
    "add_application_to_bundle",
    "delete_bundle_application",
    "create_bundle_folder",
    "delete_bundle_folder",
    "update_bundle_folder",
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
      const sw = bconnect.software;

      // Helper to enforce 26R1-only tools (defence-in-depth; ListTools already filters)
      const requires26R1 = () => {
        if (!is26R1) {
          throw new McpError(ErrorCode.MethodNotFound, `${name} is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.`);
        }
      };

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        // ── Installed Software ─────────────────────────────────────────
        case "list_installed_windows_software": {
          const result = await sw.getInstalledWindowsSoftware((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_installed_software_by_endpoint": {
          const { endpointId, ...params } = args as Record<string, unknown>;
          const result = await sw.getInstalledSoftwareByEndpoint(endpointId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_installed_software_by_logical_group": {
          const { logicalGroupId, ...params } = args as Record<string, unknown>;
          const result = await sw.getInstalledSoftwareByLogicalGroup(logicalGroupId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_installed_software_by_dynamic_group": {
          const { universalDynamicGroupId, ...params } = args as Record<string, unknown>;
          const result = await sw.getInstalledSoftwareByUniversalDynamicGroup(universalDynamicGroupId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // ── Software Bundles (26R1) ────────────────────────────────────
        case "list_software_bundles": {
          requires26R1();
          const result = await sw.getSoftwareBundles((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_software_bundle": {
          requires26R1();
          const result = await sw.getSoftwareBundle(args!.bundleId as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "create_software_bundle": {
          requires26R1();
          const body: Record<string, unknown> = { name: args!.name };
          if (typeof args!.folderId === "string") body.folderId = args!.folderId;
          const result = await sw.createSoftwareBundle(body as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "delete_software_bundle": {
          requires26R1();
          await sw.deleteSoftwareBundle(args!.bundleId as string);
          return { content: [{ type: "text", text: JSON.stringify({ success: true }, null, 2) }] };
        }

        // ── Bundle Applications (26R1) ─────────────────────────────────
        case "list_bundle_applications": {
          requires26R1();
          const result = await sw.getBundleApplications((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_bundle_applications_by_bundle": {
          requires26R1();
          const { bundleId, ...params } = args as Record<string, unknown>;
          const result = await sw.getBundleApplicationsByBundle(bundleId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "add_application_to_bundle": {
          requires26R1();
          const body: Record<string, unknown> = { applicationId: args!.applicationId };
          if (typeof args!.order === "number") body.order = args!.order;
          const result = await sw.addApplicationToBundle(args!.bundleId as string, body as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "delete_bundle_application": {
          requires26R1();
          await sw.deleteBundleApplication(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify({ success: true }, null, 2) }] };
        }

        case "replace_application_in_bundle": {
          requires26R1();
          const result = await sw.replaceApplicationInBundle(args!.bundleId as string, args!.id as string, args!.patchOperations as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // ── Bundle Folders (26R1) ──────────────────────────────────────
        case "list_bundle_folders": {
          requires26R1();
          const result = await sw.getBundleFolders((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_bundle_folder": {
          requires26R1();
          const result = await sw.getBundleFolder(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_bundle_folders_by_folder": {
          requires26R1();
          const { folderId, ...params } = args as Record<string, unknown>;
          const result = await sw.getBundleFoldersByFolder(folderId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "create_bundle_folder": {
          requires26R1();
          const body: Record<string, unknown> = { name: args!.name };
          if (typeof args!.parentId === "string") body.parentId = args!.parentId;
          if (typeof args!.comment === "string") body.comment = args!.comment;
          const result = await sw.createBundleFolder(body as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "delete_bundle_folder": {
          requires26R1();
          await sw.deleteBundleFolder(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify({ success: true }, null, 2) }] };
        }

        case "update_bundle_folder": {
          requires26R1();
          const result = await sw.updateBundleFolder(args!.id as string, args!.patchOperations as never);
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
    const _startupUrl = process.env.BCONNECT_BASE_URL || "https://bms.example.com:444/bconnect";
    const _startupUser = process.env.BCONNECT_USERNAME;
    const _startupPass = process.env.BCONNECT_PASSWORD;
    const _startupApiKey = process.env.BCONNECT_API_KEY;
    if (!_startupApiKey && (!_startupUser || !_startupPass)) {
      console.error("bconnect-software-mcp: Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required");
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
    console.error(`bconnect-software-mcp: verifying bConnect API connectivity...`);
    const _connected = await _startupClient.testConnection();
    if (!_connected) {
      console.error(`bconnect-software-mcp: cannot reach bConnect API at ${_startupUrl}. Check BCONNECT_BASE_URL, credentials, and network.`);
      process.exit(1);
    }
    console.error(`bconnect-software-mcp: API connectivity verified.`);
  }

  const transportMode = process.env.MCP_TRANSPORT ?? "stdio";
  const port = parseInt(process.env.MCP_PORT ?? "3000", 10);
  const serverName = "bconnect-software-mcp";

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
