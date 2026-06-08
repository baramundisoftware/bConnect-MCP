/**
 * MCP Tool Validation Rules — bconnect-software-mcp
 *
 * Centralised validation rules for the 19 tools (4 base + 15 26R1-only)
 * exposed by this server. Replaces the inline `typeof` checks that
 * previously lived in `index.ts`.
 *
 * See parameter-validator.ts for the ValidationRule type and validateOrThrow.
 */

import { ValidationRule, CommonRules } from './parameter-validator.js';

const paginationRules = (): ValidationRule[] => [
  CommonRules.page(),
  CommonRules.pageSize(),
  CommonRules.searchQuery(),
  CommonRules.orderBy()
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
  listInstalledWindowsSoftware: (): ValidationRule[] => paginationRules(),

  listInstalledSoftwareByEndpoint: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    ...paginationRules()
  ],

  listInstalledSoftwareByLogicalGroup: (): ValidationRule[] => [
    CommonRules.guid('logicalGroupId'),
    ...paginationRules()
  ],

  listInstalledSoftwareByDynamicGroup: (): ValidationRule[] => [
    CommonRules.guid('universalDynamicGroupId'),
    ...paginationRules()
  ],

  // ── Software Bundles (26R1) ───────────────────────────────────────
  listSoftwareBundles: (): ValidationRule[] => paginationRules(),

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
    CommonRules.guidOptional('folderId')
  ],

  deleteSoftwareBundle: (): ValidationRule[] => [
    CommonRules.guid('bundleId')
  ],

  // ── Bundle Applications (26R1) ────────────────────────────────────
  listBundleApplications: (): ValidationRule[] => paginationRules(),

  listBundleApplicationsByBundle: (): ValidationRule[] => [
    CommonRules.guid('bundleId'),
    ...paginationRules()
  ],

  addApplicationToBundle: (): ValidationRule[] => [
    CommonRules.guid('bundleId'),
    CommonRules.guid('applicationId'),
    {
      name: 'order',
      required: false,
      type: 'number',
      min: 0,
      message: 'order must be a non-negative integer'
    }
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
  listBundleFolders: (): ValidationRule[] => folderListRules(),

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
    ...folderListRules()
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
