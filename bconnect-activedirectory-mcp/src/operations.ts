/**
 * The bConnect API operation each tool of this server calls, by operationId in
 * the `activedirectory` OpenAPI spec (openapi-specs/<release>/). One line per tool; add
 * one when you add a tool.
 *
 * The spec-conformance guard (__tests__/spec-conformance.guard.test.ts) checks
 * every tool against its entry for both bMS releases: the operation must exist,
 * and the tool's request must go to that operation's method and route.
 */
export const TOOL_OPERATIONS: Readonly<Record<string, readonly string[]>> = {
  list_ad_groups: ['GetADGroups'],
  get_ad_group: ['GetADGroupById'],
  list_ad_subgroups: ['GetADGroupsByADGroupId'],
  list_ad_groups_by_org_unit: ['GetADGroupsByOrgUnitId'],
  list_ad_objects: ['GetADObjects'],
  get_ad_object: ['GetADObjectById'],
  list_ad_object_memberships: ['GetADObjectMemberships'],
  list_ad_objects_by_group: ['GetADObjectsByADGroupId'],
  list_ad_objects_by_org_unit: ['GetADObjectsByOrgUnitId'],
  list_ad_users: ['GetADUsers'],
  get_ad_user: ['GetADUserById'],
  list_ad_users_by_group: ['GetADUsersByADGroupId'],
  list_ad_users_by_org_unit: ['GetADUsersByOrgUnitId'],
  list_org_units: ['GetOrgUnits'],
  get_org_unit: ['GetOrgUnit'],
  list_org_units_by_org_unit: ['GetOrgUnitsByOrgUnitId'],
};
