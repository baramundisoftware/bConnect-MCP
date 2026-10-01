/**
 * The bConnect API operation each tool of this server calls, by operationId in
 * the `software` OpenAPI spec (openapi-specs/<release>/). One line per tool; add
 * one when you add a tool.
 *
 * The spec-conformance guard (__tests__/spec-conformance.guard.test.ts) checks
 * every tool against its entry for both bMS releases: the operation must exist,
 * and the tool's request must go to that operation's method and route.
 */
export const TOOL_OPERATIONS: Readonly<Record<string, readonly string[]>> = {
  list_installed_windows_software: ['GetInstalledWindowsSoftware'],
  list_installed_software_by_endpoint: ['GetInstalledWindowsSoftwareByEndpointId'],
  list_installed_software_by_logical_group: ['GetInstalledWindowsSoftwareByLogicalGroupId'],
  list_installed_software_by_dynamic_group: ['GetInstalledWindowsSoftwareByUniversalDynamicGroupId'],
  list_software_bundles: ['GetSoftwareBundles'],
  get_software_bundle: ['GetBundle'],
  create_software_bundle: ['CreateBundle'],
  delete_software_bundle: ['DeleteBundle'],
  list_bundle_applications: ['GetBundleApplications'],
  list_bundle_applications_by_bundle: ['GetBundleApplicationsByBundleId'],
  add_application_to_bundle: ['AddApplicationToBundle'],
  delete_bundle_application: ['DeleteBundleApplicationById'],
  replace_application_in_bundle: ['ReplaceApplicationInBundle'],
  list_bundle_folders: ['GetBundleFolders'],
  get_bundle_folder: ['GetBundleFolder'],
  list_bundle_folders_by_folder: ['GetBundleFoldersByFolderId'],
  create_bundle_folder: ['CreateBundleFolder'],
  delete_bundle_folder: ['DeleteBundleFolder'],
  update_bundle_folder: ['UpdateBundleFolder'],
};
