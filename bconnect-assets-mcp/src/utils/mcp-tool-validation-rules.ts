/**
 * MCP Tool Validation Rules — bconnect-assets-mcp
 *
 * Centralised validation rules for the 26 tools (24 base + 2 26R1-only)
 * exposed by this server. Replaces the inline `typeof` checks that
 * previously lived in `index.ts`.
 *
 * Note: this server uses `operations` as the JSON Patch field name
 * (not `patchOperations` like other servers). Hence a local
 * operationsRule rather than reusing CommonRules.jsonPatch.
 *
 * See parameter-validator.ts for the ValidationRule type and validateOrThrow.
 */

import { ValidationRule, CommonRules } from "@bconnect/mcp-core";

const paginationRules = (): ValidationRule[] => [
  CommonRules.page(),
  CommonRules.pageSize(),
  CommonRules.searchQuery(),
  CommonRules.orderBy()
];

const assetFilterRules = (): ValidationRule[] => [
  ...paginationRules(),
  CommonRules.displayName(false)
];

const folderFilterRules = (): ValidationRule[] => [
  ...paginationRules(),
  {
    name: 'Name',
    required: false,
    type: 'string',
    minLength: 1,
    maxLength: 255,
    message: 'Name must be between 1 and 255 characters'
  }
];

const operationsRule: ValidationRule = {
  name: 'operations',
  required: true,
  type: 'array',
  format: 'json-patch',
  message: 'operations must be a valid JSON Patch document (RFC 6902)'
};

const folderCreateRules = (): ValidationRule[] => [
  {
    name: 'name',
    required: true,
    type: 'string',
    minLength: 1,
    maxLength: 255,
    message: 'name is required (string, 1-255 chars)'
  },
  CommonRules.guidOptional('parentId'),
  CommonRules.comment()
];

const subfolderListRules = (): ValidationRule[] => [
  CommonRules.guid('folderId'),
  {
    name: 'includeSubfolders',
    required: false,
    type: 'boolean',
    message: 'includeSubfolders must be a boolean'
  },
  ...folderFilterRules()
];

export const AssetsRules = {
  // ── Assets ─────────────────────────────────────────────────────────
  listAssets: (): ValidationRule[] => assetFilterRules(),

  createAsset: (): ValidationRule[] => [
    CommonRules.guid('assetTypeId'),
    CommonRules.guid('ownerId'),
    {
      name: 'ownerType',
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 64,
      message: 'ownerType is required (e.g. "WindowsEndpoint", "ADObject", "AssetStock")'
    },
    {
      name: 'name',
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 255,
      message: 'name is required (string, 1-255 chars)'
    }
  ],

  getAsset: (): ValidationRule[] => [CommonRules.guid('id')],

  updateAsset: (): ValidationRule[] => [
    CommonRules.guid('id'),
    operationsRule
  ],

  deleteAsset: (): ValidationRule[] => [CommonRules.guid('id')],

  listAssetsInAssetStock: (): ValidationRule[] => assetFilterRules(),

  listAssetsByLogicalGroup: (): ValidationRule[] => [
    CommonRules.guid('logicalGroupId'),
    ...assetFilterRules()
  ],

  listAssetsByWindowsEndpoint: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    ...assetFilterRules()
  ],

  // 26R1 only
  listAssetsByOrgUnit: (): ValidationRule[] => [
    CommonRules.guid('orgUnitId'),
    ...assetFilterRules()
  ],

  // 26R1 only
  listAssetsByAdObject: (): ValidationRule[] => [
    CommonRules.guid('adObjectId'),
    ...assetFilterRules()
  ],

  // ── Asset Stock Folders ────────────────────────────────────────────
  listAssetStockFolders: (): ValidationRule[] => folderFilterRules(),
  createAssetStockFolder: (): ValidationRule[] => folderCreateRules(),
  getAssetStockFolder: (): ValidationRule[] => [CommonRules.guid('id')],
  updateAssetStockFolder: (): ValidationRule[] => [CommonRules.guid('id'), operationsRule],
  deleteAssetStockFolder: (): ValidationRule[] => [CommonRules.guid('id')],
  listAssetStockSubfolders: (): ValidationRule[] => subfolderListRules(),

  // ── Asset Type Folders ─────────────────────────────────────────────
  listAssetTypeFolders: (): ValidationRule[] => folderFilterRules(),
  createAssetTypeFolder: (): ValidationRule[] => folderCreateRules(),
  getAssetTypeFolder: (): ValidationRule[] => [CommonRules.guid('id')],
  updateAssetTypeFolder: (): ValidationRule[] => [CommonRules.guid('id'), operationsRule],
  deleteAssetTypeFolder: (): ValidationRule[] => [CommonRules.guid('id')],
  listAssetTypeSubfolders: (): ValidationRule[] => subfolderListRules(),

  // ── Asset Types ────────────────────────────────────────────────────
  listAssetTypes: (): ValidationRule[] => [
    ...paginationRules(),
    {
      name: 'ShowSummary',
      required: false,
      type: 'boolean',
      message: 'ShowSummary must be a boolean'
    },
    {
      name: 'Icon',
      required: false,
      type: 'boolean',
      message: 'Icon must be a boolean'
    },
    {
      name: 'AdditionalProperties',
      required: false,
      type: 'boolean',
      message: 'AdditionalProperties must be a boolean'
    }
  ],

  createAssetType: (): ValidationRule[] => [
    CommonRules.guid('ownerId'),
    {
      name: 'name',
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 255,
      message: 'name is required (string, 1-255 chars)'
    }
  ],

  getAssetType: (): ValidationRule[] => [CommonRules.guid('id')],
  deleteAssetType: (): ValidationRule[] => [CommonRules.guid('id')]
};
