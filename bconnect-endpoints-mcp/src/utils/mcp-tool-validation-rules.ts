/**
 * MCP Tool Validation Rules — bconnect-endpoints-mcp
 *
 * Input validation rules for this server's tools (`TOOL_RULES`).
 */

import { ValidationRule, CommonRules } from "@bconnect/mcp-core";
import { updateRules } from "../update-fields.js";
import { createRules } from "../create-fields.js";

/**
 * Common pagination parameters used across many tools
 */
export const paginationRules = (): ValidationRule[] => [
  CommonRules.page(),
  CommonRules.pageSize(),
  CommonRules.searchQuery(),
  CommonRules.orderBy()
];

/**
 * Endpoints API Validation Rules
 */
export const EndpointsRules = {
  // GET /endpoints
  listEndpoints: (): ValidationRule[] => [
    ...paginationRules(),
    CommonRules.displayName(false)
  ],

  // GET /endpoints/{id}
  getEndpoint: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /WindowsEndpoints, /LinuxEndpoints, /MacEndpoints, /AndroidEndpoints, /IOSEndpoints
  listPlatformEndpoints: (): ValidationRule[] => paginationRules(),

  // GET /WindowsEndpoints/{id} etc.
  getPlatformEndpoint: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /UnmanagedEndpoints (the route takes no query parameters)
  listUnmanagedEndpoints: (): ValidationRule[] => [],

  // GET /IndustrialEndpoints
  listIndustrialEndpoints: (): ValidationRule[] => paginationRules(),

  // GET /IndustrialEndpoints/{id}
  getIndustrialEndpoint: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /NetworkEndpoints
  listNetworkEndpoints: (): ValidationRule[] => paginationRules(),

  // GET /NetworkEndpoints/{id}
  getNetworkEndpoint: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /LogicalGroups
  listLogicalGroups: (): ValidationRule[] => paginationRules(),

  // GET /LogicalGroups/{id}
  getLogicalGroup: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /LogicalGroups/{logicalGroupId}/Endpoints (all endpoint types)
  listEndpointsByLogicalGroup: (): ValidationRule[] => [
    CommonRules.guid('logicalGroupId'),
    ...paginationRules()
  ],

  // GET /LogicalGroups/{logicalGroupId}/WindowsEndpoints
  listWindowsEndpointsByLogicalGroup: (): ValidationRule[] => [
    CommonRules.guid('logicalGroupId'),
    ...paginationRules()
  ],

  // GET /LinuxEndpoints/{id}
  getLinuxEndpoint: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /MacEndpoints/{id}
  getMacEndpoint: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // POST /AndroidEndpoints/{id}/StartEnrollment
  startAndroidEnrollment: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // POST /IosEndpoints/{id}/StartEnrollment
  startIosEnrollment: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // DELETE /WindowsEndpoints/{id}, /LinuxEndpoints/{id}, etc.
  deleteEndpoint: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // DELETE /LogicalGroups/{id}
  deleteLogicalGroup: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // DELETE /Endpoints/{id}/MaintenanceWindows
  deleteMaintenanceWindowForEndpoint: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // DELETE /LogicalGroups/{id}/MaintenanceWindows
  deleteMaintenanceWindowForLogicalGroup: (): ValidationRule[] => [
    CommonRules.guid('id')
  ]
};

/**
 * Validation rules per registered tool (REQ-SRV-018). The server validates a
 * tool's arguments with these before any request; a tool missing here fails
 * the tool-argument guard test instead of passing unchecked.
 */
export const TOOL_RULES: Record<string, () => ValidationRule[]> = {
  create_android_endpoint: () => [CommonRules.guidOptional('logicalGroupId')],
  create_industrial_endpoint: () => createRules("create_industrial_endpoint"),
  create_ios_endpoint: () => [CommonRules.guidOptional('logicalGroupId')],
  create_linux_endpoint: () => createRules("create_linux_endpoint"),
  create_logical_group: () => [CommonRules.guidOptional('parentId')],
  create_mac_endpoint: () => [CommonRules.guidOptional('logicalGroupId')],
  create_maintenance_window_for_endpoint: () => createRules("create_maintenance_window_for_endpoint"),
  create_maintenance_window_for_logical_group: () => createRules("create_maintenance_window_for_logical_group"),
  create_network_endpoint: () => createRules("create_network_endpoint"),
  create_windows_endpoint: () => createRules("create_windows_endpoint"),
  delete_android_endpoint: EndpointsRules.deleteEndpoint,
  delete_endpoint: EndpointsRules.deleteEndpoint,
  delete_industrial_endpoint: EndpointsRules.deleteEndpoint,
  delete_ios_endpoint: EndpointsRules.deleteEndpoint,
  delete_linux_endpoint: EndpointsRules.deleteEndpoint,
  delete_logical_group: EndpointsRules.deleteLogicalGroup,
  delete_mac_endpoint: EndpointsRules.deleteEndpoint,
  delete_maintenance_window_for_endpoint: EndpointsRules.deleteMaintenanceWindowForEndpoint,
  delete_maintenance_window_for_logical_group: EndpointsRules.deleteMaintenanceWindowForLogicalGroup,
  delete_network_endpoint: EndpointsRules.deleteEndpoint,
  delete_unmanaged_endpoint: () => [CommonRules.guid('id')],
  delete_windows_endpoint: EndpointsRules.deleteEndpoint,
  get_android_endpoint: EndpointsRules.getPlatformEndpoint,
  get_endpoint: EndpointsRules.getEndpoint,
  get_entra_id_data: () => [CommonRules.guid('deviceId')],
  get_industrial_endpoint: EndpointsRules.getIndustrialEndpoint,
  get_ios_endpoint: EndpointsRules.getPlatformEndpoint,
  get_linux_endpoint: EndpointsRules.getLinuxEndpoint,
  get_logical_group: EndpointsRules.getLogicalGroup,
  get_mac_endpoint: EndpointsRules.getMacEndpoint,
  get_maintenance_window_for_endpoint: () => [CommonRules.guid('id')],
  get_maintenance_window_for_logical_group: () => [CommonRules.guid('id')],
  get_network_endpoint: EndpointsRules.getNetworkEndpoint,
  get_unmanaged_endpoint: () => [CommonRules.guid('id')],
  get_windows_endpoint: EndpointsRules.getPlatformEndpoint,
  link_entra_id_data: () => [CommonRules.guid('endpointId'), CommonRules.guid('entraIdDeviceId'), CommonRules.guid('entraIdTenantId'), CommonRules.guid('entraIdUserId')],
  list_android_endpoints: EndpointsRules.listPlatformEndpoints,
  list_endpoints: EndpointsRules.listEndpoints,
  list_endpoints_by_logical_group: EndpointsRules.listEndpointsByLogicalGroup,
  list_group_endpoints: () => [CommonRules.guid('logicalGroupId'), CommonRules.pageSize()],
  list_industrial_endpoints: EndpointsRules.listIndustrialEndpoints,
  list_ios_endpoints: EndpointsRules.listPlatformEndpoints,
  list_linux_endpoints: () => [CommonRules.searchQuery(), CommonRules.pageSize()],
  list_logical_groups: EndpointsRules.listLogicalGroups,
  list_mac_endpoints: () => [CommonRules.searchQuery(), CommonRules.pageSize()],
  list_network_endpoints: EndpointsRules.listNetworkEndpoints,
  list_unmanaged_endpoints: EndpointsRules.listUnmanagedEndpoints,
  list_windows_endpoints: () => [CommonRules.searchQuery(), CommonRules.pageSize()],
  list_windows_endpoints_by_logical_group: EndpointsRules.listWindowsEndpointsByLogicalGroup,
  search_endpoints: () => [],
  start_android_enrollment: EndpointsRules.startAndroidEnrollment,
  start_ios_enrollment: EndpointsRules.startIosEnrollment,
  start_mac_enrollment: () => createRules("start_mac_enrollment"),
  start_windows_enrollment: () => createRules("start_windows_enrollment"),
  trigger_intune_installation: EndpointsRules.getPlatformEndpoint,
  unlink_entra_id_data: () => [CommonRules.guid('endpointId')],
  update_android_endpoint: () => [CommonRules.guid('id'), CommonRules.guidOptional('logicalGroupId')],
  update_industrial_endpoint: () => updateRules("update_industrial_endpoint"),
  update_ios_endpoint: () => [CommonRules.guid('id'), CommonRules.guidOptional('logicalGroupId')],
  update_linux_endpoint: () => updateRules("update_linux_endpoint"),
  update_logical_group: () => updateRules("update_logical_group"),
  update_mac_endpoint: () => updateRules("update_mac_endpoint"),
  update_maintenance_window_for_endpoint: () => updateRules("update_maintenance_window_for_endpoint"),
  update_maintenance_window_for_logical_group: () => updateRules("update_maintenance_window_for_logical_group"),
  update_network_endpoint: () => updateRules("update_network_endpoint"),
  update_windows_endpoint: () => updateRules("update_windows_endpoint"),
};
