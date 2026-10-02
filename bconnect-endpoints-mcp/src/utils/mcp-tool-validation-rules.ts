/**
 * MCP Tool Validation Rules
 *
 * Centralized validation rules for all 121 MCP tools.
 * Organized by module for maintainability.
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
  listLogicalGroups: (): ValidationRule[] => [],

  // GET /LogicalGroups/{id}
  getLogicalGroup: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /LogicalGroups/{id}/Endpoints
  listGroupEndpoints: (): ValidationRule[] => [
    CommonRules.guid('logicalGroupId'),
    ...paginationRules()
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

  // POST /WindowsEndpoints, /LinuxEndpoints, etc.
  createEndpoint: (): ValidationRule[] => [
    CommonRules.displayName(true),
    CommonRules.comment()
  ],

  // PATCH /WindowsEndpoints/{id}, /LinuxEndpoints/{id}, etc.
  updateEndpoint: (): ValidationRule[] => [
    CommonRules.guid('id'),
    CommonRules.jsonPatch()
  ],

  // DELETE /WindowsEndpoints/{id}, /LinuxEndpoints/{id}, etc.
  deleteEndpoint: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // POST /LogicalGroups
  createLogicalGroup: (): ValidationRule[] => [
    {
      name: 'Name',
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 255
    },
    CommonRules.comment()
  ],

  // PATCH /LogicalGroups/{id}
  updateLogicalGroup: (): ValidationRule[] => [
    CommonRules.guid('id'),
    CommonRules.jsonPatch()
  ],

  // DELETE /LogicalGroups/{id}
  deleteLogicalGroup: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // POST /Endpoints/{id}/MaintenanceWindows
  createMaintenanceWindowForEndpoint: (): ValidationRule[] => [
    CommonRules.guid('id'),
    {
      name: 'maintenanceWindowData',
      required: true,
      type: 'object'
    }
  ],

  // PATCH /Endpoints/{id}/MaintenanceWindows
  updateMaintenanceWindowForEndpoint: (): ValidationRule[] => [
    CommonRules.guid('id'),
    {
      name: 'maintenanceWindowData',
      required: true,
      type: 'object'
    }
  ],

  // DELETE /Endpoints/{id}/MaintenanceWindows
  deleteMaintenanceWindowForEndpoint: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // POST /LogicalGroups/{id}/MaintenanceWindows
  createMaintenanceWindowForLogicalGroup: (): ValidationRule[] => [
    CommonRules.guid('id'),
    {
      name: 'maintenanceWindowData',
      required: true,
      type: 'object'
    }
  ],

  // PATCH /LogicalGroups/{id}/MaintenanceWindows
  updateMaintenanceWindowForLogicalGroup: (): ValidationRule[] => [
    CommonRules.guid('id'),
    {
      name: 'maintenanceWindowData',
      required: true,
      type: 'object'
    }
  ],

  // DELETE /LogicalGroups/{id}/MaintenanceWindows
  deleteMaintenanceWindowForLogicalGroup: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // POST /IndustrialEndpoints, /NetworkEndpoints
  createSpecializedEndpoint: (): ValidationRule[] => [
    {
      name: 'endpointData',
      required: true,
      type: 'object'
    }
  ],

  // PATCH /IndustrialEndpoints/{id}, /NetworkEndpoints/{id}
  updateSpecializedEndpoint: (): ValidationRule[] => [
    CommonRules.guid('id'),
    {
      name: 'updateData',
      required: true,
      type: 'object'
    }
  ],

  // Phase 24: GET /Endpoints/{endpointId}/EntraIdData, DELETE
  getByEndpointId: (): ValidationRule[] => [
    CommonRules.guid('endpointId')
  ],

  // Phase 24: POST /Endpoints/{endpointId}/EntraIdData (link)
  linkEntraIdData: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    CommonRules.guid('deviceId')
  ]
};

/**
 * Active Directory API Validation Rules
 */
export const ActiveDirectoryRules = {
  // GET /ADUsers
  listADUsers: (): ValidationRule[] => paginationRules(),

  // GET /ADUsers/{id}
  getADUser: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /ADGroups
  listADGroups: (): ValidationRule[] => paginationRules(),

  // GET /ADGroups/{id}
  getADGroup: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /ADObjects/{id}/ADGroupMemberships
  getADObjectMemberships: (): ValidationRule[] => [
    CommonRules.guid('id'),
    ...paginationRules()
  ]
};

/**
 * Server Management API Validation Rules
 */
export const ServerManagementRules = {
  // GET /Server/State
  getServerState: (): ValidationRule[] => [],

  // GET /Server/Version
  getServerVersion: (): ValidationRule[] => [],

  // POST /Server/Stop
  stopServer: (): ValidationRule[] => [],

  // POST /Server/Restart
  restartServer: (): ValidationRule[] => [],

  // GET /ManagementServer
  getManagementServer: (): ValidationRule[] => [],

  // GET /Gateway
  getGateway: (): ValidationRule[] => [],

  // GET /DipStatus
  getDipStatus: (): ValidationRule[] => [],

  // GET /VpnAppliance
  getVpnAppliance: (): ValidationRule[] => [],

  // GET /Microservices
  listMicroservices: (): ValidationRule[] => paginationRules(),

  // GET /Microservices/{id}
  getMicroservice: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /CloudConnectors
  listCloudConnectors: (): ValidationRule[] => paginationRules(),

  // GET /PxeRelays
  listPxeRelays: (): ValidationRule[] => paginationRules(),

  // GET /SecurityGroups
  listSecurityGroups: (): ValidationRule[] => paginationRules(),

  // GET /SecurityGroups/{id}
  getSecurityGroup: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // POST /SecurityGroups
  createSecurityGroup: (): ValidationRule[] => [
    CommonRules.displayName(true),
    CommonRules.comment()
  ],

  // PATCH /SecurityGroups/{id}
  updateSecurityGroup: (): ValidationRule[] => [
    CommonRules.guid('id'),
    CommonRules.jsonPatch()
  ],

  // DELETE /SecurityGroups/{id}
  deleteSecurityGroup: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // POST /Server/Restart
  restartManagementServer: (): ValidationRule[] => [
    {
      name: 'delayMinutes',
      required: false,
      type: 'number',
      min: 0,
      max: 1440
    }
  ],

  // POST /Server/CancelScheduledRestart
  cancelScheduledRestart: (): ValidationRule[] => [],

  // POST /Microservices/{id}/Start
  startMicroservice: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // POST /Microservices/{id}/Stop
  stopMicroservice: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // POST /Microservices/{id}/Restart
  restartMicroservice: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // POST /SecurityProfiles
  createSecurityProfile: (): ValidationRule[] => [
    {
      name: 'name',
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 255
    },
    CommonRules.comment()
  ],

  // PATCH /SecurityProfiles/{id}
  updateSecurityProfile: (): ValidationRule[] => [
    CommonRules.guid('id'),
    CommonRules.jsonPatch()
  ],

  // DELETE /SecurityProfiles/{id}
  deleteSecurityProfile: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // PATCH /ObjectPermissions/{id}
  updateObjectPermission: (): ValidationRule[] => [
    CommonRules.guid('id'),
    {
      name: 'permissionData',
      required: true,
      type: 'object'
    }
  ],

  // GET /SecurityProfiles
  listSecurityProfiles: (): ValidationRule[] => paginationRules(),

  // GET /SecurityProfiles/{id}
  getSecurityProfile: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /ObjectAccessRights/{objectId}
  getObjectAccessRights: (): ValidationRule[] => [
    CommonRules.guid('objectId')
  ]
};

/**
 * Variables API Validation Rules
 */
export const VariablesRules = {
  // GET /VariableDefinitions
  listVariableDefinitions: (): ValidationRule[] => paginationRules(),

  // GET /VariableDefinitions/{id}
  getVariableDefinition: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /VariableInstances
  listVariableInstances: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    ...paginationRules()
  ],

  // POST /VariableDefinitions
  createVariableDefinition: (): ValidationRule[] => [
    {
      name: 'Name',
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 255
    },
    {
      name: 'Type',
      required: true,
      type: 'string',
      enum: ['String', 'Integer', 'Boolean', 'DateTime']
    }
  ],

  // PATCH /VariableDefinitions/{id}
  updateVariableDefinition: (): ValidationRule[] => [
    CommonRules.guid('id'),
    CommonRules.jsonPatch()
  ],

  // DELETE /VariableDefinitions/{id}
  deleteVariableDefinition: (): ValidationRule[] => [
    CommonRules.guid('id')
  ]
};

/**
 * Defense Control API Validation Rules
 */
export const DefenseControlRules = {
  // GET /BitLocker/WindowsEndpoints
  listBitLockerEndpoints: (): ValidationRule[] => paginationRules(),

  // GET /BitLocker/WindowsEndpoints/{id}
  getBitLockerEndpoint: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /MicrosoftDefender/Threats
  listMicrosoftDefenderThreats: (): ValidationRule[] => paginationRules(),

  // GET /MicrosoftDefender/Threats/{id}
  getMicrosoftDefenderThreat: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /MicrosoftDefender/WindowsEndpoints
  listMicrosoftDefenderEndpoints: (): ValidationRule[] => paginationRules()
};

/**
 * Operating Systems API Validation Rules
 */
export const OperatingSystemsRules = {
  // GET /WindowsEndpoints
  listWindowsEndpoints: (): ValidationRule[] => paginationRules(),

  // GET /WindowsEndpoints/{id}
  getWindowsEndpoint: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // POST /Folders
  createOsFolder: (): ValidationRule[] => [
    {
      name: 'folderData',
      required: true,
      type: 'object'
    }
  ],

  // PATCH /Folders/{id}
  updateOsFolder: (): ValidationRule[] => [
    CommonRules.guid('id'),
    {
      name: 'updateData',
      required: true,
      type: 'object'
    }
  ],

  // DELETE /Folders/{id}
  deleteOsFolder: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // PATCH /WindowsEndpoints/{id}/OSInstall
  updateOsWindowsEndpoint: (): ValidationRule[] => [
    CommonRules.guid('id'),
    {
      name: 'updateData',
      required: true,
      type: 'object'
    }
  ]
};

/**
 * Software API Validation Rules
 */
export const SoftwareRules = {
  // GET /InstalledWindowsSoftware
  listInstalledWindowsSoftware: (): ValidationRule[] => paginationRules()
};

/**
 * Update Management API Validation Rules
 */
export const UpdateManagementRules = {
  // GET /WindowsEndpoints
  listWindowsEndpoints: (): ValidationRule[] => paginationRules(),

  // GET /WindowsEndpoints/{id}
  getWindowsEndpoint: (): ValidationRule[] => [
    CommonRules.guid('id')
  ]
};

/**
 * V1.1 API Validation Rules
 */
export const V11Rules = {
  // BitLocker V1.1
  getBitLockerSecrets: (): ValidationRule[] => [
    CommonRules.guid('endpointId')
  ],

  getRecoveryKeys: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    {
      name: 'volumeGuid',
      required: true,
      type: 'string',
      minLength: 1
    }
  ],

  getTPMOwnerPasswords: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    {
      name: 'volumeGuid',
      required: true,
      type: 'string',
      minLength: 1
    }
  ],

  getBitLockerPins: (): ValidationRule[] => [
    CommonRules.guid('endpointId')
  ],

  getSecretByVolume: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    {
      name: 'volumeGuid',
      required: true,
      type: 'string',
      minLength: 1
    }
  ],

  getRecoveryKey: (): ValidationRule[] => [
    CommonRules.guid('endpointId'),
    {
      name: 'volumeId',
      required: true,
      type: 'string',
      minLength: 1
    }
  ],

  // SSH V1.1
  getSSHInfo: (): ValidationRule[] => [
    CommonRules.guid('endpointId')
  ],

  // Compliance Violations V1.1
  listComplianceViolations: (): ValidationRule[] => [],

  getComplianceViolation: (): ValidationRule[] => [
    {
      name: 'id',
      required: true,
      type: 'string',
      minLength: 1
    }
  ],

  getComplianceViolationsByEndpoint: (): ValidationRule[] => [
    CommonRules.guid('endpointId')
  ],

  getComplianceViolationsByVulnerability: (): ValidationRule[] => [
    {
      name: 'vulnerabilityId',
      required: true,
      type: 'string',
      minLength: 1
    }
  ],

  // Inventory V1.1
  getFileScans: (): ValidationRule[] => [
    CommonRules.guid('endpointId')
  ],

  getWMIScans: (): ValidationRule[] => [
    CommonRules.guid('endpointId')
  ],

  getCustomScans: (): ValidationRule[] => [
    CommonRules.guid('endpointId')
  ],

  getHardwareScans: (): ValidationRule[] => [
    CommonRules.guid('endpointId')
  ],

  getSNMPScans: (): ValidationRule[] => [
    CommonRules.guid('endpointId')
  ],

  // VPP V1.1
  listVPPUsers: (): ValidationRule[] => [],

  getVPPUser: (): ValidationRule[] => [
    {
      name: 'userGuid',
      required: true,
      type: 'string',
      minLength: 1
    }
  ],

  createVPPUser: (): ValidationRule[] => [
    {
      name: 'clientUserIdStr',
      required: true,
      type: 'string',
      minLength: 1
    }
  ],

  deleteVPPUser: (): ValidationRule[] => [
    {
      name: 'userGuid',
      required: true,
      type: 'string',
      minLength: 1
    }
  ],

  listVPPLicenseAssociations: (): ValidationRule[] => [],

  assignVPPLicense: (): ValidationRule[] => [
    {
      name: 'appGuid',
      required: true,
      type: 'string',
      minLength: 1
    },
    {
      name: 'vppUserGuid',
      required: true,
      type: 'string',
      minLength: 1
    }
  ],

  revokeVPPLicense: (): ValidationRule[] => [
    {
      name: 'associationGuid',
      required: true,
      type: 'string',
      minLength: 1
    }
  ],

  listVPPLicenses: (): ValidationRule[] => [],

  revokeLicense: (): ValidationRule[] => [
    {
      name: 'adamId',
      required: true,
      type: 'string',
      minLength: 1
    },
    {
      name: 'serialNumber',
      required: true,
      type: 'string',
      minLength: 1
    }
  ],

  getVPPAssets: (): ValidationRule[] => [],

  // Setup Integrity V1.1
  getBfcrxIntegrity: (): ValidationRule[] => [],

  getAgentSetupIntegrity: (): ValidationRule[] => []
};

/**
 * Documentation Search Validation Rules
 */
export const DocumentationSearchRules = {
  searchDocumentation: (): ValidationRule[] => [
    {
      name: 'query',
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 1000
    },
    {
      name: 'source',
      required: false,
      type: 'string',
      enum: ['forum', 'feedback', 'release-notes', 'preview', 'website', 'all']
    },
    {
      name: 'type',
      required: false,
      type: 'string',
      enum: ['faq', 'kb', 'idea']
    },
    {
      name: 'limit',
      required: false,
      type: 'number',
      min: 1,
      max: 100
    }
  ],

  getDocumentationItem: (): ValidationRule[] => [
    {
      name: 'id',
      required: true,
      type: 'string',
      minLength: 1
    }
  ],

  listDocumentationSources: (): ValidationRule[] => [],

  getPopularTopics: (): ValidationRule[] => [
    {
      name: 'limit',
      required: false,
      type: 'number',
      min: 1,
      max: 100
    }
  ],

  searchKnownIssues: (): ValidationRule[] => [
    {
      name: 'query',
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 500
    },
    {
      name: 'limit',
      required: false,
      type: 'number',
      min: 1,
      max: 100
    }
  ],

  getKnownIssuesSummary: (): ValidationRule[] => []
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
  get_entra_id_data: () => [CommonRules.guid('endpointId')],
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
  link_entra_id_data: () => [CommonRules.guid('endpointId'), CommonRules.guid('deviceId')],
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
  list_unmanaged_endpoints: EndpointsRules.listPlatformEndpoints,
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
