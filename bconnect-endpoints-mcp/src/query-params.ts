/**
 * The query parameters each list tool sends, by tool (#186): exactly the ones
 * its route declares in the bundled specs (25R2 and 26R1 together). Handlers
 * pass `pickArguments(args, QUERY_PARAMS.<tool>)`, so the path id and any
 * other argument stay out of the query. __tests__/query-parameters.test.ts
 * checks this table against the specs.
 */
export const QUERY_PARAMS = {
  list_endpoints_by_logical_group: ["OrderBy", "SearchQuery", "DisplayName", "Page", "PageSize", "HostName", "includeSubfolders"],
  list_group_endpoints: ["OrderBy", "SearchQuery", "DisplayName", "Page", "PageSize", "HostName", "includeSubfolders"],
  list_windows_endpoints_by_logical_group: ["OrderBy", "SearchQuery", "Domain", "DisplayName", "Page", "PageSize", "HostName", "includeSubfolders", "EntraIdDeviceId"],
  list_logical_groups: ["OrderBy", "SearchQuery", "Name", "Dip", "Domain", "Page", "PageSize"],
  list_unmanaged_endpoints: [],
} as const satisfies Readonly<Record<string, readonly string[]>>;
