/**
 * MCP Tool Validation Rules — bconnect-updatemanagement-mcp
 *
 * Centralised validation rules for the 3 tools exposed by this server.
 * Replaces the inline `typeof` checks that previously lived in `index.ts`.
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

/**
 * Pagination rules used by list tools.
 */
const paginationRules = (): ValidationRule[] => [
  CommonRules.page(),
  CommonRules.pageSize(),
  CommonRules.searchQuery(),
  CommonRules.orderBy(),
  countOnlyRule()
];

export const UpdateManagementRules = {
  // GET /v2.0/UpdateManagement/WindowsEndpoints
  // The shaping flags must be declared here as well as in the schema:
  // `assertKnownParameters` builds its allowlist from the declared rules and
  // refuses anything else with -32602 BEFORE dispatch, so without these the
  // projection's own "Pass detail:true for the full API record" hint would be
  // false the first time a caller followed it.
  listUpdateManagementEndpoints: (): ValidationRule[] => [
    ...paginationRules(),
    { name: 'detail', required: false, type: 'boolean' },
    { name: 'fields', required: false, type: 'array' },
  ],

  // GET /v2.0/UpdateManagement/WindowsEndpoints/{id}
  getUpdateManagementEndpoint: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // PATCH /v2.0/UpdateManagement/WindowsEndpoints/{id}
  updateUpdateManagementEndpoint: (): ValidationRule[] => [
    CommonRules.guid('id'),
    {
      name: 'patchOperations',
      required: true,
      type: 'array',
      format: 'json-patch',
      message: 'patchOperations must be a valid JSON Patch document (e.g. [{op:"replace",path:"/updateProfileId",value:"<guid>"}])'
    }
  ],

  // GET /bConnect/v1.1/MicrosoftUpdateProfiles — no parameters.
  listMicrosoftUpdateProfiles: (): ValidationRule[] => [],

  // GET /bConnect/v1.1/MicrosoftUpdateInventories?EndpointId={guid}
  // endpointId is REQUIRED and validated here, before the v1.1 gate and before
  // any network call: the unfiltered controller answer is ~164 KB, so a missing
  // filter must never reach the wire. v1.1 also 400s on unknown parameter
  // names, so nothing beyond the declared parameters is forwarded.
  getEndpointMicrosoftUpdateInventory: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    {
      name: 'detail',
      required: false,
      type: 'boolean',
      message: 'detail must be a boolean'
    }
  ]
};
