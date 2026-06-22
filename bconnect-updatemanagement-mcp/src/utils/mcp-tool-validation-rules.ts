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
 * Pagination rules used by list tools.
 */
const paginationRules = (): ValidationRule[] => [
  CommonRules.page(),
  CommonRules.pageSize(),
  CommonRules.searchQuery(),
  CommonRules.orderBy()
];

export const UpdateManagementRules = {
  // GET /v2.0/UpdateManagement/WindowsEndpoints
  listUpdateManagementEndpoints: (): ValidationRule[] => paginationRules(),

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
  ]
};
