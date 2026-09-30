/**
 * MCP Tool Validation Rules — bconnect-universaldynamicgroups-mcp
 *
 * Centralised validation rules for the 6 tools exposed by this server (26R1).
 * Replaces the inline `typeof` checks that previously lived in `index.ts`.
 *
 * See parameter-validator.ts for the ValidationRule type and validateOrThrow.
 */

import { ValidationRule, CommonRules } from "@bconnect/mcp-core";

/**
 * Pagination + Name filter rules used by list tools across this domain.
 */
const listRules = (): ValidationRule[] => [
  CommonRules.page(),
  CommonRules.pageSize(),
  CommonRules.searchQuery(),
  CommonRules.orderBy(),
  {
    name: 'Name',
    required: false,
    type: 'string',
    minLength: 1,
    maxLength: 255,
    message: 'Name must be between 1 and 255 characters'
  }
];

export const UdgRules = {
  // GET /v2.0/UniversalDynamicGroups
  listUniversalDynamicGroups: (): ValidationRule[] => listRules(),

  // GET /v2.0/UniversalDynamicGroups/{id}
  getUniversalDynamicGroup: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /v2.0/Folders/{folderId}/UniversalDynamicGroups
  listUniversalDynamicGroupsByFolder: (): ValidationRule[] => [
    CommonRules.guid('folderId'),
    ...listRules()
  ],

  // GET /v2.0/UDG/Folders
  listUdgFolders: (): ValidationRule[] => listRules(),

  // GET /v2.0/UDG/Folders/{id}
  getUdgFolder: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /v2.0/UDG/Folders/{folderId}/Folders
  listUdgFoldersByFolder: (): ValidationRule[] => [
    CommonRules.guid('folderId'),
    ...listRules()
  ]
};
