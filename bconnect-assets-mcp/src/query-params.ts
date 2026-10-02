/**
 * The query parameters each list tool sends, by tool (#186): exactly the ones
 * its route declares in the bundled specs (25R2 and 26R1 together). Handlers
 * pass `pickArguments(args, QUERY_PARAMS.<tool>)`, so the path id and any
 * other argument stay out of the query. __tests__/query-parameters.test.ts
 * checks this table against the specs.
 */
export const QUERY_PARAMS = {
  list_assets: ["OrderBy", "SearchQuery", "DisplayName", "Page", "PageSize"],
  list_assets_in_asset_stock: ["OrderBy", "SearchQuery", "DisplayName", "Page", "PageSize"],
  list_assets_by_logical_group: ["OrderBy", "SearchQuery", "DisplayName", "Page", "PageSize"],
  list_assets_by_windows_endpoint: ["OrderBy", "SearchQuery", "DisplayName", "Page", "PageSize"],
  list_assets_by_org_unit: ["OrderBy", "SearchQuery", "DisplayName", "Page", "PageSize"],
  list_assets_by_ad_object: ["OrderBy", "SearchQuery", "DisplayName", "Page", "PageSize"],
  list_asset_stock_folders: ["OrderBy", "SearchQuery", "Name", "Page", "PageSize"],
  list_asset_stock_subfolders: ["OrderBy", "SearchQuery", "Name", "Page", "PageSize", "includeSubfolders"],
  list_asset_type_folders: ["OrderBy", "SearchQuery", "Name", "Page", "PageSize"],
  list_asset_type_subfolders: ["OrderBy", "SearchQuery", "Name", "Page", "PageSize", "includeSubfolders"],
  list_asset_types: ["OrderBy", "SearchQuery", "ShowSummary", "Icon", "AdditionalProperties", "Page", "PageSize"],
} as const satisfies Readonly<Record<string, readonly string[]>>;
