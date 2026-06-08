/**
 * MCP Tool Validation Rules — bconnect-operatingsystems-mcp
 *
 * Centralised validation rules for the 9 tools exposed by this server.
 * Replaces the inline `typeof` checks that previously lived in `index.ts`.
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

const patchOperationsRule: ValidationRule = {
  name: 'patchOperations',
  required: true,
  type: 'array',
  format: 'json-patch',
  message: 'patchOperations must be a valid JSON Patch document'
};

export const OperatingSystemsRules = {
  // GET /v2.0/OS/Folders
  listOsFolders: (): ValidationRule[] => paginationRules(),

  // GET /v2.0/OS/Folders/{id}
  getOsFolder: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /v2.0/OS/Folders/{folderId}/Folders
  listOsFoldersByFolder: (): ValidationRule[] => [
    CommonRules.guid('folderId'),
    ...paginationRules()
  ],

  // GET /v2.0/OS/WindowsEndpoints
  listOsWindowsEndpoints: (): ValidationRule[] => paginationRules(),

  // GET /v2.0/OS/WindowsEndpoints/{endpointId}
  getOsWindowsEndpoint: (): ValidationRule[] => [
    CommonRules.guid('endpointId')
  ],

  // POST /v2.0/OS/Folders
  createOsFolder: (): ValidationRule[] => [
    {
      name: 'folderData',
      required: true,
      type: 'object',
      message: 'folderData must be an object with at least a Name property'
    }
  ],

  // PATCH /v2.0/OS/Folders/{id}
  updateOsFolder: (): ValidationRule[] => [
    CommonRules.guid('id'),
    patchOperationsRule
  ],

  // DELETE /v2.0/OS/Folders/{id}
  deleteOsFolder: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // PATCH /v2.0/OS/WindowsEndpoints/{endpointId}
  updateOsWindowsEndpoint: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    patchOperationsRule
  ]
};
