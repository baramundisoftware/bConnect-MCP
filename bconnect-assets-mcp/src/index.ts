#!/usr/bin/env node

/**
 * bconnect-assets-mcp
 *
 * A Model Context Protocol server that provides access to the baramundi
 * bConnect REST API for Assets management — assets, asset types, and folders.
 *
 * Supports both 25R2 and 26R1. Operations exclusive to 26R1 are only
 * registered when the selected release (detected at startup, #159) is 26R1.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { BConnectClient } from "./bconnect-client.js";
import { validateOrThrow, toolErrorResult, lazyClient, withUnverifiedWriteMarker, pickArguments, declaredArgumentsOnly, queryParameters, withQueryProperties, withCountOnly, serverClients, runServer, withToolAnnotations, withWriteToolsHidden, toolJsonResult, selectedRelease, withReleaseTools, refuseUnavailableTool } from "@bconnect/mcp-core";
import { QUERY_PARAMETERS } from "./query-params.js";
import { TOOL_RELEASES } from "./tool-releases.js";
import { TOOL_METHODS } from "./tool-methods.js";

/** The query parameters a list tool sends: exactly what its route declares in the selected release (#179). */
const sends = (tool: string): string[] => queryParameters(QUERY_PARAMETERS, selectedRelease(), tool);
import type { BConnectCredentials } from "@bconnect/mcp-core";
import { AssetsRules } from "./utils/mcp-tool-validation-rules.js";

// ─── Factory exported for testing ───────────────────────────────────────────

export type { BConnectCredentials } from "@bconnect/mcp-core";

/** AssetForCreation properties the create_asset tool offers; nothing else goes into the body (#189). */
const ASSET_FIELDS = ["assetTypeId", "ownerId", "ownerType", "name", "comments", "contact", "inventoryNumber", "url",
  "costCenter", "purchaseDate", "purchasePrice", "operatingCost", "energyOff", "energyOn", "additionalProperties"];

/** The server's bConnect clients: one shared by every tool call (REQ-SRV-023). */
const clients = serverClients(BConnectClient);

export function createServer(credentials?: BConnectCredentials): { server: Server } {
  const release = selectedRelease();

  const server = new Server(
    {
      name: "bconnect-assets-mcp",
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

  const toolCatalog = declaredArgumentsOnly(withQueryProperties(QUERY_PARAMETERS, () => selectedRelease(), withUnverifiedWriteMarker(WRITE_TOOLS, async () => {

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
          properties: {},
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
            ownerType: { type: "string", enum: ["Undefined", "LogicalGroup", "Machine", "AssetStock", "ADObject", "OrgUnit"], description: "Kind of owner: Machine (an endpoint), AssetStock, ADObject, LogicalGroup or OrgUnit." },
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
          properties: {},
          required: []
        }
      },

      {
        name: "list_assets_by_logical_group",
        description: "List all assets assigned to endpoints within a specific logical group. Returns a paged list of assets for the given logical group GUID.",
        inputSchema: {
          type: "object",
          properties: {
            logicalGroupId: { type: "string", description: "GUID of the logical group whose assets to list." }
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
            endpointId: { type: "string", description: "GUID of the Windows endpoint whose assets to list." }
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
          properties: {},
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
            folderId: { type: "string", description: "GUID of the parent asset stock folder whose subfolders to list." }
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
          properties: {},
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
            folderId: { type: "string", description: "GUID of the parent asset type folder whose subfolders to list." }
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
          properties: {},
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
    (tools as object[]).push(
      {
        name: "list_assets_by_org_unit",
        description: "[26R1] List all assets assigned to endpoints within a specific organizational unit. Returns a paged list of assets for the given OU GUID. Available in bConnect 26R1 and later.",
        inputSchema: {
          type: "object",
          properties: {
            orgUnitId: { type: "string", description: "GUID of the organizational unit whose assets to list." }
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
            adObjectId: { type: "string", description: "GUID of the Active Directory object whose assets to list." }
          },
          required: ["adObjectId"]
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
      // Assets
      case "list_assets":
        validateOrThrow(args, AssetsRules.listAssets()); return;
      case "create_asset":
        validateOrThrow(args, AssetsRules.createAsset()); return;
      case "get_asset":
        validateOrThrow(args, AssetsRules.getAsset()); return;
      case "update_asset":
        validateOrThrow(args, AssetsRules.updateAsset()); return;
      case "delete_asset":
        validateOrThrow(args, AssetsRules.deleteAsset()); return;
      case "list_assets_in_asset_stock":
        validateOrThrow(args, AssetsRules.listAssetsInAssetStock()); return;
      case "list_assets_by_logical_group":
        validateOrThrow(args, AssetsRules.listAssetsByLogicalGroup()); return;
      case "list_assets_by_windows_endpoint":
        validateOrThrow(args, AssetsRules.listAssetsByWindowsEndpoint()); return;
      case "list_assets_by_org_unit":
        validateOrThrow(args, AssetsRules.listAssetsByOrgUnit()); return;
      case "list_assets_by_ad_object":
        validateOrThrow(args, AssetsRules.listAssetsByAdObject()); return;
      // Asset Stock Folders
      case "list_asset_stock_folders":
        validateOrThrow(args, AssetsRules.listAssetStockFolders()); return;
      case "create_asset_stock_folder":
        validateOrThrow(args, AssetsRules.createAssetStockFolder()); return;
      case "get_asset_stock_folder":
        validateOrThrow(args, AssetsRules.getAssetStockFolder()); return;
      case "update_asset_stock_folder":
        validateOrThrow(args, AssetsRules.updateAssetStockFolder()); return;
      case "delete_asset_stock_folder":
        validateOrThrow(args, AssetsRules.deleteAssetStockFolder()); return;
      case "list_asset_stock_subfolders":
        validateOrThrow(args, AssetsRules.listAssetStockSubfolders()); return;
      // Asset Type Folders
      case "list_asset_type_folders":
        validateOrThrow(args, AssetsRules.listAssetTypeFolders()); return;
      case "create_asset_type_folder":
        validateOrThrow(args, AssetsRules.createAssetTypeFolder()); return;
      case "get_asset_type_folder":
        validateOrThrow(args, AssetsRules.getAssetTypeFolder()); return;
      case "update_asset_type_folder":
        validateOrThrow(args, AssetsRules.updateAssetTypeFolder()); return;
      case "delete_asset_type_folder":
        validateOrThrow(args, AssetsRules.deleteAssetTypeFolder()); return;
      case "list_asset_type_subfolders":
        validateOrThrow(args, AssetsRules.listAssetTypeSubfolders()); return;
      // Asset Types
      case "list_asset_types":
        validateOrThrow(args, AssetsRules.listAssetTypes()); return;
      case "create_asset_type":
        validateOrThrow(args, AssetsRules.createAssetType()); return;
      case "get_asset_type":
        validateOrThrow(args, AssetsRules.getAssetType()); return;
      case "delete_asset_type":
        validateOrThrow(args, AssetsRules.deleteAssetType()); return;
      // Unknown tool names are not validated here; dispatch handles MethodNotFound.
    }
  }

  // countOnly (#165): count with one 1-row request instead of loading a page.
  server.setRequestHandler(CallToolRequestSchema, withCountOnly(QUERY_PARAMETERS, () => selectedRelease(), async (request) => {
    const { name, arguments: args } = request.params;
    // Refuse arguments the tool doesn't declare, before anything else (REQ-SRV-022).
    await toolCatalog.refuseUndeclared(name, args);
    // A tool the selected release lacks is refused by name, before anything is sent (#159).
    refuseUnavailableTool(TOOL_RELEASES, name);

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


    // Lazily create BConnect client — allows server instantiation in tests without real credentials.
    const getBconnect = (): BConnectClient => {
      // The server's shared client (REQ-SRV-023). A ClientConfigError (e.g. missing
      // credentials) reaches the catch below and becomes a tool result (REQ-XC-001).
      return clients.get(credentials);
    };

    try {
      const bconnect = lazyClient(getBconnect);
      const assets = lazyClient(() => bconnect.assets);

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        // ── Assets ─────────────────────────────────────────────────────────
        case "list_assets": {
          const result = await assets.getAssets(pickArguments(args ?? {}, sends("list_assets")));
          return toolJsonResult(result);
        }

        case "create_asset": {
          const result = await assets.createAsset(pickArguments(args ?? {}, ASSET_FIELDS));
          return toolJsonResult(result);
        }

        case "get_asset": {
          const result = await assets.getAsset(args!.id as string);
          return toolJsonResult(result);
        }

        case "update_asset": {
          const result = await assets.updateAsset(args!.id as string, args!.operations as never);
          return toolJsonResult(result);
        }

        case "delete_asset": {
          await assets.deleteAsset(args!.id as string);
          return toolJsonResult({ success: true, id: args!.id });
        }

        case "list_assets_in_asset_stock": {
          const result = await assets.getAssetsAssetStock(pickArguments(args ?? {}, sends("list_assets_in_asset_stock")));
          return toolJsonResult(result);
        }

        case "list_assets_by_logical_group": {
          const result = await assets.getAssetsByLogicalGroup(args!.logicalGroupId as string, pickArguments(args ?? {}, sends("list_assets_by_logical_group")));
          return toolJsonResult(result);
        }

        case "list_assets_by_windows_endpoint": {
          const result = await assets.getAssetsByWindowsEndpoint(args!.endpointId as string, pickArguments(args ?? {}, sends("list_assets_by_windows_endpoint")));
          return toolJsonResult(result);
        }

        case "list_assets_by_org_unit": {
          const result = await assets.getAssetsByOrgUnit(args!.orgUnitId as string, pickArguments(args ?? {}, sends("list_assets_by_org_unit")));
          return toolJsonResult(result);
        }

        case "list_assets_by_ad_object": {
          const result = await assets.getAssetsByADObject(args!.adObjectId as string, pickArguments(args ?? {}, sends("list_assets_by_ad_object")));
          return toolJsonResult(result);
        }

        // ── Asset Stock Folders ────────────────────────────────────────────
        case "list_asset_stock_folders": {
          const result = await assets.getAssetStockFolders(pickArguments(args ?? {}, sends("list_asset_stock_folders")));
          return toolJsonResult(result);
        }

        case "create_asset_stock_folder": {
          const result = await assets.createAssetStockFolder(args as never);
          return toolJsonResult(result);
        }

        case "get_asset_stock_folder": {
          const result = await assets.getAssetStockFolder(args!.id as string);
          return toolJsonResult(result);
        }

        case "update_asset_stock_folder": {
          const result = await assets.updateAssetStockFolder(args!.id as string, args!.operations as never);
          return toolJsonResult(result);
        }

        case "delete_asset_stock_folder": {
          await assets.deleteAssetStockFolder(args!.id as string);
          return toolJsonResult({ success: true, id: args!.id });
        }

        case "list_asset_stock_subfolders": {
          const result = await assets.getAssetStockFoldersByParent(args!.folderId as string, pickArguments(args ?? {}, sends("list_asset_stock_subfolders")));
          return toolJsonResult(result);
        }

        // ── Asset Type Folders ─────────────────────────────────────────────
        case "list_asset_type_folders": {
          const result = await assets.getAssetTypeFolders(pickArguments(args ?? {}, sends("list_asset_type_folders")));
          return toolJsonResult(result);
        }

        case "create_asset_type_folder": {
          const result = await assets.createAssetTypeFolder(args as never);
          return toolJsonResult(result);
        }

        case "get_asset_type_folder": {
          const result = await assets.getAssetTypeFolder(args!.id as string);
          return toolJsonResult(result);
        }

        case "update_asset_type_folder": {
          const result = await assets.updateAssetTypeFolder(args!.id as string, args!.operations as never);
          return toolJsonResult(result);
        }

        case "delete_asset_type_folder": {
          await assets.deleteAssetTypeFolder(args!.id as string);
          return toolJsonResult({ success: true, id: args!.id });
        }

        case "list_asset_type_subfolders": {
          const result = await assets.getAssetTypeFoldersByParent(args!.folderId as string, pickArguments(args ?? {}, sends("list_asset_type_subfolders")));
          return toolJsonResult(result);
        }

        // ── Asset Types ────────────────────────────────────────────────────
        case "list_asset_types": {
          const result = await assets.getAssetTypes(pickArguments(args ?? {}, sends("list_asset_types")));
          return toolJsonResult(result);
        }

        case "create_asset_type": {
          const result = await assets.createAssetType(args as never);
          return toolJsonResult(result);
        }

        case "get_asset_type": {
          const result = await assets.getAssetType(args!.id as string);
          return toolJsonResult(result);
        }

        case "delete_asset_type": {
          await assets.deleteAssetType(args!.id as string);
          return toolJsonResult({ success: true, id: args!.id });
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error: unknown) {
      // API errors, gate refusals and configuration errors are tool results the
      // model can read; only McpErrors stay protocol errors (REQ-XC-001).
      return toolErrorResult(error, release);
    }
  }));

  return { server };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

runServer({ name: "bconnect-assets-mcp", createServer, clients });
