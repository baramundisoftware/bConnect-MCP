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

/**
 * The response-shaping flags (`detail`/`fields`), for the two list tools this
 * server shapes (`list_bitlocker_windows_endpoints`,
 * `list_defender_windows_endpoints` — Phase 4 token-consumption §3). Typed
 * here for the same reason `countOnly` is: these are this server's own
 * parameters, stripped before the request goes upstream, so a `detail:
 * "true"` string that fell through would silently return the compact
 * projection while the caller believed it had asked for the full record.
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

const patchOperationsRule: ValidationRule = {
  name: 'patchOperations',
  required: true,
  type: 'array',
  format: 'json-patch',
  message: 'patchOperations must be a valid JSON Patch document'
};

export const DefenseControlRules = {
  // ── BitLocker ──────────────────────────────────────────────────────
  listBitlockerWindowsEndpoints: (): ValidationRule[] => [...paginationRules(), ...shapingRules()],

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

  // Spec (bConnect_Defensecontrol.json, TriggerUpdateOnClient): "Must be
  // between 0 and 60 seconds." The rule used to allow up to 3600 — a caller
  // relying on that ceiling would get a live HTTP 400 for any value above 60
  // that this validator had already accepted as valid.
  triggerUpdateOnClient: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    {
      name: 'timeout',
      required: false,
      type: 'number',
      min: 0,
      max: 60,
      message: 'timeout must be a non-negative integer, 0-60 seconds (bConnect API limit)'
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
  listDefenderWindowsEndpoints: (): ValidationRule[] => [...paginationRules(), ...shapingRules()],

  getDefenderWindowsEndpoint: (): ValidationRule[] => [
    CommonRules.guid('endpointId')
  ]
};
