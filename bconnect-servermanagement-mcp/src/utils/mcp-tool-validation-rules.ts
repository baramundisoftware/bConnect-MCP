/**
 * MCP Tool Validation Rules — bconnect-servermanagement-mcp
 *
 * Centralised validation rules for the 30 tools (25 base + 5 26R1-only)
 * exposed by this server. Replaces the inline `typeof` checks that
 * previously lived in `index.ts`.
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

const patchOperationsRule: ValidationRule = {
  name: 'patchOperations',
  required: true,
  type: 'array',
  format: 'json-patch',
  message: 'patchOperations must be a valid JSON Patch document'
};

// Many tools take no arguments (server info, microservice list, infra lists,
// restart/cancel-restart, all 26R1 MSW/api-key tools). Use empty rules so the
// validator runs uniformly for every tool but accepts any (or no) args.
const noArgs = (): ValidationRule[] => [];

export const ServerManagementRules = {
  // ── Server Information ────────────────────────────────────────────
  getManagementServer: (): ValidationRule[] => noArgs(),
  getGateway: (): ValidationRule[] => noArgs(),
  getDipStatus: (): ValidationRule[] => noArgs(),
  getVpnAppliance: (): ValidationRule[] => noArgs(),

  // ── Microservices ─────────────────────────────────────────────────
  listMicroservices: (): ValidationRule[] => noArgs(),
  getMicroservice: (): ValidationRule[] => [CommonRules.guid('id')],
  startMicroservice: (): ValidationRule[] => [CommonRules.guid('id')],
  stopMicroservice: (): ValidationRule[] => [CommonRules.guid('id')],
  restartMicroservice: (): ValidationRule[] => [CommonRules.guid('id')],

  // ── Infrastructure ────────────────────────────────────────────────
  listCloudConnectors: (): ValidationRule[] => noArgs(),
  listPxeRelays: (): ValidationRule[] => noArgs(),

  // ── Security Groups ───────────────────────────────────────────────
  listSecurityGroups: (): ValidationRule[] => paginationRules(),
  getSecurityGroup: (): ValidationRule[] => [CommonRules.guid('id')],
  createSecurityGroup: (): ValidationRule[] => [
    {
      name: 'groupData',
      required: true,
      type: 'object',
      message: 'groupData must be an object containing at least Name'
    }
  ],
  updateSecurityGroup: (): ValidationRule[] => [CommonRules.guid('id'), patchOperationsRule],
  deleteSecurityGroup: (): ValidationRule[] => [CommonRules.guid('id')],

  // ── Security Profiles ─────────────────────────────────────────────
  listSecurityProfiles: (): ValidationRule[] => paginationRules(),
  getSecurityProfile: (): ValidationRule[] => [CommonRules.guid('id')],
  createSecurityProfile: (): ValidationRule[] => [
    {
      name: 'profileData',
      required: true,
      type: 'object',
      message: 'profileData must be an object containing at least Name'
    }
  ],
  updateSecurityProfile: (): ValidationRule[] => [CommonRules.guid('id'), patchOperationsRule],
  deleteSecurityProfile: (): ValidationRule[] => [CommonRules.guid('id')],

  // ── Object Permissions ────────────────────────────────────────────
  getAccessRights: (): ValidationRule[] => [CommonRules.guid('objectId')],
  updateObjectPermission: (): ValidationRule[] => [CommonRules.guid('id'), patchOperationsRule],

  // ── Server Restart ────────────────────────────────────────────────
  restartManagementServer: (): ValidationRule[] => noArgs(),
  cancelScheduledRestart: (): ValidationRule[] => noArgs(),

  // ── 26R1-only ─────────────────────────────────────────────────────
  listApiKeys: (): ValidationRule[] => noArgs(),
  simulateMswCleanup: (): ValidationRule[] => noArgs(),
  mswCleanup: (): ValidationRule[] => noArgs(),
  listDownloadJobs: (): ValidationRule[] => noArgs(),
  getDownloadJob: (): ValidationRule[] => [CommonRules.guid('id')]
};
