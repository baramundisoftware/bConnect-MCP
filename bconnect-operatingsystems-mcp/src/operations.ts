/**
 * The bConnect API operation each tool of this server calls, by operationId in
 * the `operatingsystems` OpenAPI spec (openapi-specs/<release>/). One line per tool; add
 * one when you add a tool.
 *
 * The spec-conformance guard (__tests__/spec-conformance.guard.test.ts) checks
 * every tool against its entry for both bMS releases: the operation must exist,
 * and the tool's request must go to that operation's method and route.
 */
export const TOOL_OPERATIONS: Readonly<Record<string, readonly string[]>> = {
  list_os_folders: ['GetFolders'],
  get_os_folder: ['GetFolder'],
  list_os_folders_by_folder: ['GetFoldersByFolderId'],
  list_os_windows_endpoints: ['GetWindowsEndpoints'],
  get_os_windows_endpoint: ['GetWindowsEndpoint'],
  create_os_folder: ['CreateFolder'],
  update_os_folder: ['UpdateFolder'],
  delete_os_folder: ['DeleteFolder'],
  update_os_windows_endpoint: ['UpdateWindowsEndpoint'],
};
