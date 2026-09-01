/**
 * MCP Tool Validation Rules — bconnect-variables-mcp
 *
 * Centralised validation rules for the 13 tools exposed by this server.
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

export const VariablesRules = {
  // ── Variable Definitions ─────────────────────────────────────────────
  listVariableDefinitions: (): ValidationRule[] => paginationRules(),

  getVariableDefinition: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  createVariableDefinition: (): ValidationRule[] => [
    {
      name: 'name',
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 255,
      message: 'name is required (string, 1-255 chars)'
    },
    // LOCAL PATCH (F23): aligned with the API's VariableDefinitionForCreation,
    // which requires category + name + scopes. The previous rules demanded
    // `dataType` (not an API field) and never required category or scopes, so
    // every validated call still failed at the API with HTTP 400.
    {
      name: 'category',
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 255,
      message: 'category is required (string, 1-255 chars)'
    },
    {
      name: 'scopes',
      required: true,
      type: 'array',
      message: 'scopes is required (array, e.g. ["Endpoint"])'
    },
    {
      name: 'type',
      required: false,
      type: 'string',
      maxLength: 50,
      message: 'type must be one of: String, Integer, Password, Date, DropDownList, DropDownEditableList, Checkbox, FileLink, Folder'
    },
    {
      name: 'defaultValue',
      required: false,
      type: 'string'
    },
    {
      name: 'comment',
      required: false,
      type: 'string',
      maxLength: 4000
    }
  ],

  updateVariableDefinition: (): ValidationRule[] => [
    CommonRules.guid('id'),
    patchOperationsRule
  ],

  deleteVariableDefinition: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // ── Variable Instances ───────────────────────────────────────────────
  listVariableInstances: (): ValidationRule[] => paginationRules(),

  getVariableInstance: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  listVariableInstancesByEndpoint: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    ...paginationRules()
  ],

  listVariableInstancesByLogicalGroup: (): ValidationRule[] => [
    CommonRules.guid('logicalGroupId'),
    ...paginationRules()
  ],

  listVariableInstancesByAdObject: (): ValidationRule[] => [
    CommonRules.guid('adObjectId'),
    ...paginationRules()
  ],

  listVariableInstancesByJobDefinition: (): ValidationRule[] => [
    CommonRules.guid('windowsJobDefinitionId'),
    ...paginationRules()
  ],

  listVariableInstancesByApplication: (): ValidationRule[] => [
    CommonRules.guid('windowsApplicationId'),
    ...paginationRules()
  ],

  updateVariableInstance: (): ValidationRule[] => [
    CommonRules.guid('id'),
    patchOperationsRule
  ]
};
