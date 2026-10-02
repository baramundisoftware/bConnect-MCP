/**
 * The query parameters each list tool sends, by tool (#186): exactly the ones
 * its route declares in the bundled specs (25R2 and 26R1 together). Handlers
 * pass `pickArguments(args, QUERY_PARAMS.<tool>)`, so the path id and any
 * other argument stay out of the query. __tests__/query-parameters.test.ts
 * checks this table against the specs.
 */
export const QUERY_PARAMS = {
  list_ad_groups: ["OrderBy", "SearchQuery", "Page", "PageSize"],
  list_ad_subgroups: ["OrderBy", "SearchQuery", "Page", "PageSize", "includeIndirect"],
  list_ad_groups_by_org_unit: ["OrderBy", "SearchQuery", "Page", "PageSize", "includeSubOrgUnit"],
  list_ad_objects: ["OrderBy", "SearchQuery", "Page", "PageSize"],
  list_ad_object_memberships: ["OrderBy", "SearchQuery", "Page", "PageSize", "includeIndirect"],
  list_ad_objects_by_group: ["OrderBy", "SearchQuery", "Page", "PageSize", "includeIndirect"],
  list_ad_objects_by_org_unit: ["OrderBy", "SearchQuery", "Page", "PageSize", "includeSubOrgUnit"],
  list_ad_users: ["OrderBy", "SearchQuery", "Page", "PageSize"],
  list_ad_users_by_group: ["OrderBy", "SearchQuery", "Page", "PageSize", "includeIndirect"],
  list_ad_users_by_org_unit: ["OrderBy", "SearchQuery", "Page", "PageSize", "includeSubOrgUnit"],
  list_org_units: ["OrderBy", "SearchQuery", "Name", "Page", "PageSize"],
  list_org_units_by_org_unit: ["OrderBy", "SearchQuery", "Name", "Page", "PageSize", "includeSubOrgUnits"],
} as const satisfies Readonly<Record<string, readonly string[]>>;
