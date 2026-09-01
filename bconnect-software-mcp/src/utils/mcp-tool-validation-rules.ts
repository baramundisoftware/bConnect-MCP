/**
 * MCP Tool Validation Rules — bconnect-software-mcp
 *
 * Centralised validation rules for the 19 tools (4 base + 15 26R1-only)
 * exposed by this server. Replaces the inline `typeof` checks that
 * previously lived in `index.ts`.
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

/**
 * The response-shaping flags (TOK-24 `detail`/`fields`, TOK-25 `countOnly`).
 *
 * They are this server's parameters, not bConnect's — the handler strips them
 * before the request goes upstream — so they are type-checked here for the same
 * reason every other parameter is: bConnect answers HTTP 200 and silently
 * ignores what it does not understand, and a `detail: "true"` string that fell
 * through would quietly return the compact projection while the caller believed
 * it had asked for the full record.
 */
const projectionRules = (): ValidationRule[] => [
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
  },
  {
    name: 'countOnly',
    required: false,
    type: 'boolean',
    message: 'countOnly must be a boolean'
  }
];

/** `countOnly` alone, for the list tools that take no compact projection. */
const countOnlyRule = (): ValidationRule[] => [
  {
    name: 'countOnly',
    required: false,
    type: 'boolean',
    message: 'countOnly must be a boolean'
  }
];

const folderListRules = (): ValidationRule[] => [
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

const patchOperationsRule: ValidationRule = {
  name: 'patchOperations',
  required: true,
  type: 'array',
  format: 'json-patch',
  message: 'patchOperations must be a valid JSON Patch document'
};

export const SoftwareRules = {
  // ── Installed Software (25R2 + 26R1) ──────────────────────────────
  listInstalledWindowsSoftware: (): ValidationRule[] => [
    ...paginationRules(),
    ...projectionRules()
  ],

  listInstalledSoftwareByEndpoint: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    ...paginationRules(),
    ...projectionRules()
  ],

  listInstalledSoftwareByLogicalGroup: (): ValidationRule[] => [
    CommonRules.guid('logicalGroupId'),
    {
      name: 'includeSubfolders',
      required: false,
      type: 'boolean',
      message: 'includeSubfolders must be a boolean'
    },
    ...paginationRules(),
    ...projectionRules()
  ],

  listInstalledSoftwareByDynamicGroup: (): ValidationRule[] => [
    CommonRules.guid('universalDynamicGroupId'),
    ...paginationRules(),
    ...projectionRules()
  ],

  // ── Software Bundles (26R1) ───────────────────────────────────────
  listSoftwareBundles: (): ValidationRule[] => [
    ...paginationRules(),
    ...countOnlyRule()
  ],

  getSoftwareBundle: (): ValidationRule[] => [
    CommonRules.guid('bundleId')
  ],

  createSoftwareBundle: (): ValidationRule[] => [
    {
      name: 'name',
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 255,
      message: 'name is required (string, 1-255 chars)'
    },
    // SoftwareBundleForCreation names the placement field `parentId`; the
    // rule (and the tool) said `folderId` until 2026-08-11, a key the body
    // rejects (TOOL-REVIEW-MATRIX.md, software F1).
    CommonRules.guidOptional('parentId')
  ],

  deleteSoftwareBundle: (): ValidationRule[] => [
    CommonRules.guid('bundleId')
  ],

  // ── Bundle Applications (26R1) ────────────────────────────────────
  listBundleApplications: (): ValidationRule[] => [
    ...paginationRules(),
    ...countOnlyRule()
  ],

  listBundleApplicationsByBundle: (): ValidationRule[] => [
    CommonRules.guid('bundleId'),
    ...paginationRules(),
    ...countOnlyRule()
  ],

  // AddApplicationRequest accepts exactly applicationId — an `order` rule sat
  // here until 2026-08-11 for a parameter the body rejects; bMS assigns the
  // order index itself (TOOL-REVIEW-MATRIX.md, software F2).
  addApplicationToBundle: (): ValidationRule[] => [
    CommonRules.guid('bundleId'),
    CommonRules.guid('applicationId')
  ],

  deleteBundleApplication: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  replaceApplicationInBundle: (): ValidationRule[] => [
    CommonRules.guid('bundleId'),
    CommonRules.guid('id'),
    patchOperationsRule
  ],

  // ── Bundle Folders (26R1) ─────────────────────────────────────────
  listBundleFolders: (): ValidationRule[] => [
    ...folderListRules(),
    ...countOnlyRule()
  ],

  getBundleFolder: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  listBundleFoldersByFolder: (): ValidationRule[] => [
    CommonRules.guid('folderId'),
    {
      name: 'includeSubfolders',
      required: false,
      type: 'boolean',
      message: 'includeSubfolders must be a boolean'
    },
    ...folderListRules(),
    ...countOnlyRule()
  ],

  createBundleFolder: (): ValidationRule[] => [
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
  ],

  deleteBundleFolder: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  updateBundleFolder: (): ValidationRule[] => [
    CommonRules.guid('id'),
    patchOperationsRule
  ]
};
