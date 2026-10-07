/**
 * The bConnect API operation each tool of this server calls, by operationId in
 * the `endpoints` OpenAPI spec (openapi-specs/<release>/). One line per tool; add
 * one when you add a tool.
 *
 * Both tools are merged tools (REQ-SRV-029, #174, ADR-0015): one line per route
 * (variant), keyed `tool[selector=value,…]`; an empty value is the call without
 * that argument. list_group_members takes the group kind and the member type
 * (endpoint type, or LogicalGroup for the child groups of a logical group),
 * list_ad_user_endpoints the endpoint type. The generator derives each route's
 * query parameters and releases from the specs.
 *
 * The spec-conformance guard (__tests__/spec-conformance.guard.test.ts) checks
 * every route against its entry for both bMS releases: the operation must exist,
 * and the request must go to that operation's method and route.
 */
export const TOOL_OPERATIONS: Readonly<Record<string, readonly string[]>> = {
  'list_group_members[groupKind=LogicalGroup,memberType=]': ['GetEndpointsByLogicalGroupId'],
  'list_group_members[groupKind=LogicalGroup,memberType=WindowsEndpoint]': ['GetWindowsEndpointsByLogicalGroupId'],
  'list_group_members[groupKind=LogicalGroup,memberType=MacEndpoint]': ['GetMacEndpointsByLogicalGroupId'],
  'list_group_members[groupKind=LogicalGroup,memberType=LinuxEndpoint]': ['GetLinuxEndpointsByLogicalGroupId'],
  'list_group_members[groupKind=LogicalGroup,memberType=AndroidEndpoint]': ['GetAndroidEndpointsByLogicalGroupId'],
  'list_group_members[groupKind=LogicalGroup,memberType=IOSEndpoint]': ['GetIOSEndpointsByLogicalGroupId'],
  'list_group_members[groupKind=LogicalGroup,memberType=NetworkEndpoint]': ['GetNetworkEndpointsByLogicalGroupId'],
  'list_group_members[groupKind=LogicalGroup,memberType=IndustrialEndpoint]': ['GetIndustrialEndpointsByLogicalGroupId'],
  'list_group_members[groupKind=LogicalGroup,memberType=LogicalGroup]': ['GetLogicalGroupsByLogicalGroupId'],
  'list_group_members[groupKind=StaticGroup,memberType=]': ['GetEndpointsByStaticGroupId'],
  'list_group_members[groupKind=StaticGroup,memberType=WindowsEndpoint]': ['GetWindowsEndpointsByStaticGroupId'],
  'list_group_members[groupKind=StaticGroup,memberType=MacEndpoint]': ['GetMacEndpointsByStaticGroupId'],
  'list_group_members[groupKind=StaticGroup,memberType=LinuxEndpoint]': ['GetLinuxEndpointsByStaticGroupId'],
  'list_group_members[groupKind=StaticGroup,memberType=AndroidEndpoint]': ['GetAndroidEndpointsByStaticGroupId'],
  'list_group_members[groupKind=StaticGroup,memberType=IOSEndpoint]': ['GetIOSEndpointsByStaticGroupId'],
  'list_group_members[groupKind=StaticGroup,memberType=NetworkEndpoint]': ['GetNetworkEndpointsByStaticGroupId'],
  'list_group_members[groupKind=StaticGroup,memberType=IndustrialEndpoint]': ['GetIndustrialEndpointsByStaticGroupId'],
  'list_group_members[groupKind=DynamicGroup,memberType=]': ['GetEndpointsByDynamicGroupId'],
  'list_group_members[groupKind=DynamicGroup,memberType=WindowsEndpoint]': ['GetWindowsEndpointsByDynamicGroupId'],
  'list_group_members[groupKind=UniversalDynamicGroup,memberType=]': ['GetEndpointsByUniversalDynamicGroupId'],
  'list_group_members[groupKind=UniversalDynamicGroup,memberType=WindowsEndpoint]': ['GetWindowsEndpointsByUniversalDynamicGroupId'],
  'list_group_members[groupKind=UniversalDynamicGroup,memberType=MacEndpoint]': ['GetMacEndpointsByUniversalDynamicGroupId'],
  'list_group_members[groupKind=UniversalDynamicGroup,memberType=LinuxEndpoint]': ['GetLinuxEndpointsByUniversalDynamicGroupId'],
  'list_group_members[groupKind=UniversalDynamicGroup,memberType=AndroidEndpoint]': ['GetAndroidEndpointsByUniversalDynamicGroupId'],
  'list_group_members[groupKind=UniversalDynamicGroup,memberType=IOSEndpoint]': ['GetIOSEndpointsByUniversalDynamicGroupId'],
  'list_group_members[groupKind=UniversalDynamicGroup,memberType=NetworkEndpoint]': ['GetNetworkEndpointsByUniversalDynamicGroupId'],
  'list_group_members[groupKind=UniversalDynamicGroup,memberType=IndustrialEndpoint]': ['GetIndustrialEndpointsByUniversalDynamicGroupId'],
  'list_ad_user_endpoints[endpointType=]': ['GetEndpointsByADObjectId'],
  'list_ad_user_endpoints[endpointType=WindowsEndpoint]': ['GetWindowsEndpointsByADObjectId'],
  'list_ad_user_endpoints[endpointType=MacEndpoint]': ['GetMacEndpointsByADObjectId'],
  'list_ad_user_endpoints[endpointType=LinuxEndpoint]': ['GetLinuxEndpointsByADObjectId'],
  'list_ad_user_endpoints[endpointType=AndroidEndpoint]': ['GetAndroidEndpointsByADObjectId'],
  'list_ad_user_endpoints[endpointType=IOSEndpoint]': ['GetIOSEndpointsByADObjectId'],
};
