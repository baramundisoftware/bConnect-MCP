#!/usr/bin/env node

/**
 * bconnect-assets-mcp
 *
 * A Model Context Protocol server that provides access to the baramundi
 * bConnect REST API for Assets management — assets, asset types, and folders.
 *
 * Requires bConnect 26R1 or later. 25R2 is no longer supported: the
 * BCONNECT_RELEASE switch is gone and `list_assets_by_org_unit` /
 * `list_assets_by_ad_object` are registered unconditionally.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import express from "express";
// OPT-32 — the unified bootstrap. Read packages/mcp-core/src/run-server.ts
// before changing anything below: it records which behaviour each of the
// thirteen hand-written main()s had and which one survived.
import { runServer, shouldAutoStart, describeConnectionFailure } from "@bconnect/mcp-core";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode
} from "@modelcontextprotocol/sdk/types.js";
import { BConnectClient } from "./bconnect-client.js";
import { createClientProvider } from "@bconnect/mcp-core";
import { validateOrThrow, serializeToolResult } from "@bconnect/mcp-core";
// Finding A2 / INT-53 — throw BareMcpError, never McpError, out of a request
// handler: McpError bakes "MCP error <code>: " into .message and the SDK adds
// it again client-side. `instanceof McpError` still holds, so the catch-all
// guards below are unaffected. See packages/mcp-core/src/protocol-error.ts.
import { BareMcpError } from "@bconnect/mcp-core";
// TOK-20 / TOK-25 / TOK-10 / INT-53 — the shared composition layer. See
// packages/mcp-core/src/{tool-catalogue,count-only,schema-fragments,tool-error}.ts.
import {
  defineToolCatalogue,
  handleToolError,
  toolTextResult,
  apiParams,
  isCountOnlyRequest,
  fetchCount,
  countOnlyProperty,
  pageProperties,
  exactMatchFilter,
  createListShaper,
  detailProperty,
  fieldsProperty,
  type ListEnvelope,
  type Row,
} from "@bconnect/mcp-core";
import { AssetsRules } from "./utils/mcp-tool-validation-rules.js";

// ─── Factory exported for testing ───────────────────────────────────────────

export interface BConnectCredentials {
  baseUrl?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

export function createServer(credentials?: BConnectCredentials): { server: Server; getClient: () => BConnectClient } {
  // OPT-32 — the `dotenv.config()` that used to stand here is gone. It was the
  // third call in this process: runServer() makes one at startup and
  // createClientProvider makes one per client build, both of which happen
  // before any tool reads the environment. This server was the only one of the
  // thirteen that also called it from createServer().
  const server = new Server(
    {
      name: "bconnect-assets-mcp",
      version: "26.1.8"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── Tool catalogue ────────────────────────────────────────────────────────
  //
  // TOK-10 — the pagination and exact-match wording now comes from mcp-core, so
  // every server in the suite says the same thing (and says it once). The
  // domain-specific OrderBy/SearchQuery hints stay: they name the properties
  // this route actually sorts and searches, which the generic wording cannot.
  //
  // `object[]` rather than an inferred union: without it TypeScript computes a
  // best-common-type across every tool's inputSchema and rejects any property no
  // other tool happens to declare.
  const TOOLS: { name: string; [key: string]: unknown }[] = [];
  {
    const paginationProps = {
      ...pageProperties,
      ...countOnlyProperty,
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
      ...exactMatchFilter("DisplayName"),
      ...paginationProps
    };

    // OPT-3 — list_assets only. additionalProperties[{name,type,value}] and
    // page-constant columns (url, energyOff, energyOn, assetReferenceList on a
    // default-configuration estate) are the two things wasting bytes here; see
    // the shaper declared below. Not spread into `assetFilterProps` itself —
    // the other five tools sharing that object were measured-but-not-triaged,
    // not decided against, and widening their schema is a separate change.
    const listAssetsProps = {
      ...assetFilterProps,
      ...detailProperty,
      ...fieldsProperty,
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
      ...exactMatchFilter("Name"),
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

    TOOLS.push(

      // ── Assets ─────────────────────────────────────────────────────────
      {
        name: "list_assets",
        description: "List all assets in baramundi Management Suite. Returns a paged list of assets with their IDs, names, asset type, owner, inventory number, and other metadata. Use this to browse all assets or filter by search query. Compact by default — additionalProperties is folded from a [{name,type,value}] triplet array to {name:value}, and columns constant across the page (commonly url, energyOff, energyOn, assetReferenceList) are reported once under meta.constant. Use detail:true for the raw record, fields:[..] to pick columns, countOnly:true for the count alone.",
        inputSchema: {
          type: "object",
          properties: listAssetsProps,
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
        description: "List all asset types defined in baramundi Management Suite. Returns a paged list of asset types with their GUIDs, names, and optional summary data. Asset types define the structure and properties of assets. Compact by default — columns holding one value across the whole page are reported once under meta.constant instead of on every row. Use detail:true for the raw record, fields:[..] to pick columns, countOnly:true for the count alone.",
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
            ...paginationProps,
            ...detailProperty,
            ...fieldsProperty
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

    );

    // Decision 2 — these two used to be inside `if (is26R1)`. The product is
    // 26R1-only, so they are unconditional; the "[26R1]" prefix and the
    // "Available in bConnect 26R1 and later." sentence went with the switch,
    // because both are now true of every tool this suite advertises.
    TOOLS.push(
      {
        name: "list_assets_by_org_unit",
        description: "List all assets assigned to endpoints within a specific organizational unit. Returns a paged list of assets for the given OU GUID.",
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
        description: "List all assets assigned to a specific Active Directory object (user or group). Returns a paged list of assets owned by the given AD object GUID.",
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

  // ── Response shaping for list_assets (OPT-3) ───────────────────────────────
  //
  // Measured live, 20-row page: `additionalProperties` is a {name,type,value}
  // triplet array with the identical shape on every row — the same structural
  // tax the WMI Properties[] fold already removes elsewhere (inventory-scans-
  // v11.ts), and `type` was 'String' on all 60 entries observed. Folding to
  // {name:value} plus reporting the page-constant columns (url, energyOff,
  // energyOn, assetReferenceList on a default-configuration estate) in
  // meta.constant measured 16,464 B -> 13,104 B, -20.4%.
  //
  // `type` is dropped only where it is 'String' on every entry actually seen;
  // a custom asset property typed Number or Boolean is a real possibility this
  // schema allows for, so its type survives on the row instead of being
  // silently discarded, and a page carrying one is flagged in meta.warning
  // rather than assumed lossless.
  interface AssetAdditionalProperty { name?: string; type?: string; value?: unknown }

  function foldAdditionalProperties(row: Row): { row: Row; nonStringType: boolean } {
    const raw = row.additionalProperties;
    if (!Array.isArray(raw)) {
      return { row, nonStringType: false };
    }
    let nonStringType = false;
    const folded: Record<string, unknown> = {};
    for (const prop of raw as AssetAdditionalProperty[]) {
      if (typeof prop?.name !== "string") {
        continue;
      }
      if (prop.type !== undefined && prop.type !== "String") {
        nonStringType = true;
      }
      folded[prop.name] = prop.value ?? null;
    }
    return { row: { ...row, additionalProperties: folded }, nonStringType };
  }

  const shapeAssets = createListShaper({
    dropConstantColumns: true,
    fullModeHint: "Pass detail:true for the full record, or fields:[...] to choose columns.",
  });

  /** Fold every row's additionalProperties[] unless the caller asked for the untouched record. */
  function forAssetShaping(payload: ListEnvelope, full: boolean): { payload: ListEnvelope; nonStringType: boolean } {
    if (full || !Array.isArray(payload.data)) {
      return { payload, nonStringType: false };
    }
    let nonStringType = false;
    const data = (payload.data as Row[]).map((row) => {
      const folded = foldAdditionalProperties(row);
      nonStringType = nonStringType || folded.nonStringType;
      return folded.row;
    });
    return { payload: { ...payload, data }, nonStringType };
  }

  const catalogue = defineToolCatalogue({
    tools: TOOLS,
    write: [
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
    ],
  });

  // ── ListToolsRequestSchema handler ────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: catalogue.listTools() };
  });

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

  // ── Client lifetime (upstream finding R3) ─────────────────────────────────
  // Built lazily on first tool call, but held HERE, in createServer() scope,
  // not inside the tool-call handler where this used to live. A client
  // constructed per call rebuilt everything stateful it owned on every call,
  // which is why rate limiting never limited (B8) and why the response cache
  // could not have worked even once wired up (B7). The provider is per
  // session and re-keys itself if the resolved credentials change, so a
  // longer-lived client cannot leak across differently-credentialed callers.
  // See packages/mcp-core/src/client-provider.ts.
  const getBconnect = createClientProvider<BConnectClient>({
    // Enables the optional per-server credential convention
    // (BCONNECT_API_KEY__ASSETS); with no such variable set this
    // changes nothing. See mcp-core/server-scoped-credentials.ts.
    serverName: "bconnect-assets-mcp",
    factory: (config) => new BConnectClient(config),
    credentials,
    defaultBaseUrl: "https://bms-server/bconnect",
    onMissingCredentials: () => {
      throw new BareMcpError(
        ErrorCode.InternalError,
        "Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required"
      );
    },
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // 1. Validate arguments first — pure, no side effects, fails fast on bad input.
    validateToolArguments(name, args);

    // D6 — refuse an argument key this tool's schema does not declare.
    // validateParameters() iterates over RULES, so a key with no rule was never
    // examined by anything; bConnect then answers 200 and silently ignores an
    // unrecognised query key. Measured live, one transposed character in a filter
    // name returned 37,571 rows instead of 1, labelled as a filtered result.
    catalogue.assertKnownParameters(name, args);
    // SEC-0 — every id-shaped argument must be a single, traversal-free path
    // segment. This lived in 3 of 13 servers; it is on the catalogue now so a
    // server cannot be built without it.
    catalogue.assertSafePathParameters(name, args);

    // 2. Write-operation gate (REQ-SRV-012). Hiding a write tool from
    //    tools/list is a token optimisation; this is the security control.
    const denied = catalogue.gateWriteTool(name);
    if (denied) {
      return denied;
    }


    try {
      const bconnect = getBconnect();
      const assets = bconnect.assets;

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        // ── Assets ─────────────────────────────────────────────────────────
        case "list_assets": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => assets.getAssets(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const raw = await assets.getAssets(apiParams(args) as never);
          const full = args?.detail === true;
          const { payload, nonStringType } = forAssetShaping(raw as unknown as ListEnvelope, full);
          const shaped = shapeAssets(payload, {
            full,
            fields: args?.fields as string[] | undefined,
            args,
          }) as ListEnvelope & { meta?: Record<string, unknown> };
          if (nonStringType && shaped.meta) {
            shaped.meta.warning =
              "Some additionalProperties entries on this page had a non-'String' type, which the " +
              "compact projection does not preserve per-entry. Pass detail:true for the exact record.";
          }
          return toolTextResult(serializeToolResult(shaped));
        }

        case "create_asset": {
          const result = await assets.createAsset(args as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_asset": {
          const result = await assets.getAsset(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "update_asset": {
          const result = await assets.updateAsset(args!.id as string, args!.operations as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "delete_asset": {
          await assets.deleteAsset(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult({ success: true, id: args!.id }) }] };
        }

        case "list_assets_in_asset_stock": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => assets.getAssetsAssetStock(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await assets.getAssetsAssetStock(apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_assets_by_logical_group": {
          if (isCountOnlyRequest(args)) {
            const { logicalGroupId: scopeId, ...params } = args as Record<string, unknown>;
            const count = await fetchCount((p) => assets.getAssetsByLogicalGroup(scopeId as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await assets.getAssetsByLogicalGroup(args!.logicalGroupId as string, apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_assets_by_windows_endpoint": {
          if (isCountOnlyRequest(args)) {
            const { endpointId: scopeId, ...params } = args as Record<string, unknown>;
            const count = await fetchCount((p) => assets.getAssetsByWindowsEndpoint(scopeId as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await assets.getAssetsByWindowsEndpoint(args!.endpointId as string, apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_assets_by_org_unit": {
          if (isCountOnlyRequest(args)) {
            const { orgUnitId: scopeId, ...params } = args as Record<string, unknown>;
            const count = await fetchCount((p) => assets.getAssetsByOrgUnit(scopeId as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await assets.getAssetsByOrgUnit(args!.orgUnitId as string, apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_assets_by_ad_object": {
          if (isCountOnlyRequest(args)) {
            const { adObjectId: scopeId, ...params } = args as Record<string, unknown>;
            const count = await fetchCount((p) => assets.getAssetsByADObject(scopeId as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await assets.getAssetsByADObject(args!.adObjectId as string, apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        // ── Asset Stock Folders ────────────────────────────────────────────
        case "list_asset_stock_folders": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => assets.getAssetStockFolders(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await assets.getAssetStockFolders(apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "create_asset_stock_folder": {
          const result = await assets.createAssetStockFolder(args as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_asset_stock_folder": {
          const result = await assets.getAssetStockFolder(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "update_asset_stock_folder": {
          const result = await assets.updateAssetStockFolder(args!.id as string, args!.operations as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "delete_asset_stock_folder": {
          await assets.deleteAssetStockFolder(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult({ success: true, id: args!.id }) }] };
        }

        case "list_asset_stock_subfolders": {
          if (isCountOnlyRequest(args)) {
            const { folderId: scopeId, ...params } = args as Record<string, unknown>;
            const count = await fetchCount((p) => assets.getAssetStockFoldersByParent(scopeId as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await assets.getAssetStockFoldersByParent(args!.folderId as string, apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        // ── Asset Type Folders ─────────────────────────────────────────────
        case "list_asset_type_folders": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => assets.getAssetTypeFolders(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await assets.getAssetTypeFolders(apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "create_asset_type_folder": {
          const result = await assets.createAssetTypeFolder(args as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_asset_type_folder": {
          const result = await assets.getAssetTypeFolder(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "update_asset_type_folder": {
          const result = await assets.updateAssetTypeFolder(args!.id as string, args!.operations as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "delete_asset_type_folder": {
          await assets.deleteAssetTypeFolder(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult({ success: true, id: args!.id }) }] };
        }

        case "list_asset_type_subfolders": {
          if (isCountOnlyRequest(args)) {
            const { folderId: scopeId, ...params } = args as Record<string, unknown>;
            const count = await fetchCount((p) => assets.getAssetTypeFoldersByParent(scopeId as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await assets.getAssetTypeFoldersByParent(args!.folderId as string, apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        // ── Asset Types ────────────────────────────────────────────────────
        case "list_asset_types": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => assets.getAssetTypes(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await assets.getAssetTypes(apiParams(args) as never);
          // Strictly lossless: `dropConstantColumns` moves a page-constant value
          // into meta.constant once instead of repeating it on every row, so no
          // value leaves the response. Measured live on a 15-row page,
          // 6,564 -> 4,812 B (-26.7%): seven columns are constant, six of them
          // null (comments, contact, inventoryNumber, additionalProperties,
          // summary, encodedIcon) plus url="http://".
          return toolTextResult(serializeToolResult(
            shapeAssets(result as unknown as ListEnvelope, {
              full: args?.detail === true,
              fields: args?.fields as string[] | undefined,
              args,
            })
          ));
        }

        case "create_asset_type": {
          const result = await assets.createAssetType(args as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_asset_type": {
          const result = await assets.getAssetType(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "delete_asset_type": {
          await assets.deleteAssetType(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult({ success: true, id: args!.id }) }] };
        }

        default:
          throw new BareMcpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error: unknown) {
      // INT-53 — one error channel. See packages/mcp-core/src/tool-error.ts.
      return handleToolError(error);
    }
  });

  // Difference 3 — hand the memoised provider back so runServer's startup
  // connectivity check probes the very client tool dispatch will use.
  return { server, getClient: getBconnect };
}

// ─── Entry point (OPT-32) ────────────────────────────────────────────────────
//
// This server used to hand-write ~85 lines of bootstrap. Every line of it is
// now in `runServer()`, which resolves the six ways the thirteen copies had
// drifted. Two consequences are visible from here and are deliberate:
//
//   - BCONNECT_BASE_URL has NO default any more. The old
//     `|| "https://bms.example.com:443/bconnect"` fallback sent real
//     credentials to a host the vendor does not control whenever the variable
//     was unset. Absent base URL is now exit 1, before any client is built.
//   - The startup connectivity check probes `getClient()` above — the client
//     tool dispatch uses — not a throwaway built from a second reading of the
//     environment. That is why `createServer` returns it.
//
// `express` is injected because mcp-core does not depend on it: this package
// pins ^4.21.0 while the workspace root hoists 5.x.
if (shouldAutoStart()) {
  void runServer({
    name: "bconnect-assets-mcp",
    createServer,
    http: { express },
  }).catch((error) => {
    console.error(`Fatal error: ${describeConnectionFailure(error)}`);
    process.exit(1);
  });
}
