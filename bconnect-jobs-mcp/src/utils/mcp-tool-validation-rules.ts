/**
 * MCP Tool Validation Rules — bconnect-jobs-mcp
 *
 * Input validation rules for this server's tools (`TOOL_RULES`).
 */

import { ValidationRule, CommonRules } from "@bconnect/mcp-core";

/**
 * Common pagination parameters used across many tools
 */
export const paginationRules = (): ValidationRule[] => [
  CommonRules.page(),
  CommonRules.pageSize(),
  CommonRules.searchQuery(),
  CommonRules.orderBy()
];

/**
 * Jobs API Validation Rules
 */
export const JobsRules = {
  // GET /JobDefinitions
  listJobDefinitions: (): ValidationRule[] => paginationRules(),

  // GET /JobDefinitions/{id}
  getJobDefinition: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /JobInstances
  listJobInstances: (): ValidationRule[] => paginationRules(),

  // GET /JobInstances/{id}
  getJobInstance: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /JobInstances?endpointId={endpointId}
  listEndpointJobInstances: (): ValidationRule[] => [
    CommonRules.guid('endpointId')
  ],

  // GET /JobFolders
  listJobFolders: (): ValidationRule[] => [],

  // GET /JobFolders/{id}
  getJobFolder: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /Folders/{folderId}/JobDefinitions
  listJobDefinitionsByFolder: (): ValidationRule[] => [
    CommonRules.guid('folderId'),
    ...paginationRules()
  ],

  // GET /JobDefinitions/{jobDefinitionId}/JobInstances
  listJobInstancesByDefinition: (): ValidationRule[] => [
    CommonRules.guid('jobDefinitionId'),
    ...paginationRules()
  ],

  // GET /LogicalGroups/{logicalGroupId}/JobInstances
  listJobInstancesByLogicalGroup: (): ValidationRule[] => [
    CommonRules.guid('logicalGroupId'),
    ...paginationRules()
  ]
};

/**
 * Validation rules per registered tool (REQ-SRV-018). The server validates a
 * tool's arguments with these before any request; a tool missing here fails
 * the tool-argument guard test instead of passing unchecked.
 */
export const TOOL_RULES: Record<string, () => ValidationRule[]> = {
  assign_job_to_dynamic_group: () => [CommonRules.guid('dynamicGroupId'), CommonRules.guid('jobDefinitionId')],
  assign_job_to_logical_group: () => [CommonRules.guid('logicalGroupId'), CommonRules.guid('jobDefinitionId')],
  assign_job_to_static_group: () => [CommonRules.guid('staticGroupId'), CommonRules.guid('jobDefinitionId')],
  assign_job_to_universal_dynamic_group: () => [CommonRules.guid('universalDynamicGroupId'), CommonRules.guid('jobDefinitionId')],
  create_job_folder: () => [CommonRules.guidOptional('parentId')],
  create_job_instance: () => [CommonRules.guid('jobDefinitionId'), CommonRules.guid('endpointId')],
  create_kiosk_release: () => [CommonRules.guid('assignmentTargetId'), CommonRules.guid('jobDefinitionId')],
  delete_job_folder: JobsRules.getJobFolder,
  delete_job_instance: JobsRules.getJobInstance,
  get_job_definition: JobsRules.getJobDefinition,
  get_job_folder: JobsRules.getJobFolder,
  get_job_instance: JobsRules.getJobInstance,
  get_kiosk_release: () => [CommonRules.guid('id')],
  list_endpoint_job_instances: JobsRules.listEndpointJobInstances,
  list_job_definitions: JobsRules.listJobDefinitions,
  list_job_definitions_by_folder: JobsRules.listJobDefinitionsByFolder,
  list_job_folders: JobsRules.listJobFolders,
  list_job_instances: JobsRules.listJobInstances,
  list_job_instances_by_definition: JobsRules.listJobInstancesByDefinition,
  list_job_instances_by_dynamic_group: () => [CommonRules.guid('dynamicGroupId'), CommonRules.page(), CommonRules.pageSize()],
  list_job_instances_by_logical_group: JobsRules.listJobInstancesByLogicalGroup,
  list_job_instances_by_static_group: () => [CommonRules.guid('staticGroupId'), CommonRules.page(), CommonRules.pageSize()],
  list_job_instances_by_universal_dynamic_group: () => [CommonRules.guid('universalDynamicGroupId'), CommonRules.page(), CommonRules.pageSize()],
  list_job_subfolders: () => [CommonRules.guid('folderId'), CommonRules.page(), CommonRules.pageSize()],
  list_kiosk_releases: JobsRules.listJobInstances,
  list_kiosk_releases_by_ad_object: () => [CommonRules.guid('adObjectId'), CommonRules.page(), CommonRules.pageSize()],
  list_kiosk_releases_by_endpoint: () => [CommonRules.guid('endpointId'), CommonRules.page(), CommonRules.pageSize()],
  list_kiosk_releases_by_job_definition: () => [CommonRules.guid('jobDefinitionId'), CommonRules.page(), CommonRules.pageSize()],
  list_kiosk_releases_by_logical_group: () => [CommonRules.guid('logicalGroupId'), CommonRules.page(), CommonRules.pageSize()],
  resume_job_instance: JobsRules.getJobInstance,
  start_job_instance: JobsRules.getJobInstance,
  stop_job_instance: JobsRules.getJobInstance,
  update_job_folder: JobsRules.getJobFolder,
  withdraw_kiosk_release: () => [CommonRules.guid('id')],
};
