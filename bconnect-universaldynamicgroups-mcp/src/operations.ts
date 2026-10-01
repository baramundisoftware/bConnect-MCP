/**
 * The bConnect API operation each tool of this server calls, by operationId in
 * the `universaldynamicgroups` OpenAPI spec (openapi-specs/<release>/). One line per tool; add
 * one when you add a tool.
 *
 * The spec-conformance guard (__tests__/spec-conformance.guard.test.ts) checks
 * every tool against its entry for both bMS releases: the operation must exist,
 * and the tool's request must go to that operation's method and route.
 */
export const TOOL_OPERATIONS: Readonly<Record<string, readonly string[]>> = {
  list_universal_dynamic_groups: ['GetUniversalDynamicGroups'],
  get_universal_dynamic_group: ['GetUniversalDynamicGroup'],
  list_universal_dynamic_groups_by_folder: ['GetUniversalDynamicGroupsByFolderId'],
  list_udg_folders: ['GetFolders'],
  get_udg_folder: ['GetFolder'],
  list_udg_folders_by_folder: ['GetFoldersByFolderId'],
};
