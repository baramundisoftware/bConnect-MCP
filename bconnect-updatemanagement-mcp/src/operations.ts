/**
 * The bConnect API operation each tool of this server calls, by operationId in
 * the `updatemanagement` OpenAPI spec (openapi-specs/<release>/). One line per tool; add
 * one when you add a tool.
 *
 * The spec-conformance guard (__tests__/spec-conformance.guard.test.ts) checks
 * every tool against its entry for both bMS releases: the operation must exist,
 * and the tool's request must go to that operation's method and route.
 */
export const TOOL_OPERATIONS: Readonly<Record<string, readonly string[]>> = {
  list_update_management_endpoints: ['GetWindowsEndpoints'],
  get_update_management_endpoint: ['GetWindowsEndpoint'],
  update_update_management_endpoint: ['UpdateWindowsEndpoint'],
};
