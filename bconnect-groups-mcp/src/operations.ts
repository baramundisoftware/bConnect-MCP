/**
 * The bConnect API operation each tool of this server calls, by operationId in
 * the `endpoints` OpenAPI spec (openapi-specs/<release>/). One line per tool; add
 * one when you add a tool.
 *
 * The spec-conformance guard (__tests__/spec-conformance.guard.test.ts) checks
 * every tool against its entry for both bMS releases: the operation must exist,
 * and the tool's request must go to that operation's method and route.
 */
export const TOOL_OPERATIONS: Readonly<Record<string, readonly string[]>> = {
  list_endpoints_by_logical_group: ['GetEndpointsByLogicalGroupId'],
  list_android_endpoints_by_logical_group: ['GetAndroidEndpointsByLogicalGroupId'],
  list_ios_endpoints_by_logical_group: ['GetIOSEndpointsByLogicalGroupId'],
  list_linux_endpoints_by_logical_group: ['GetLinuxEndpointsByLogicalGroupId'],
  list_mac_endpoints_by_logical_group: ['GetMacEndpointsByLogicalGroupId'],
  list_network_endpoints_by_logical_group: ['GetNetworkEndpointsByLogicalGroupId'],
  list_windows_endpoints_by_logical_group: ['GetWindowsEndpointsByLogicalGroupId'],
  list_industrial_endpoints_by_logical_group: ['GetIndustrialEndpointsByLogicalGroupId'],
  list_logical_groups_by_logical_group: ['GetLogicalGroupsByLogicalGroupId'],
  list_endpoints_by_static_group: ['GetEndpointsByStaticGroupId'],
  list_android_endpoints_by_static_group: ['GetAndroidEndpointsByStaticGroupId'],
  list_ios_endpoints_by_static_group: ['GetIOSEndpointsByStaticGroupId'],
  list_linux_endpoints_by_static_group: ['GetLinuxEndpointsByStaticGroupId'],
  list_mac_endpoints_by_static_group: ['GetMacEndpointsByStaticGroupId'],
  list_network_endpoints_by_static_group: ['GetNetworkEndpointsByStaticGroupId'],
  list_windows_endpoints_by_static_group: ['GetWindowsEndpointsByStaticGroupId'],
  list_industrial_endpoints_by_static_group: ['GetIndustrialEndpointsByStaticGroupId'],
  list_endpoints_by_dynamic_group: ['GetEndpointsByDynamicGroupId'],
  list_windows_endpoints_by_dynamic_group: ['GetWindowsEndpointsByDynamicGroupId'],
  list_endpoints_by_universal_dynamic_group: ['GetEndpointsByUniversalDynamicGroupId'],
  list_android_endpoints_by_universal_dynamic_group: ['GetAndroidEndpointsByUniversalDynamicGroupId'],
  list_ios_endpoints_by_universal_dynamic_group: ['GetIOSEndpointsByUniversalDynamicGroupId'],
  list_linux_endpoints_by_universal_dynamic_group: ['GetLinuxEndpointsByUniversalDynamicGroupId'],
  list_mac_endpoints_by_universal_dynamic_group: ['GetMacEndpointsByUniversalDynamicGroupId'],
  list_network_endpoints_by_universal_dynamic_group: ['GetNetworkEndpointsByUniversalDynamicGroupId'],
  list_windows_endpoints_by_universal_dynamic_group: ['GetWindowsEndpointsByUniversalDynamicGroupId'],
  list_industrial_endpoints_by_universal_dynamic_group: ['GetIndustrialEndpointsByUniversalDynamicGroupId'],
  list_endpoints_by_ad_user: ['GetEndpointsByADObjectId'],
  list_android_endpoints_by_ad_user: ['GetAndroidEndpointsByADObjectId'],
  list_ios_endpoints_by_ad_user: ['GetIOSEndpointsByADObjectId'],
  list_linux_endpoints_by_ad_user: ['GetLinuxEndpointsByADObjectId'],
  list_mac_endpoints_by_ad_user: ['GetMacEndpointsByADObjectId'],
  list_windows_endpoints_by_ad_user: ['GetWindowsEndpointsByADObjectId'],
};
