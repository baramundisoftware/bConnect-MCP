/**
 * The bConnect API operation each tool of this server calls, by operationId in
 * the `servermanagement` OpenAPI spec (openapi-specs/<release>/). One line per tool; add
 * one when you add a tool.
 *
 * The spec-conformance guard (__tests__/spec-conformance.guard.test.ts) checks
 * every tool against its entry for both bMS releases: the operation must exist,
 * and the tool's request must go to that operation's method and route.
 */
export const TOOL_OPERATIONS: Readonly<Record<string, readonly string[]>> = {
  get_management_server: ['GetManagementServer'],
  get_gateway: ['GetGateway'],
  get_dip_status: ['GetDipStatus'],
  get_vpn_appliance: ['GetVpnAppliance'],
  list_microservices: ['GetMicroservices'],
  get_microservice: ['GetMicroservice'],
  start_microservice: ['StartMicroservice'],
  stop_microservice: ['StopMicroservice'],
  restart_microservice: ['RestartMicroservice'],
  list_cloud_connectors: ['GetCloudConnectors'],
  list_pxe_relays: ['GetPxeRelays'],
  list_security_groups: ['GetSecurityGroups'],
  get_security_group: ['GetSecurityGroup'],
  create_security_group: ['CreateSecurityGroup'],
  update_security_group: ['UpdateSecurityGroup'],
  delete_security_group: ['DeleteSecurityGroup'],
  list_security_profiles: ['GetSecurityProfiles'],
  get_security_profile: ['GetSecurityProfile'],
  create_security_profile: ['CreateSecurityProfile'],
  update_security_profile: ['UpdateSecurityProfile'],
  delete_security_profile: ['DeleteSecurityProfile'],
  get_access_rights: ['GetAccessRights'],
  update_object_permission: ['UpdateObjectPermission'],
  restart_management_server: ['RestartBaramundiManagementServer'],
  cancel_scheduled_restart: ['CancelScheduledRestartBaramundiManagementServer'],
  list_api_keys: ['GetApiKeys'],
  simulate_msw_cleanup: ['SimulateMSWCleanup'],
  msw_cleanup: ['MSWCleanup'],
  list_download_jobs: ['GetDownloadJobs'],
  get_download_job: ['GetDownloadJob'],
};
