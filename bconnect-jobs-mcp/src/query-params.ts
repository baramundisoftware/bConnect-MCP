/**
 * The query parameters each list tool sends, by tool (#186): exactly the ones
 * its route declares in the bundled specs (25R2 and 26R1 together). Handlers
 * pass `pickArguments(args, QUERY_PARAMS.<tool>)`, so the path id and any
 * other argument stay out of the query. __tests__/query-parameters.test.ts
 * checks this table against the specs.
 */
export const QUERY_PARAMS = {
  list_job_definitions: ["Name", "OrderBy", "SearchQuery", "Page", "PageSize"],
  list_job_instances: ["EndpointType", "LastAction", "OrderBy", "SearchQuery", "Page", "PageSize"],
  list_endpoint_job_instances: ["LastAction", "OrderBy", "SearchQuery", "Page", "PageSize"],
  list_job_instances_by_definition: ["EndpointType", "LastAction", "OrderBy", "SearchQuery", "Page", "PageSize"],
  list_job_instances_by_logical_group: ["JobDefinitionId", "LastAction", "OrderBy", "SearchQuery", "Page", "PageSize", "includeSubfolders"],
  list_job_definitions_by_folder: ["Name", "OrderBy", "SearchQuery", "Page", "PageSize", "includeSubfolders"],
  list_kiosk_releases: ["OrderBy", "SearchQuery", "Page", "PageSize"],
  list_job_folders: ["OrderBy", "SearchQuery", "Name", "Page", "PageSize"],
  list_job_subfolders: ["OrderBy", "SearchQuery", "Name", "Page", "PageSize", "includeSubfolders", "includeSubFolders"],
  list_kiosk_releases_by_job_definition: ["OrderBy", "SearchQuery", "Page", "PageSize"],
  list_kiosk_releases_by_endpoint: ["OrderBy", "SearchQuery", "Page", "PageSize"],
  list_kiosk_releases_by_ad_object: ["OrderBy", "SearchQuery", "Page", "PageSize"],
  list_kiosk_releases_by_logical_group: ["OrderBy", "SearchQuery", "Page", "PageSize"],
  list_job_instances_by_static_group: ["JobDefinitionId", "LastAction", "OrderBy", "SearchQuery", "Page", "PageSize"],
  list_job_instances_by_dynamic_group: ["JobDefinitionId", "LastAction", "OrderBy", "SearchQuery", "Page", "PageSize"],
  list_job_instances_by_universal_dynamic_group: ["JobDefinitionId", "LastAction", "OrderBy", "SearchQuery", "Page", "PageSize"],
} as const satisfies Readonly<Record<string, readonly string[]>>;
