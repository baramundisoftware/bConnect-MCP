/**
 * MCP Tool Validation Rules — bconnect-groups-mcp
 *
 * Input validation rules for all 33 group-scoped endpoint query tools.
 */

import { ValidationRule, CommonRules } from "@bconnect/mcp-core";

const paginationRules = (): ValidationRule[] => [
  CommonRules.page(),
  CommonRules.pageSize(),
  CommonRules.searchQuery(),
  CommonRules.orderBy(),
];

export const GroupsRules = {
  // ── Logical Group (9) ─────────────────────────────────────────────────────
  listEndpointsByLogicalGroup:          (): ValidationRule[] => [CommonRules.guid('logicalGroupId'),          ...paginationRules()],
  listAndroidEndpointsByLogicalGroup:   (): ValidationRule[] => [CommonRules.guid('logicalGroupId'),          ...paginationRules()],
  listIosEndpointsByLogicalGroup:       (): ValidationRule[] => [CommonRules.guid('logicalGroupId'),          ...paginationRules()],
  listLinuxEndpointsByLogicalGroup:     (): ValidationRule[] => [CommonRules.guid('logicalGroupId'),          ...paginationRules()],
  listMacEndpointsByLogicalGroup:       (): ValidationRule[] => [CommonRules.guid('logicalGroupId'),          ...paginationRules()],
  listNetworkEndpointsByLogicalGroup:   (): ValidationRule[] => [CommonRules.guid('logicalGroupId'),          ...paginationRules()],
  listWindowsEndpointsByLogicalGroup:   (): ValidationRule[] => [CommonRules.guid('logicalGroupId'),          ...paginationRules()],
  listIndustrialEndpointsByLogicalGroup:(): ValidationRule[] => [CommonRules.guid('logicalGroupId'),          ...paginationRules()],
  listLogicalGroupsByLogicalGroup:      (): ValidationRule[] => [CommonRules.guid('logicalGroupId'),          ...paginationRules()],

  // ── Static Group (8) ──────────────────────────────────────────────────────
  listEndpointsByStaticGroup:          (): ValidationRule[] => [CommonRules.guid('staticGroupId'),            ...paginationRules()],
  listAndroidEndpointsByStaticGroup:   (): ValidationRule[] => [CommonRules.guid('staticGroupId'),            ...paginationRules()],
  listIosEndpointsByStaticGroup:       (): ValidationRule[] => [CommonRules.guid('staticGroupId'),            ...paginationRules()],
  listLinuxEndpointsByStaticGroup:     (): ValidationRule[] => [CommonRules.guid('staticGroupId'),            ...paginationRules()],
  listMacEndpointsByStaticGroup:       (): ValidationRule[] => [CommonRules.guid('staticGroupId'),            ...paginationRules()],
  listNetworkEndpointsByStaticGroup:   (): ValidationRule[] => [CommonRules.guid('staticGroupId'),            ...paginationRules()],
  listWindowsEndpointsByStaticGroup:   (): ValidationRule[] => [CommonRules.guid('staticGroupId'),            ...paginationRules()],
  listIndustrialEndpointsByStaticGroup:(): ValidationRule[] => [CommonRules.guid('staticGroupId'),            ...paginationRules()],

  // ── Dynamic Group (2) ─────────────────────────────────────────────────────
  listEndpointsByDynamicGroup:         (): ValidationRule[] => [CommonRules.guid('dynamicGroupId'),           ...paginationRules()],
  listWindowsEndpointsByDynamicGroup:  (): ValidationRule[] => [CommonRules.guid('dynamicGroupId'),           ...paginationRules()],

  // ── Universal Dynamic Group (8) ───────────────────────────────────────────
  listEndpointsByUDG:                  (): ValidationRule[] => [CommonRules.guid('universalDynamicGroupId'),  ...paginationRules()],
  listAndroidEndpointsByUDG:           (): ValidationRule[] => [CommonRules.guid('universalDynamicGroupId'),  ...paginationRules()],
  listIosEndpointsByUDG:               (): ValidationRule[] => [CommonRules.guid('universalDynamicGroupId'),  ...paginationRules()],
  listLinuxEndpointsByUDG:             (): ValidationRule[] => [CommonRules.guid('universalDynamicGroupId'),  ...paginationRules()],
  listMacEndpointsByUDG:               (): ValidationRule[] => [CommonRules.guid('universalDynamicGroupId'),  ...paginationRules()],
  listNetworkEndpointsByUDG:           (): ValidationRule[] => [CommonRules.guid('universalDynamicGroupId'),  ...paginationRules()],
  listWindowsEndpointsByUDG:           (): ValidationRule[] => [CommonRules.guid('universalDynamicGroupId'),  ...paginationRules()],
  listIndustrialEndpointsByUDG:        (): ValidationRule[] => [CommonRules.guid('universalDynamicGroupId'),  ...paginationRules()],

  // ── AD User (6) ───────────────────────────────────────────────────────────
  listEndpointsByADUser:               (): ValidationRule[] => [CommonRules.guid('adUserId'),                 ...paginationRules()],
  listAndroidEndpointsByADUser:        (): ValidationRule[] => [CommonRules.guid('adUserId'),                 ...paginationRules()],
  listIosEndpointsByADUser:            (): ValidationRule[] => [CommonRules.guid('adUserId'),                 ...paginationRules()],
  listLinuxEndpointsByADUser:          (): ValidationRule[] => [CommonRules.guid('adUserId'),                 ...paginationRules()],
  listMacEndpointsByADUser:            (): ValidationRule[] => [CommonRules.guid('adUserId'),                 ...paginationRules()],
  listWindowsEndpointsByADUser:        (): ValidationRule[] => [CommonRules.guid('adUserId'),                 ...paginationRules()],
};

/**
 * Validation rules per registered tool (REQ-SRV-018). The server validates a
 * tool's arguments with these before any request; a tool missing here fails
 * the tool-argument guard test instead of passing unchecked.
 */
export const TOOL_RULES: Record<string, () => ValidationRule[]> = {
  list_android_endpoints_by_ad_user: GroupsRules.listAndroidEndpointsByADUser,
  list_android_endpoints_by_logical_group: GroupsRules.listAndroidEndpointsByLogicalGroup,
  list_android_endpoints_by_static_group: GroupsRules.listAndroidEndpointsByStaticGroup,
  list_android_endpoints_by_universal_dynamic_group: GroupsRules.listAndroidEndpointsByUDG,
  list_endpoints_by_ad_user: GroupsRules.listEndpointsByADUser,
  list_endpoints_by_dynamic_group: GroupsRules.listEndpointsByDynamicGroup,
  list_endpoints_by_logical_group: GroupsRules.listEndpointsByLogicalGroup,
  list_endpoints_by_static_group: GroupsRules.listEndpointsByStaticGroup,
  list_endpoints_by_universal_dynamic_group: GroupsRules.listEndpointsByUDG,
  list_industrial_endpoints_by_logical_group: GroupsRules.listIndustrialEndpointsByLogicalGroup,
  list_industrial_endpoints_by_static_group: GroupsRules.listIndustrialEndpointsByStaticGroup,
  list_industrial_endpoints_by_universal_dynamic_group: GroupsRules.listIndustrialEndpointsByUDG,
  list_ios_endpoints_by_ad_user: GroupsRules.listIosEndpointsByADUser,
  list_ios_endpoints_by_logical_group: GroupsRules.listIosEndpointsByLogicalGroup,
  list_ios_endpoints_by_static_group: GroupsRules.listIosEndpointsByStaticGroup,
  list_ios_endpoints_by_universal_dynamic_group: GroupsRules.listIosEndpointsByUDG,
  list_linux_endpoints_by_ad_user: GroupsRules.listLinuxEndpointsByADUser,
  list_linux_endpoints_by_logical_group: GroupsRules.listLinuxEndpointsByLogicalGroup,
  list_linux_endpoints_by_static_group: GroupsRules.listLinuxEndpointsByStaticGroup,
  list_linux_endpoints_by_universal_dynamic_group: GroupsRules.listLinuxEndpointsByUDG,
  list_logical_groups_by_logical_group: GroupsRules.listLogicalGroupsByLogicalGroup,
  list_mac_endpoints_by_ad_user: GroupsRules.listMacEndpointsByADUser,
  list_mac_endpoints_by_logical_group: GroupsRules.listMacEndpointsByLogicalGroup,
  list_mac_endpoints_by_static_group: GroupsRules.listMacEndpointsByStaticGroup,
  list_mac_endpoints_by_universal_dynamic_group: GroupsRules.listMacEndpointsByUDG,
  list_network_endpoints_by_logical_group: GroupsRules.listNetworkEndpointsByLogicalGroup,
  list_network_endpoints_by_static_group: GroupsRules.listNetworkEndpointsByStaticGroup,
  list_network_endpoints_by_universal_dynamic_group: GroupsRules.listNetworkEndpointsByUDG,
  list_windows_endpoints_by_ad_user: GroupsRules.listWindowsEndpointsByADUser,
  list_windows_endpoints_by_dynamic_group: GroupsRules.listWindowsEndpointsByDynamicGroup,
  list_windows_endpoints_by_logical_group: GroupsRules.listWindowsEndpointsByLogicalGroup,
  list_windows_endpoints_by_static_group: GroupsRules.listWindowsEndpointsByStaticGroup,
  list_windows_endpoints_by_universal_dynamic_group: GroupsRules.listWindowsEndpointsByUDG,
};
