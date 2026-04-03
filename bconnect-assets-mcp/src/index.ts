#!/usr/bin/env node

/**
 * bconnect-assets-mcp
 *
 * A Model Context Protocol server that provides access to the baramundi
 * bConnect REST API for Assets management — assets, asset types, and folders.
 *
 * Supports both 25R2 and 26R1. Operations exclusive to 26R1 are only
 * registered when BCONNECT_RELEASE === '26R1'.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
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
  dotenv.config();
  const release = process.env.BCONNECT_RELEASE ?? "25R2";
  const is26R1 = release === "26R1";

  const server = new Server(
    {
      name: "bconnect-assets-mcp",
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

    const paginationProps = {
      Page: {
        type: "integer",
        description: "Zero-based page index for pagination. Default is 0."
      },
      PageSize: {
        type: "integer",
        description: "Number of items per page. Default is 20, maximum is 1000."
      }
    };

    const assetFilterProps = {
      OrderBy: {
        type: "string",
        description: "Sort results by property name and direction. Possible values: AssetId, OwnerId, OwnerType, etc. (e.g. 'OwnerId asc')."
      },
      SearchQuery: {
        type: "string",
        description: "Filter results by matching against Name, InventoryNumber, Contact, or CostCenter."
      },
      DisplayName: {
        type: "string",
        description: "Filter results by matching the exact value against DisplayName."
      },
      ...paginationProps
    };

    const folderFilterProps = {
      OrderBy: {
        type: "string",
        description: "Sort results by property name and direction."
      },
      SearchQuery: {
        type: "string",
        description: "Filter results by matching searchable properties."
      },
      Name: {
        type: "string",
        description: "Filter results by exact folder name."
      },
      ...paginationProps
    };

    const patchBodyProp = {
      operations: {
        type: "array",
        description: "JSON Patch operations array (RFC 6902). Each operation is an object with 'op' (replace/add/remove), 'path', and 'value' fields.",
        items: {
          type: "object",
          properties: {
            op: { type: "string", description: "Operation type: replace, add, remove, copy, move, test." },
            path: { type: "string", description: "JSON Pointer path to the field (e.g. '/name')." },
            value: { description: "The new value for the field (used with replace/add)." }
          },
          required: ["op", "path"]
        }
      }
    };

    const tools: object[] = [

      // ── Assets ─────────────────────────────────────────────────────────
      {
        name: "list_assets",
        description: "List all assets in baramundi Management Suite. Returns a paged list of assets with their IDs, names, asset type, owner, inventory number, and other metadata. Use this to browse all assets or filter by search query.",
        inputSchema: {
          type: "object",
          properties: assetFilterProps,
          required: []
        }
      },

      {
        name: "create_asset",
        description: "Create a new asset in baramundi Management Suite. Requires an asset type ID, owner ID, owner type, and name. Optionally set contact, inventory number, cost center, purchase info, energy values, and custom additional properties.",
        inputSchema: {
          type: "object",
          properties: {
            assetTypeId: { type: "string", description: "GUID of the asset type for this asset." },
            ownerId: { type: "string", description: "GUID of the owner (e.g. endpoint, user, or asset stock)." },
            ownerType: { type: "string", description: "Type of the owner. E.g. 'WindowsEndpoint', 'ADObject', 'AssetStock'." },
            name: { type: "string", description: "Name of the asset." },
            comments: { type: "string", description: "Optional comments or notes about the asset." },
            contact: { type: "string", description: "Contact person for this asset." },
            inventoryNumber: { type: "string", description: "Inventory number for this asset." },
            url: { type: "string", description: "URL associated with this asset." },
            costCenter: { type: "string", description: "Cost center assigned to this asset." },
            purchaseDate: { type: "string", description: "Purchase date in ISO 8601 format." },
            purchasePrice: { type: "number", description: "Purchase price of the asset." },
            operatingCost: { type: "number", description: "Operating cost of the asset." },
            energyOff: { type: "number", description: "Energy consumption when off (watts)." },
            energyOn: { type: "number", description: "Energy consumption when on (watts)." },
            additionalProperties: {
              type: "array",
              description: "Additional custom properties defined by the asset type.",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  value: { type: "string" }
                }
              }
            },
            assetReferenceList: {
              type: "array",
              description: "List of asset references linking this asset to other objects.",
              items: {
                type: "object",
                properties: {
                  assetReferenceType: { type: "string" },
                  ownerReferenceId: { type: "string" }
                }
              }
            }
          },
          required: ["assetTypeId", "ownerId", "ownerType", "name"]
        }
      },

      {
        name: "get_asset",
        description: "Get detailed information for a specific asset by its GUID. Returns the asset name, type, owner, inventory number, purchase info, energy values, and all additional properties. Use list_assets to discover asset GUIDs.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the asset to retrieve." }
          },
          required: ["id"]
        }
      },

      {
        name: "update_asset",
        description: "Update one or more fields of an existing asset using JSON Patch operations (RFC 6902). Use 'replace' to change a value, 'add' to set a new value, or 'remove' to clear a field. Example: [{\"op\":\"replace\",\"path\":\"/name\",\"value\":\"New Name\"}].",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the asset to update." },
            ...patchBodyProp
          },
          required: ["id", "operations"]
        }
      },

      {
        name: "delete_asset",
        description: "Permanently delete an asset by its GUID. This action cannot be undone. Use get_asset to verify the asset before deletion.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the asset to delete." }
          },
          required: ["id"]
        }
      },

      {
        name: "list_assets_in_asset_stock",
        description: "List all assets located in the Asset Stock (the well-known stock container, GUID: D4E3C25B-A3AB-4204-9D26-08ECC6237DC6). Returns a paged list of assets not currently assigned to an endpoint or user.",
        inputSchema: {
          type: "object",
          properties: assetFilterProps,
          required: []
        }
      },

      {
        name: "list_assets_by_logical_group",
        description: "List all assets assigned to endpoints within a specific logical group. Returns a paged list of assets for the given logical group GUID.",
        inputSchema: {
          type: "object",
          properties: {
            logicalGroupId: { type: "string", description: "GUID of the logical group whose assets to list." },
            ...assetFilterProps
          },
          required: ["logicalGroupId"]
        }
      },

      {
        name: "list_assets_by_windows_endpoint",
        description: "List all assets assigned to a specific Windows endpoint. Returns a paged list of assets owned by the given endpoint GUID.",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "GUID of the Windows endpoint whose assets to list." },
            ...assetFilterProps
          },
          required: ["endpointId"]
        }
      },

      // ── Asset Stock Folders ────────────────────────────────────────────
      {
        name: "list_asset_stock_folders",
        description: "List all asset stock folders in baramundi Management Suite. Returns a paged list of folders used to organize assets in the asset stock.",
        inputSchema: {
          type: "object",
          properties: folderFilterProps,
          required: []
        }
      },

      {
        name: "create_asset_stock_folder",
        description: "Create a new folder in the asset stock to organize assets. Optionally specify a parent folder to create a subfolder.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name of the folder to create." },
            parentId: { type: "string", description: "GUID of the parent folder. If omitted, creates a top-level folder." },
            comment: { type: "string", description: "Optional comment or description for the folder." }
          },
          required: ["name"]
        }
      },

      {
        name: "get_asset_stock_folder",
        description: "Get detailed information for a specific asset stock folder by its GUID. Returns the folder name, comment, and parent folder reference. Use list_asset_stock_folders to discover folder GUIDs.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the asset stock folder to retrieve." }
          },
          required: ["id"]
        }
      },

      {
        name: "update_asset_stock_folder",
        description: "Update one or more fields of an existing asset stock folder using JSON Patch operations (RFC 6902). Example: [{\"op\":\"replace\",\"path\":\"/name\",\"value\":\"New Name\"}].",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the asset stock folder to update." },
            ...patchBodyProp
          },
          required: ["id", "operations"]
        }
      },

      {
        name: "delete_asset_stock_folder",
        description: "Permanently delete an asset stock folder by its GUID. This action cannot be undone. Ensure the folder is empty before deletion.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the asset stock folder to delete." }
          },
          required: ["id"]
        }
      },

      {
        name: "list_asset_stock_subfolders",
        description: "List all child folders directly contained within a specific asset stock parent folder. Optionally include all nested subfolders recursively within the hierarchy.",
        inputSchema: {
          type: "object",
          properties: {
            folderId: { type: "string", description: "GUID of the parent asset stock folder whose subfolders to list." },
            includeSubfolders: { type: "boolean", description: "If true, recursively include all nested subfolders." },
            ...folderFilterProps
          },
          required: ["folderId"]
        }
      },

      // ── Asset Type Folders ─────────────────────────────────────────────
      {
        name: "list_asset_type_folders",
        description: "List all asset type folders in baramundi Management Suite. Returns a paged list of folders used to organize asset types.",
        inputSchema: {
          type: "object",
          properties: folderFilterProps,
          required: []
        }
      },

      {
        name: "create_asset_type_folder",
        description: "Create a new folder for organizing asset types in the bConnect inventory. Optionally specify a parent folder to create a nested subfolder.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name of the folder to create." },
            parentId: { type: "string", description: "GUID of the parent folder. If omitted, creates a top-level folder." },
            comment: { type: "string", description: "Optional comment or description for the folder." }
          },
          required: ["name"]
        }
      },

      {
        name: "get_asset_type_folder",
        description: "Get detailed information for a specific asset type folder by its GUID. Returns the folder name, comment, and parent folder reference. Use list_asset_type_folders to discover folder GUIDs.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the asset type folder to retrieve." }
          },
          required: ["id"]
        }
      },

      {
        name: "update_asset_type_folder",
        description: "Update one or more fields of an existing asset type folder using JSON Patch operations (RFC 6902). Example: [{\"op\":\"replace\",\"path\":\"/name\",\"value\":\"New Name\"}].",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the asset type folder to update." },
            ...patchBodyProp
          },
          required: ["id", "operations"]
        }
      },

      {
        name: "delete_asset_type_folder",
        description: "Permanently delete an asset type folder by its GUID. This action cannot be undone. Ensure the folder is empty before deletion.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the asset type folder to delete." }
          },
          required: ["id"]
        }
      },

      {
        name: "list_asset_type_subfolders",
        description: "List all child folders directly contained within a specific asset type parent folder. Optionally include all nested subfolders recursively within the hierarchy.",
        inputSchema: {
          type: "object",
          properties: {
            folderId: { type: "string", description: "GUID of the parent asset type folder whose subfolders to list." },
            includeSubfolders: { type: "boolean", description: "If true, recursively include all nested subfolders." },
            ...folderFilterProps
          },
          required: ["folderId"]
        }
      },

      // ── Asset Types ────────────────────────────────────────────────────
      {
        name: "list_asset_types",
        description: "List all asset types defined in baramundi Management Suite. Returns a paged list of asset types with their GUIDs, names, and optional summary data. Asset types define the structure and properties of assets.",
        inputSchema: {
          type: "object",
          properties: {
            OrderBy: {
              type: "string",
              description: "Sort results by property name and direction."
            },
            SearchQuery: {
              type: "string",
              description: "Filter results by matching searchable properties."
            },
            ShowSummary: {
              type: "boolean",
              description: "If true, include summary statistics (stock count, asset count, total purchase price, total operating cost) in results."
            },
            Icon: {
              type: "boolean",
              description: "If true, include icon data in results."
            },
            AdditionalProperties: {
              type: "boolean",
              description: "If true, include additional property definitions in results."
            },
            ...paginationProps
          },
          required: []
        }
      },

      {
        name: "create_asset_type",
        description: "Create a new asset type in baramundi Management Suite. Asset types define the template for assets. Requires an owner ID (folder GUID) and a name.",
        inputSchema: {
          type: "object",
          properties: {
            ownerId: { type: "string", description: "GUID of the owner folder for this asset type." },
            name: { type: "string", description: "Name of the asset type." },
            comments: { type: "string", description: "Optional comments about this asset type." },
            contact: { type: "string", description: "Contact person for this asset type." },
            inventoryNumber: { type: "string", description: "Default inventory number pattern." },
            url: { type: "string", description: "URL associated with this asset type." },
            costCenter: { type: "string", description: "Default cost center for assets of this type." },
            purchaseDate: { type: "string", description: "Default purchase date in ISO 8601 format." },
            purchasePrice: { type: "number", description: "Default purchase price." },
            operatingCost: { type: "number", description: "Default operating cost." },
            icon: { type: "string", description: "Icon data (base64 encoded image) for this asset type." },
            energyOff: { type: "number", description: "Default energy consumption when off (watts)." },
            energyOn: { type: "number", description: "Default energy consumption when on (watts)." },
            additionalProperties: {
              type: "array",
              description: "Additional custom property definitions for this asset type.",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  type: { type: "string" },
                  data: { type: "string" },
                  comments: { type: "string" }
                }
              }
            }
          },
          required: ["ownerId", "name"]
        }
      },

      {
        name: "get_asset_type",
        description: "Get detailed information for a specific asset type by its GUID. Returns the asset type name, default values, icon, and all additional property definitions. Use list_asset_types to discover asset type GUIDs.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the asset type to retrieve." }
          },
          required: ["id"]
        }
      },

      {
        name: "delete_asset_type",
        description: "Permanently delete an asset type by its GUID. This action cannot be undone. Ensure no assets are using this type before deletion.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the asset type to delete." }
          },
          required: ["id"]
        }
      },

    ];

    // 26R1-only tools
    if (is26R1) {
      (tools as any[]).push(
        {
          name: "list_assets_by_org_unit",
          description: "[26R1] List all assets assigned to endpoints within a specific organizational unit. Returns a paged list of assets for the given OU GUID. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              orgUnitId: { type: "string", description: "GUID of the organizational unit whose assets to list." },
              ...assetFilterProps
            },
            required: ["orgUnitId"]
          }
        },
        {
          name: "list_assets_by_ad_object",
          description: "[26R1] List all assets assigned to a specific Active Directory object (user or group). Returns a paged list of assets owned by the given AD object GUID. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              adObjectId: { type: "string", description: "GUID of the Active Directory object whose assets to list." },
              ...assetFilterProps
            },
            required: ["adObjectId"]
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
    "create_asset",
    "update_asset",
    "delete_asset",
    "create_asset_stock_folder",
    "update_asset_stock_folder",
    "delete_asset_stock_folder",
    "create_asset_type_folder",
    "update_asset_type_folder",
    "delete_asset_type_folder",
    "create_asset_type",
    "delete_asset_type",
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


    // Lazily create BConnect client — allows server instantiation in tests without real credentials.
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

      const rateLimitEnabled = process.env.BCONNECT_RATE_LIMIT_ENABLED === "true";
      const rateLimitMaxRequests = parseInt(process.env.BCONNECT_RATE_LIMIT_MAX_REQUESTS ?? "", 10);
      const rateLimitWindowMs = parseInt(process.env.BCONNECT_RATE_LIMIT_WINDOW_MS ?? "", 10);

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
        ...(rateLimitEnabled && {
          rateLimit: {
            enabled: true,
            maxRequests: isNaN(rateLimitMaxRequests) ? 100 : rateLimitMaxRequests,
            windowMs: isNaN(rateLimitWindowMs) ? 60000 : rateLimitWindowMs,
          }
        }),
        auditLog: {
          level: auditLevel,
        },
      });
    };

    try {
      const bconnect = getBconnect();
      const assets = bconnect.assets;

      switch (name) {

        // ── Assets ─────────────────────────────────────────────────────────
        case "list_assets": {
          const result = await assets.getAssets((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "create_asset": {
          if (!args?.assetTypeId || !args?.ownerId || !args?.ownerType || !args?.name) {
            throw new McpError(ErrorCode.InvalidParams, "create_asset requires assetTypeId, ownerId, ownerType, and name");
          }
          const result = await assets.createAsset(args as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_asset": {
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "get_asset requires an id (GUID) string parameter");
          }
          const result = await assets.getAsset(args.id);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_asset": {
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "update_asset requires an id (GUID) string parameter");
          }
          if (!Array.isArray(args?.operations)) {
            throw new McpError(ErrorCode.InvalidParams, "update_asset requires an operations array (JSON Patch)");
          }
          const result = await assets.updateAsset(args.id, args.operations as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "delete_asset": {
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "delete_asset requires an id (GUID) string parameter");
          }
          await assets.deleteAsset(args.id);
          return { content: [{ type: "text", text: JSON.stringify({ success: true, id: args.id }, null, 2) }] };
        }

        case "list_assets_in_asset_stock": {
          const result = await assets.getAssetsAssetStock((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_assets_by_logical_group": {
          if (!args?.logicalGroupId || typeof args.logicalGroupId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "list_assets_by_logical_group requires a logicalGroupId (GUID) string parameter");
          }
          const result = await assets.getAssetsByLogicalGroup(args.logicalGroupId, (args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_assets_by_windows_endpoint": {
          if (!args?.endpointId || typeof args.endpointId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "list_assets_by_windows_endpoint requires an endpointId (GUID) string parameter");
          }
          const result = await assets.getAssetsByWindowsEndpoint(args.endpointId, (args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_assets_by_org_unit": {
          if (!is26R1) {
            throw new McpError(ErrorCode.MethodNotFound, "list_assets_by_org_unit is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");
          }
          if (!args?.orgUnitId || typeof args.orgUnitId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "list_assets_by_org_unit requires an orgUnitId (GUID) string parameter");
          }
          const result = await assets.getAssetsByOrgUnit(args.orgUnitId, (args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_assets_by_ad_object": {
          if (!is26R1) {
            throw new McpError(ErrorCode.MethodNotFound, "list_assets_by_ad_object is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");
          }
          if (!args?.adObjectId || typeof args.adObjectId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "list_assets_by_ad_object requires an adObjectId (GUID) string parameter");
          }
          const result = await assets.getAssetsByADObject(args.adObjectId, (args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // ── Asset Stock Folders ────────────────────────────────────────────
        case "list_asset_stock_folders": {
          const result = await assets.getAssetStockFolders((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "create_asset_stock_folder": {
          if (!args?.name || typeof args.name !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "create_asset_stock_folder requires a name string parameter");
          }
          const result = await assets.createAssetStockFolder(args as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_asset_stock_folder": {
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "get_asset_stock_folder requires an id (GUID) string parameter");
          }
          const result = await assets.getAssetStockFolder(args.id);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_asset_stock_folder": {
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "update_asset_stock_folder requires an id (GUID) string parameter");
          }
          if (!Array.isArray(args?.operations)) {
            throw new McpError(ErrorCode.InvalidParams, "update_asset_stock_folder requires an operations array (JSON Patch)");
          }
          const result = await assets.updateAssetStockFolder(args.id, args.operations as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "delete_asset_stock_folder": {
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "delete_asset_stock_folder requires an id (GUID) string parameter");
          }
          await assets.deleteAssetStockFolder(args.id);
          return { content: [{ type: "text", text: JSON.stringify({ success: true, id: args.id }, null, 2) }] };
        }

        case "list_asset_stock_subfolders": {
          if (!args?.folderId || typeof args.folderId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "list_asset_stock_subfolders requires a folderId (GUID) string parameter");
          }
          const result = await assets.getAssetStockFoldersByParent(args.folderId, (args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // ── Asset Type Folders ─────────────────────────────────────────────
        case "list_asset_type_folders": {
          const result = await assets.getAssetTypeFolders((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "create_asset_type_folder": {
          if (!args?.name || typeof args.name !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "create_asset_type_folder requires a name string parameter");
          }
          const result = await assets.createAssetTypeFolder(args as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_asset_type_folder": {
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "get_asset_type_folder requires an id (GUID) string parameter");
          }
          const result = await assets.getAssetTypeFolder(args.id);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_asset_type_folder": {
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "update_asset_type_folder requires an id (GUID) string parameter");
          }
          if (!Array.isArray(args?.operations)) {
            throw new McpError(ErrorCode.InvalidParams, "update_asset_type_folder requires an operations array (JSON Patch)");
          }
          const result = await assets.updateAssetTypeFolder(args.id, args.operations as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "delete_asset_type_folder": {
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "delete_asset_type_folder requires an id (GUID) string parameter");
          }
          await assets.deleteAssetTypeFolder(args.id);
          return { content: [{ type: "text", text: JSON.stringify({ success: true, id: args.id }, null, 2) }] };
        }

        case "list_asset_type_subfolders": {
          if (!args?.folderId || typeof args.folderId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "list_asset_type_subfolders requires a folderId (GUID) string parameter");
          }
          const result = await assets.getAssetTypeFoldersByParent(args.folderId, (args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // ── Asset Types ────────────────────────────────────────────────────
        case "list_asset_types": {
          const result = await assets.getAssetTypes((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "create_asset_type": {
          if (!args?.ownerId || !args?.name) {
            throw new McpError(ErrorCode.InvalidParams, "create_asset_type requires ownerId and name parameters");
          }
          const result = await assets.createAssetType(args as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_asset_type": {
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "get_asset_type requires an id (GUID) string parameter");
          }
          const result = await assets.getAssetType(args.id);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "delete_asset_type": {
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "delete_asset_type requires an id (GUID) string parameter");
          }
          await assets.deleteAssetType(args.id);
          return { content: [{ type: "text", text: JSON.stringify({ success: true, id: args.id }, null, 2) }] };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error: unknown) {
      if (error instanceof McpError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${message}`);
    }
  });

  return { server };
}

// ─── Entry point ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  

  
  // Startup connectivity check (REQ-SRV-013)
  dotenv.config();
  {
    const _startupUrl = process.env.BCONNECT_BASE_URL || "https://bms-win22srv:444/bconnect";
    const _startupUser = process.env.BCONNECT_USERNAME;
    const _startupPass = process.env.BCONNECT_PASSWORD;
    if (!_startupUser || !_startupPass) {
      console.error("bconnect-assets-mcp: BCONNECT_USERNAME and BCONNECT_PASSWORD are required");
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
    console.error(`bconnect-assets-mcp: verifying bConnect API connectivity...`);
    const _connected = await _startupClient.testConnection();
    if (!_connected) {
      console.error(`bconnect-assets-mcp: cannot reach bConnect API at ${_startupUrl}. Check BCONNECT_BASE_URL, credentials, and network.`);
      process.exit(1);
    }
    console.error(`bconnect-assets-mcp: API connectivity verified.`);
  }

  const { server } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("bconnect-assets-mcp started");
}

if (!process.env.VITEST) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
