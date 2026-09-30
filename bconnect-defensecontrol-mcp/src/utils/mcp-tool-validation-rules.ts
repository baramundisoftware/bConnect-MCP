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

  patchLocalAdminUserCredentials: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    patchOperationsRule
  ],

  triggerUpdateOnClient: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    {
      name: 'timeout',
      required: false,
      type: 'number',
      min: 0,
      max: 3600,
      message: 'timeout must be a non-negative integer (seconds, max 3600)'
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
