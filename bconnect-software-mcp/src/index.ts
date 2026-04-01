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
  const release = process.env.BCONNECT_RELEASE ?? "25R2";
  const is26R1 = release === "26R1";

  const server = new Server(
    {
      name: "bconnect-software-mcp",
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

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // ── Write-operation gate (REQ-SRV-012) ───────────────────────────────────
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
      const sw = bconnect.software;

      switch (name) {

        // ── Installed Software ─────────────────────────────────────────
        case "list_installed_windows_software": {
          const result = await sw.getInstalledWindowsSoftware((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_installed_software_by_endpoint": {
          if (!args?.endpointId || typeof args.endpointId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "list_installed_software_by_endpoint requires an endpointId (GUID) string parameter");
          }
          const { endpointId, ...params } = args as Record<string, unknown>;
          const result = await sw.getInstalledSoftwareByEndpoint(endpointId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_installed_software_by_logical_group": {
          if (!args?.logicalGroupId || typeof args.logicalGroupId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "list_installed_software_by_logical_group requires a logicalGroupId (GUID) string parameter");
          }
          const { logicalGroupId, ...params } = args as Record<string, unknown>;
          const result = await sw.getInstalledSoftwareByLogicalGroup(logicalGroupId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_installed_software_by_dynamic_group": {
          if (!args?.universalDynamicGroupId || typeof args.universalDynamicGroupId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "list_installed_software_by_dynamic_group requires a universalDynamicGroupId (GUID) string parameter");
          }
          const { universalDynamicGroupId, ...params } = args as Record<string, unknown>;
          const result = await sw.getInstalledSoftwareByUniversalDynamicGroup(universalDynamicGroupId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // ── Software Bundles (26R1) ────────────────────────────────────
        case "list_software_bundles": {
          if (!is26R1) {
            throw new McpError(ErrorCode.MethodNotFound, "list_software_bundles is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");
          }
          const result = await sw.getSoftwareBundles((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_software_bundle": {
          if (!is26R1) {
            throw new McpError(ErrorCode.MethodNotFound, "get_software_bundle is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");
          }
          if (!args?.bundleId || typeof args.bundleId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "get_software_bundle requires a bundleId (GUID) string parameter");
          }
          const result = await sw.getSoftwareBundle(args.bundleId);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "create_software_bundle": {
          if (!is26R1) {
            throw new McpError(ErrorCode.MethodNotFound, "create_software_bundle is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");
          }
          if (!args?.name || typeof args.name !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "create_software_bundle requires a name string parameter");
          }
          const body: Record<string, unknown> = { name: args.name };
          if (typeof args.folderId === "string") body.folderId = args.folderId;
          const result = await sw.createSoftwareBundle(body as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "delete_software_bundle": {
          if (!is26R1) {
            throw new McpError(ErrorCode.MethodNotFound, "delete_software_bundle is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");
          }
          if (!args?.bundleId || typeof args.bundleId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "delete_software_bundle requires a bundleId (GUID) string parameter");
          }
          await sw.deleteSoftwareBundle(args.bundleId);
          return { content: [{ type: "text", text: JSON.stringify({ success: true }, null, 2) }] };
        }

        // ── Bundle Applications (26R1) ─────────────────────────────────
        case "list_bundle_applications": {
          if (!is26R1) {
            throw new McpError(ErrorCode.MethodNotFound, "list_bundle_applications is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");
          }
          const result = await sw.getBundleApplications((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_bundle_applications_by_bundle": {
          if (!is26R1) {
            throw new McpError(ErrorCode.MethodNotFound, "list_bundle_applications_by_bundle is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");
          }
          if (!args?.bundleId || typeof args.bundleId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "list_bundle_applications_by_bundle requires a bundleId (GUID) string parameter");
          }
          const { bundleId, ...params } = args as Record<string, unknown>;
          const result = await sw.getBundleApplicationsByBundle(bundleId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "add_application_to_bundle": {
          if (!is26R1) {
            throw new McpError(ErrorCode.MethodNotFound, "add_application_to_bundle is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");
          }
          if (!args?.bundleId || typeof args.bundleId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "add_application_to_bundle requires a bundleId (GUID) string parameter");
          }
          if (!args?.applicationId || typeof args.applicationId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "add_application_to_bundle requires an applicationId (GUID) string parameter");
          }
          const body: Record<string, unknown> = { applicationId: args.applicationId };
          if (typeof args.order === "number") body.order = args.order;
          const result = await sw.addApplicationToBundle(args.bundleId, body as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "delete_bundle_application": {
          if (!is26R1) {
            throw new McpError(ErrorCode.MethodNotFound, "delete_bundle_application is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");
          }
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "delete_bundle_application requires an id (GUID) string parameter");
          }
          await sw.deleteBundleApplication(args.id);
          return { content: [{ type: "text", text: JSON.stringify({ success: true }, null, 2) }] };
        }

        case "replace_application_in_bundle": {
          if (!is26R1) {
            throw new McpError(ErrorCode.MethodNotFound, "replace_application_in_bundle is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");
          }
          if (!args?.bundleId || typeof args.bundleId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "replace_application_in_bundle requires a bundleId (GUID) string parameter");
          }
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "replace_application_in_bundle requires an id (GUID) string parameter");
          }
          if (!Array.isArray(args?.patchOperations)) {
            throw new McpError(ErrorCode.InvalidParams, "replace_application_in_bundle requires a patchOperations array");
          }
          const result = await sw.replaceApplicationInBundle(args.bundleId, args.id, args.patchOperations as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // ── Bundle Folders (26R1) ──────────────────────────────────────
        case "list_bundle_folders": {
          if (!is26R1) {
            throw new McpError(ErrorCode.MethodNotFound, "list_bundle_folders is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");
          }
          const result = await sw.getBundleFolders((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_bundle_folder": {
          if (!is26R1) {
            throw new McpError(ErrorCode.MethodNotFound, "get_bundle_folder is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");
          }
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "get_bundle_folder requires an id (GUID) string parameter");
          }
          const result = await sw.getBundleFolder(args.id);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_bundle_folders_by_folder": {
          if (!is26R1) {
            throw new McpError(ErrorCode.MethodNotFound, "list_bundle_folders_by_folder is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");
          }
          if (!args?.folderId || typeof args.folderId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "list_bundle_folders_by_folder requires a folderId (GUID) string parameter");
          }
          const { folderId, ...params } = args as Record<string, unknown>;
          const result = await sw.getBundleFoldersByFolder(folderId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "create_bundle_folder": {
          if (!is26R1) {
            throw new McpError(ErrorCode.MethodNotFound, "create_bundle_folder is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");
          }
          if (!args?.name || typeof args.name !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "create_bundle_folder requires a name string parameter");
          }
          const body: Record<string, unknown> = { name: args.name };
          if (typeof args.parentId === "string") body.parentId = args.parentId;
          if (typeof args.comment === "string") body.comment = args.comment;
          const result = await sw.createBundleFolder(body as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "delete_bundle_folder": {
          if (!is26R1) {
            throw new McpError(ErrorCode.MethodNotFound, "delete_bundle_folder is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");
          }
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "delete_bundle_folder requires an id (GUID) string parameter");
          }
          await sw.deleteBundleFolder(args.id);
          return { content: [{ type: "text", text: JSON.stringify({ success: true }, null, 2) }] };
        }

        case "update_bundle_folder": {
          if (!is26R1) {
            throw new McpError(ErrorCode.MethodNotFound, "update_bundle_folder is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");
          }
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "update_bundle_folder requires an id (GUID) string parameter");
          }
          if (!Array.isArray(args?.patchOperations)) {
            throw new McpError(ErrorCode.InvalidParams, "update_bundle_folder requires a patchOperations array");
          }
          const result = await sw.updateBundleFolder(args.id, args.patchOperations as never);
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
      console.error("bconnect-software-mcp: BCONNECT_USERNAME and BCONNECT_PASSWORD are required");
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
    console.error(`bconnect-software-mcp: verifying bConnect API connectivity...`);
    const _connected = await _startupClient.testConnection();
    if (!_connected) {
      console.error(`bconnect-software-mcp: cannot reach bConnect API at ${_startupUrl}. Check BCONNECT_BASE_URL, credentials, and network.`);
      process.exit(1);
    }
    console.error(`bconnect-software-mcp: API connectivity verified.`);
  }

  const { server } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("bconnect-software-mcp started");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
