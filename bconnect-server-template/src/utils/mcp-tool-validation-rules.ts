/**
 * MCP Tool Validation Rules — bconnect-DOMAIN-mcp (template)
 *
 * Centralised validation rules for every tool exposed by this server.
 * The dispatch in `index.ts` calls `validateOrThrow(args, DomainRules.toolName())`
 * BEFORE write-gate evaluation and BEFORE getBconnect() — argument validation is
 * pure, so it runs first and fails fast on bad input.
 *
 * Pattern (see any of the 13 production servers for full examples):
 *
 *   import { ValidationRule, CommonRules } from './parameter-validator.js';
 *
 *   const paginationRules = (): ValidationRule[] => [
 *     CommonRules.page(),
 *     CommonRules.pageSize(),
 *     CommonRules.searchQuery(),
 *     CommonRules.orderBy()
 *   ];
 *
 *   export const DomainRules = {
 *     listDomain: (): ValidationRule[] => paginationRules(),
 *     getDomain: (): ValidationRule[] => [CommonRules.guid('id')],
 *     updateDomain: (): ValidationRule[] => [
 *       CommonRules.guid('id'),
 *       {
 *         name: 'patchOperations',
 *         required: true,
 *         type: 'array',
 *         format: 'json-patch',
 *         message: 'patchOperations must be a valid JSON Patch document'
 *       }
 *     ]
 *   };
 *
 * CommonRules helpers (in parameter-validator.ts): guid, guidOptional, page,
 * pageSize, searchQuery, orderBy, jsonPatch, displayName, comment.
 *
 * For domain-specific shapes (booleans, named strings, custom objects), inline
 * the ValidationRule directly — see e.g. SoftwareRules.listBundleFoldersByFolder
 * for the includeSubfolders boolean rule, or AssetsRules.createAsset for typed
 * required-field rules.
 */

import { ValidationRule, CommonRules } from './parameter-validator.js';

export const DomainRules = {
  // TODO: Add one method per tool. Each returns ValidationRule[].
  // Replace this placeholder with the real tool rules.
  exampleListDomain: (): ValidationRule[] => [
    CommonRules.page(),
    CommonRules.pageSize(),
    CommonRules.searchQuery(),
    CommonRules.orderBy()
  ],

  exampleGetDomain: (): ValidationRule[] => [
    CommonRules.guid('id')
  ]
};
