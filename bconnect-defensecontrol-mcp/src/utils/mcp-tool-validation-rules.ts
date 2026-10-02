/**
 * MCP Tool Validation Rules — bconnect-defensecontrol-mcp
 *
 * Centralised validation rules for the 13 tools (11 base + 2 26R1-only)
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

const patchOperationsRule: ValidationRule = {
  name: 'patchOperations',
  required: true,
  type: 'array',
  format: 'json-patch',
  message: 'patchOperations must be a valid JSON Patch document'
};

export const DefenseControlRules = {
  // ── BitLocker ──────────────────────────────────────────────────────
  listBitlockerWindowsEndpoints: (): ValidationRule[] => paginationRules(),

  getBitlockerWindowsEndpoint: (): ValidationRule[] => [
    CommonRules.guid('endpointId')
  ],

  // 26R1 only
  getBitlockerSecrets: (): ValidationRule[] => [
    CommonRules.guid('endpointId')
  ],

  // 26R1 only
  updateBitlockerPin: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    patchOperationsRule
  ],

  // ── Local Admin ────────────────────────────────────────────────────
  getLocalAdminAccounts: (): ValidationRule[] => [
    CommonRules.guid('endpointId')
  ],

  // Only the requested expiration date can be patched (#177).
  patchLocalAdminUserCredentials: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    {
      name: 'requestedExpirationDate',
      required: true,
      type: 'string',
      pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
      message: "requestedExpirationDate must be an ISO 8601 date-time with time zone, e.g. '2026-01-01T00:00:00Z'"
    }
  ],

  // The spec allows 0–60 seconds (#177).
  refreshLocalAdminAccountExpiry: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    {
      name: 'timeout',
      required: false,
      type: 'number',
      integer: true,
      min: 0,
      max: 60
    }
  ],

  // ── Microsoft Defender Threats ─────────────────────────────────────
  listDefenderThreats: (): ValidationRule[] => paginationRules(),

  getDefenderThreat: (): ValidationRule[] => [
    CommonRules.guid('threatId')
  ],

  listDefenderThreatsByEndpoint: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    ...paginationRules()
  ],

  listDefenderThreatsByLogicalGroup: (): ValidationRule[] => [
    CommonRules.guid('logicalGroupId'),
    ...paginationRules()
  ],

  // ── Microsoft Defender States ──────────────────────────────────────
  listDefenderWindowsEndpoints: (): ValidationRule[] => paginationRules(),

  getDefenderWindowsEndpoint: (): ValidationRule[] => [
    CommonRules.guid('endpointId')
  ]
};
