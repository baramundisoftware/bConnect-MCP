/**
 * MCP Tool Validation Rules — bconnect-variables-mcp
 *
 * Centralised validation rules for the 13 tools exposed by this server.
 * Replaces the inline `typeof` checks that previously lived in `index.ts`.
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
    {
      name: 'dataType',
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 50,
      message: 'dataType is required (string, e.g. "String", "Integer", "Boolean")'
    },
    {
      name: 'defaultValue',
      required: false,
      type: 'string'
    },
    {
      name: 'description',
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
