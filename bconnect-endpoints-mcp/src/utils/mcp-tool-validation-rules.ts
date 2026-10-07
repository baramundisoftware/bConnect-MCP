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
 * Validation rules per registered tool, and per route (variant key) of a merged
 * tool (REQ-SRV-018, REQ-SRV-029). The server validates a
 * tool's arguments with these before any request; a tool missing here fails
 * the tool-argument guard test instead of passing unchecked.
 */
export const TOOL_RULES: Record<string, () => ValidationRule[]> = {
  // One entry per route of a merged tool, by its variant key (REQ-SRV-029).
  "list_endpoints[type=]": EndpointsRules.listEndpoints,
  "list_endpoints[type=WindowsEndpoint]": () => [CommonRules.searchQuery(), CommonRules.pageSize()],
  "list_endpoints[type=MacEndpoint]": () => [CommonRules.searchQuery(), CommonRules.pageSize()],
  "list_endpoints[type=AndroidEndpoint]": EndpointsRules.listPlatformEndpoints,
  "list_endpoints[type=IOSEndpoint]": EndpointsRules.listPlatformEndpoints,
  "list_endpoints[type=LinuxEndpoint]": () => [CommonRules.searchQuery(), CommonRules.pageSize()],
  "list_endpoints[type=NetworkEndpoint]": EndpointsRules.listNetworkEndpoints,
  "list_endpoints[type=IndustrialEndpoint]": EndpointsRules.listIndustrialEndpoints,
  "get_endpoint[type=]": EndpointsRules.getEndpoint,
  "get_endpoint[type=WindowsEndpoint]": EndpointsRules.getPlatformEndpoint,
  "get_endpoint[type=MacEndpoint]": EndpointsRules.getMacEndpoint,
  "get_endpoint[type=AndroidEndpoint]": EndpointsRules.getPlatformEndpoint,
  "get_endpoint[type=IOSEndpoint]": EndpointsRules.getPlatformEndpoint,
  "get_endpoint[type=LinuxEndpoint]": EndpointsRules.getLinuxEndpoint,
  "get_endpoint[type=NetworkEndpoint]": EndpointsRules.getNetworkEndpoint,
  "get_endpoint[type=IndustrialEndpoint]": EndpointsRules.getIndustrialEndpoint,
  "delete_endpoint[type=]": EndpointsRules.deleteEndpoint,
  "delete_endpoint[type=WindowsEndpoint]": EndpointsRules.deleteEndpoint,
  "delete_endpoint[type=MacEndpoint]": EndpointsRules.deleteEndpoint,
  "delete_endpoint[type=AndroidEndpoint]": EndpointsRules.deleteEndpoint,
  "delete_endpoint[type=IOSEndpoint]": EndpointsRules.deleteEndpoint,
  "delete_endpoint[type=LinuxEndpoint]": EndpointsRules.deleteEndpoint,
  "delete_endpoint[type=NetworkEndpoint]": EndpointsRules.deleteEndpoint,
  "delete_endpoint[type=IndustrialEndpoint]": EndpointsRules.deleteEndpoint,
  "update_endpoint[type=WindowsEndpoint]": () => updateRules("update_endpoint[type=WindowsEndpoint]"),
  "update_endpoint[type=MacEndpoint]": () => updateRules("update_endpoint[type=MacEndpoint]"),
  "update_endpoint[type=AndroidEndpoint]": () => updateRules("update_endpoint[type=AndroidEndpoint]"),
  "update_endpoint[type=IOSEndpoint]": () => updateRules("update_endpoint[type=IOSEndpoint]"),
  "update_endpoint[type=LinuxEndpoint]": () => updateRules("update_endpoint[type=LinuxEndpoint]"),
  "update_endpoint[type=NetworkEndpoint]": () => updateRules("update_endpoint[type=NetworkEndpoint]"),
  "update_endpoint[type=IndustrialEndpoint]": () => updateRules("update_endpoint[type=IndustrialEndpoint]"),
  "start_enrollment[type=WindowsEndpoint]": () => createRules("start_enrollment[type=WindowsEndpoint]"),
  "start_enrollment[type=MacEndpoint]": () => createRules("start_enrollment[type=MacEndpoint]"),
  "start_enrollment[type=AndroidEndpoint]": EndpointsRules.startAndroidEnrollment,
  "start_enrollment[type=IOSEndpoint]": EndpointsRules.startIosEnrollment,
  "list_endpoints_by_logical_group[type=]": EndpointsRules.listEndpointsByLogicalGroup,
  "list_endpoints_by_logical_group[type=WindowsEndpoint]": EndpointsRules.listWindowsEndpointsByLogicalGroup,
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
  delete_logical_group: EndpointsRules.deleteLogicalGroup,
  delete_maintenance_window_for_endpoint: EndpointsRules.deleteMaintenanceWindowForEndpoint,
  delete_maintenance_window_for_logical_group: EndpointsRules.deleteMaintenanceWindowForLogicalGroup,
  delete_unmanaged_endpoint: () => [CommonRules.guid('id')],
  get_entra_id_data: () => [CommonRules.guid('deviceId')],
  get_logical_group: EndpointsRules.getLogicalGroup,
  get_maintenance_window_for_endpoint: () => [CommonRules.guid('id')],
  get_maintenance_window_for_logical_group: () => [CommonRules.guid('id')],
  get_unmanaged_endpoint: () => [CommonRules.guid('id')],
  link_entra_id_data: () => [CommonRules.guid('endpointId'), CommonRules.guid('entraIdDeviceId'), CommonRules.guid('entraIdTenantId'), CommonRules.guid('entraIdUserId')],
  list_logical_groups: EndpointsRules.listLogicalGroups,
  list_unmanaged_endpoints: EndpointsRules.listUnmanagedEndpoints,
  trigger_intune_installation: EndpointsRules.getPlatformEndpoint,
  unlink_entra_id_data: () => [CommonRules.guid('endpointId')],
  update_logical_group: () => updateRules("update_logical_group"),
  update_maintenance_window_for_endpoint: () => updateRules("update_maintenance_window_for_endpoint"),
  update_maintenance_window_for_logical_group: () => updateRules("update_maintenance_window_for_logical_group"),
};
