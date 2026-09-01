/**
 * MCP Tool Validation Rules — bconnect-insights-mcp (template)
 *
 * Centralised validation rules for every tool exposed by this server.
 * The dispatch in `index.ts` calls `validateOrThrow(args, DomainRules.toolName())`
 * BEFORE write-gate evaluation and BEFORE getBconnect() — argument validation is
 * pure, so it runs first and fails fast on bad input.
 *
 * Pattern (see any of the 13 production servers for full examples):
 *
 *   import { ValidationRule, CommonRules } from "@bconnect/mcp-core";
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

import { ValidationRule, CommonRules } from "@bconnect/mcp-core";

/**
 * Bounds, not just types. Each of these numbers reaches a page read or a date
 * arithmetic, so a negative or absurd value is a malformed question rather
 * than a preference — and validation runs BEFORE the client is built, which is
 * the whole point of the pre-pass.
 */
export const InsightsRules = {
  estateRiskBriefing: (): ValidationRule[] => [
    {
      name: 'maxNamed',
      required: false,
      type: 'number',
      min: 0,
      max: 500,
      message: 'maxNamed must be between 0 and 500 (counts stay exact regardless)'
    },
    {
      name: 'staleDefinitionsAfterDays',
      required: false,
      type: 'number',
      min: 0,
      max: 3650,
      message: 'staleDefinitionsAfterDays must be between 0 and 3650'
    },
    {
      name: 'staleEndpointAfterDays',
      required: false,
      type: 'number',
      min: 0,
      max: 3650,
      message: 'staleEndpointAfterDays must be between 0 and 3650'
    },
    // Same 1-1000 bound as CommonRules.pageSize(), written out rather than
    // reused: that helper validates a parameter named `PageSize`, and this
    // tool's is `pageSize` — composite tools in this suite take camelCase
    // options (maxNamed, staleDefinitionsAfterDays), while paged list tools
    // take the API's own `PageSize`. Calling the helper here would have
    // installed a rule for a parameter that does not exist, so `pageSize`
    // would have been accepted unvalidated while the file looked correct.
    {
      name: 'pageSize',
      required: false,
      type: 'number',
      min: 1,
      max: 1000,
      message: 'pageSize must be between 1 and 1000'
    }
  ],

  endpointBriefing: (): ValidationRule[] => [
    CommonRules.guidOptional("endpointId"),
    {
      name: "endpointName",
      required: false,
      type: "string",
      minLength: 1,
      maxLength: 255,
      message: "endpointName must be a non-empty display or host name"
    },
    { name: "maxNamed", required: false, type: "number", min: 0, max: 100, message: "maxNamed must be between 0 and 100" },
    { name: "staleDefinitionsAfterDays", required: false, type: "number", min: 0, max: 3650, message: "staleDefinitionsAfterDays must be between 0 and 3650" },
    { name: "pageSize", required: false, type: "number", min: 1, max: 1000, message: "pageSize must be between 1 and 1000" }
  ],

  patchReadiness: (): ValidationRule[] => [
    { name: "inventoryStaleAfterDays", required: false, type: "number", min: 0, max: 3650, message: "inventoryStaleAfterDays must be between 0 and 3650" },
    { name: "scanStaleAfterDays", required: false, type: "number", min: 0, max: 3650, message: "scanStaleAfterDays must be between 0 and 3650" },
    { name: "maxNamed", required: false, type: "number", min: 0, max: 100, message: "maxNamed must be between 0 and 100" },
    { name: "pageSize", required: false, type: "number", min: 1, max: 1000, message: "pageSize must be between 1 and 1000" }
  ],

  endpointReach: (): ValidationRule[] => [
    CommonRules.guid("endpointId"),
    { name: "maxGroupsChecked", required: false, type: "number", min: 1, max: 1000, message: "maxGroupsChecked must be between 1 and 1000" },
    { name: "budgetMs", required: false, type: "number", min: 1000, max: 120000, message: "budgetMs must be between 1000 and 120000" },
    { name: "maxNamed", required: false, type: "number", min: 0, max: 100, message: "maxNamed must be between 0 and 100" },
    { name: "pageSize", required: false, type: "number", min: 1, max: 1000, message: "pageSize must be between 1 and 1000" }
  ],

  deploymentCoverage: (): ValidationRule[] => [
    CommonRules.guid("bundleId"),
    CommonRules.guid("logicalGroupId"),
    { name: "inventoryStaleAfterDays", required: false, type: "number", min: 0, max: 3650, message: "inventoryStaleAfterDays must be between 0 and 3650" },
    { name: "reachableWithinDays", required: false, type: "number", min: 0, max: 3650, message: "reachableWithinDays must be between 0 and 3650" },
    { name: "maxNamed", required: false, type: "number", min: 0, max: 100, message: "maxNamed must be between 0 and 100" },
    { name: "pageSize", required: false, type: "number", min: 1, max: 1000, message: "pageSize must be between 1 and 1000" }
  ]
};
