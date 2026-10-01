/**
 * The bConnect API operation each tool of this server calls, by operationId in
 * the `jobs` OpenAPI spec (openapi-specs/<release>/). One line per tool; add
 * one when you add a tool.
 *
 * The spec-conformance guard (__tests__/spec-conformance.guard.test.ts) checks
 * every tool against its entry for both bMS releases: the operation must exist,
 * and the tool's request must go to that operation's method and route.
 */
export const TOOL_OPERATIONS: Readonly<Record<string, readonly string[]>> = {
  list_job_definitions: ['GetJobDefinitions'],
  get_job_definition: ['GetJobDefinition'],
  list_job_instances: ['GetJobInstances'],
  get_job_instance: ['GetJobInstance'],
  list_endpoint_job_instances: ['GetJobInstancesByEndpointId'],
  list_job_instances_by_definition: ['GetJobInstancesByJobDefinitionId'],
  list_job_instances_by_logical_group: ['GetJobInstancesByLogicalGroupId'],
  list_job_definitions_by_folder: ['GetJobDefinitionsByFolderId'],
  create_job_instance: ['CreateJobInstance'],
  start_job_instance: ['StartJobInstance'],
  stop_job_instance: ['StopJobInstance'],
  resume_job_instance: ['ResumeJobInstance'],
  delete_job_instance: ['DeleteJobInstance'],
  create_job_folder: ['CreateFolder'],
  update_job_folder: ['UpdateFolder'],
  delete_job_folder: ['DeleteFolder'],
  assign_job_to_logical_group: ['AssignJobDefinitionToLogicalGroup'],
  assign_job_to_static_group: ['AssignJobDefinitionToStaticGroup'],
  assign_job_to_dynamic_group: ['AssignJobDefinitionToWindowsDynamicGroup'],
  assign_job_to_universal_dynamic_group: ['AssignJobDefinitionToUniversalDynamicGroup'],
  create_kiosk_release: ['CreateKioskRelease'],
  withdraw_kiosk_release: ['WithdrawKioskRelease'],
  list_kiosk_releases: ['GetKioskReleases'],
  get_kiosk_release: ['GetKioskRelease'],
  list_job_folders: ['GetFolders'],
  get_job_folder: ['GetFolder'],
  list_job_subfolders: ['GetFoldersByFolderId'],
  list_kiosk_releases_by_job_definition: ['GetKioskReleasesByJobDefinitionId'],
  list_kiosk_releases_by_endpoint: ['GetKioskReleasesByEndpointId'],
  list_kiosk_releases_by_ad_object: ['GetKioskReleasesByAdObjectId'],
  list_kiosk_releases_by_logical_group: ['GetKioskReleasesByLogicalGroupId'],
  list_job_instances_by_static_group: ['GetJobInstancesByStaticGroupId'],
  list_job_instances_by_dynamic_group: ['GetJobInstancesByDynamicGroupId'],
  list_job_instances_by_universal_dynamic_group: ['GetJobInstancesByUniversalDynamicGroupId'],
};
