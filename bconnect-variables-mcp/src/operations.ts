/**
 * The bConnect API operation each tool of this server calls, by operationId in
 * the `variables` OpenAPI spec (openapi-specs/<release>/). One line per tool; add
 * one when you add a tool.
 *
 * The spec-conformance guard (__tests__/spec-conformance.guard.test.ts) checks
 * every tool against its entry for both bMS releases: the operation must exist,
 * and the tool's request must go to that operation's method and route.
 */
export const TOOL_OPERATIONS: Readonly<Record<string, readonly string[]>> = {
  list_variable_definitions: ['GetVariableDefinitions'],
  get_variable_definition: ['GetVariableDefinitionById'],
  create_variable_definition: ['CreateVariableDefinition'],
  update_variable_definition: ['UpdateVariableDefinition'],
  delete_variable_definition: ['DeleteVariableDefinition'],
  list_variable_instances: ['GetVariableInstances'],
  get_variable_instance: ['GetVariableInstanceById'],
  list_variable_instances_by_endpoint: ['GetVariableInstancesByEndpointId'],
  list_variable_instances_by_logical_group: ['GetVariableInstancesByLogicalGroupId'],
  list_variable_instances_by_ad_object: ['GetVariableInstancesByADObjectId'],
  list_variable_instances_by_job_definition: ['GetVariableInstancesByWindowsJobDefinitonId'],
  list_variable_instances_by_application: ['GetVariableInstancesByWindowsApplicationId'],
  update_variable_instance: ['UpdateVariableInstance'],
};
