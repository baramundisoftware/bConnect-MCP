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

/**
 * TOK-25 — `countOnly` is a boolean on every list tool in the suite. Declared
 * here so a caller who passes `countOnly: "true"` is rejected with a typed
 * -32602 rather than silently getting a full page back.
 */
const countOnlyRule = (): ValidationRule => ({
  name: 'countOnly',
  required: false,
  type: 'boolean',
  message: 'countOnly must be a boolean'
});

const paginationRules = (): ValidationRule[] => [
  CommonRules.page(),
  CommonRules.pageSize(),
  CommonRules.searchQuery(),
  CommonRules.orderBy(),
  countOnlyRule()
];

const assetFilterRules = (): ValidationRule[] => [
  ...paginationRules(),
  CommonRules.displayName(false)
];

/**
 * OPT-3 — `detail`/`fields`, for `list_assets` only (the one tool this server
 * shapes). Typed here for the same reason `countOnly` is: a `detail: "true"`
 * string that fell through would silently return the compact projection
 * while the caller believed it had asked for the full record.
 */
const shapingRules = (): ValidationRule[] => [
  {
    name: 'detail',
    required: false,
    type: 'boolean',
    message: 'detail must be a boolean'
  },
  {
    name: 'fields',
    required: false,
    type: 'array',
    message: 'fields must be an array of field names'
  }
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
  listAssets: (): ValidationRule[] => [...assetFilterRules(), ...shapingRules()],

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
    },
    // The tool declares detail/fields/countOnly, so the rules must accept them:
    // the unknown-parameter validator refuses anything a tool does not declare
    // BEFORE dispatch, which would make the escape hatch unreachable.
    ...shapingRules()
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
