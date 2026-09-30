/**
 * MCP Tool Validation Rules
 *
 * Centralized validation rules for all 121 MCP tools.
 * Organized by module for maintainability.
 */

import { ValidationRule, CommonRules, validateOrThrow } from "@bconnect/mcp-core";

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
  ]
};

/**
 * Jobs API Validation Rules
 */
export const JobsRules = {
  // GET /JobDefinitions
  listJobDefinitions: (): ValidationRule[] => paginationRules(),

  // GET /JobDefinitions/{id}
  getJobDefinition: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /JobInstances
  listJobInstances: (): ValidationRule[] => paginationRules(),

  // GET /JobInstances/{id}
  getJobInstance: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /JobInstances?endpointId={endpointId}
  listEndpointJobInstances: (): ValidationRule[] => [
    CommonRules.guid('endpointId')
  ],

  // GET /JobFolders
  listJobFolders: (): ValidationRule[] => [],

  // GET /JobFolders/{id}
  getJobFolder: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // GET /Folders/{folderId}/JobDefinitions
  listJobDefinitionsByFolder: (): ValidationRule[] => [
    CommonRules.guid('folderId'),
    ...paginationRules()
  ],

  // GET /JobDefinitions/{jobDefinitionId}/JobInstances
  listJobInstancesByDefinition: (): ValidationRule[] => [
    CommonRules.guid('jobDefinitionId'),
    ...paginationRules()
  ],

  // GET /LogicalGroups/{logicalGroupId}/JobInstances
  listJobInstancesByLogicalGroup: (): ValidationRule[] => [
    CommonRules.guid('logicalGroupId'),
    ...paginationRules()
  ],

  // POST /JobInstances
  createJobInstance: (): ValidationRule[] => [
    CommonRules.guid('jobDefinitionId'),
    CommonRules.guid('endpointId'),
    CommonRules.comment()
  ],

  // POST /JobFolders
  createJobFolder: (): ValidationRule[] => [
    {
      name: 'Name',
      required: true,
      type: 'string',
      minLength: 1,
      maxLength: 255
    },
    CommonRules.comment()
  ],

  // PATCH /JobInstances/{id}
  updateJobInstance: (): ValidationRule[] => [
    CommonRules.guid('id'),
    CommonRules.jsonPatch()
  ],

  // DELETE /JobInstances/{id}
  deleteJobInstance: (): ValidationRule[] => [
    CommonRules.guid('id')
  ],

  // POST /LogicalGroups/{id}/AssignJobDefinition etc.
  assignJob: (): ValidationRule[] => [
    CommonRules.guid('jobDefinitionId')
  ],

  // POST /KioskReleases
  releaseKioskJob: (): ValidationRule[] => [
    CommonRules.guid('jobDefinitionId')
  ],

  // Phase 26: GET /Folders/{folderId}/Folders
  listJobSubfolders: (): ValidationRule[] => [
    CommonRules.guid('folderId'),
    ...paginationRules()
  ],

  // Phase 26: GET /{context}/{id}/KioskReleases — generic factory
  listKioskReleasesByContext: (idField: string): ValidationRule[] => [
    CommonRules.guid(idField),
    ...paginationRules()
  ],

  // Phase 26: GET /StaticGroups/{id}/JobInstances, /DynamicGroups/{id}/JobInstances
  listJobInstancesByGroup: (idField: string): ValidationRule[] => [
    CommonRules.guid(idField),
    ...paginationRules()
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
 * Dispatch function — validates tool parameters by tool name.
 *
 * Centralises the mapping from MCP tool name → ValidationRule[].
 * Each case corresponds to one registered tool; the 10 tools listed
 * below (marked NEW) were added in the most recent feature increment.
 *
 * @param toolName  The MCP tool name (snake_case).
 * @param args      Raw arguments object from the MCP request.
 */
export function validateToolParameters(
  toolName: string,
  args: Record<string, unknown> | undefined
): void {
  switch (toolName) {
    // -----------------------------------------------------------------
    // Endpoints API
    // -----------------------------------------------------------------
    case 'list_endpoints':
      return validateOrThrow(args, EndpointsRules.listEndpoints());
    case 'get_endpoint':
      return validateOrThrow(args, EndpointsRules.getEndpoint());
    case 'search_endpoints':
      return validateOrThrow(args, EndpointsRules.listEndpoints());
    case 'list_windows_endpoints':
      return validateOrThrow(args, EndpointsRules.listPlatformEndpoints());
    case 'get_windows_endpoint':
      return validateOrThrow(args, EndpointsRules.getPlatformEndpoint());
    case 'list_linux_endpoints':
      return validateOrThrow(args, EndpointsRules.listPlatformEndpoints());
    case 'list_mac_endpoints':
      return validateOrThrow(args, EndpointsRules.listPlatformEndpoints());
    case 'list_logical_groups':
      return validateOrThrow(args, EndpointsRules.listLogicalGroups());
    case 'get_logical_group':
      return validateOrThrow(args, EndpointsRules.getLogicalGroup());
    case 'list_group_endpoints':
      return validateOrThrow(args, EndpointsRules.listGroupEndpoints());
    // NEW: list all endpoint types scoped to a logical group
    case 'list_endpoints_by_logical_group':
      return validateOrThrow(args, EndpointsRules.listEndpointsByLogicalGroup());
    // NEW: list Windows endpoints scoped to a logical group
    case 'list_windows_endpoints_by_logical_group':
      return validateOrThrow(args, EndpointsRules.listWindowsEndpointsByLogicalGroup());
    // NEW: get a single Linux endpoint by id
    case 'get_linux_endpoint':
      return validateOrThrow(args, EndpointsRules.getLinuxEndpoint());
    // NEW: get a single macOS endpoint by id
    case 'get_mac_endpoint':
      return validateOrThrow(args, EndpointsRules.getMacEndpoint());
    // NEW: start enrollment for an Android endpoint
    case 'start_android_enrollment':
      return validateOrThrow(args, EndpointsRules.startAndroidEnrollment());
    // NEW: start enrollment for an iOS endpoint
    case 'start_ios_enrollment':
      return validateOrThrow(args, EndpointsRules.startIosEnrollment());
    case 'create_android_endpoint':
    case 'create_windows_endpoint':
    case 'create_linux_endpoint':
    case 'create_mac_endpoint':
      return validateOrThrow(args, EndpointsRules.createEndpoint());
    case 'update_android_endpoint':
    case 'update_windows_endpoint':
    case 'update_linux_endpoint':
    case 'update_mac_endpoint':
      return validateOrThrow(args, EndpointsRules.updateEndpoint());
    case 'delete_android_endpoint':
    case 'delete_windows_endpoint':
    case 'delete_linux_endpoint':
    case 'delete_mac_endpoint':
    case 'delete_endpoint':
      return validateOrThrow(args, EndpointsRules.deleteEndpoint());
    case 'start_windows_enrollment':
    case 'start_mac_enrollment':
    case 'trigger_intune_installation':
    case 'get_android_endpoint':
    case 'get_ios_endpoint':
      return validateOrThrow(args, EndpointsRules.getPlatformEndpoint());
    case 'create_logical_group':
      return validateOrThrow(args, EndpointsRules.createLogicalGroup());
    case 'update_logical_group':
      return validateOrThrow(args, EndpointsRules.updateLogicalGroup());
    case 'delete_logical_group':
      return validateOrThrow(args, EndpointsRules.deleteLogicalGroup());
    case 'create_maintenance_window_for_endpoint':
      return validateOrThrow(args, EndpointsRules.createMaintenanceWindowForEndpoint());
    case 'update_maintenance_window_for_endpoint':
      return validateOrThrow(args, EndpointsRules.updateMaintenanceWindowForEndpoint());
    case 'delete_maintenance_window_for_endpoint':
      return validateOrThrow(args, EndpointsRules.deleteMaintenanceWindowForEndpoint());
    case 'create_maintenance_window_for_logical_group':
      return validateOrThrow(args, EndpointsRules.createMaintenanceWindowForLogicalGroup());
    case 'update_maintenance_window_for_logical_group':
      return validateOrThrow(args, EndpointsRules.updateMaintenanceWindowForLogicalGroup());
    case 'delete_maintenance_window_for_logical_group':
      return validateOrThrow(args, EndpointsRules.deleteMaintenanceWindowForLogicalGroup());
    case 'create_industrial_endpoint':
    case 'create_network_endpoint':
      return validateOrThrow(args, EndpointsRules.createSpecializedEndpoint());
    case 'update_industrial_endpoint':
    case 'update_network_endpoint':
      return validateOrThrow(args, EndpointsRules.updateSpecializedEndpoint());
    case 'delete_industrial_endpoint':
    case 'delete_network_endpoint':
      return validateOrThrow(args, EndpointsRules.deleteEndpoint());
    case 'list_industrial_endpoints':
      return validateOrThrow(args, EndpointsRules.listIndustrialEndpoints());
    case 'get_industrial_endpoint':
      return validateOrThrow(args, EndpointsRules.getIndustrialEndpoint());
    case 'list_network_endpoints':
      return validateOrThrow(args, EndpointsRules.listNetworkEndpoints());
    case 'get_network_endpoint':
      return validateOrThrow(args, EndpointsRules.getNetworkEndpoint());

    // -----------------------------------------------------------------
    // Jobs API
    // -----------------------------------------------------------------
    case 'list_job_definitions':
      return validateOrThrow(args, JobsRules.listJobDefinitions());
    case 'get_job_definition':
      return validateOrThrow(args, JobsRules.getJobDefinition());
    case 'list_job_instances':
      return validateOrThrow(args, JobsRules.listJobInstances());
    case 'list_endpoint_job_instances':
      return validateOrThrow(args, JobsRules.listEndpointJobInstances());
    case 'get_job_instance':
    case 'start_job_instance':
    case 'stop_job_instance':
    case 'resume_job_instance':
    case 'delete_job_instance':
      return validateOrThrow(args, JobsRules.getJobInstance());
    // NEW: list job instances for a specific job definition
    case 'list_job_instances_by_definition':
      return validateOrThrow(args, JobsRules.listJobInstancesByDefinition());
    // NEW: list job instances scoped to a logical group
    case 'list_job_instances_by_logical_group':
      return validateOrThrow(args, JobsRules.listJobInstancesByLogicalGroup());
    // NEW: list job definitions inside a specific folder
    case 'list_job_definitions_by_folder':
      return validateOrThrow(args, JobsRules.listJobDefinitionsByFolder());
    case 'create_job_instance':
      return validateOrThrow(args, JobsRules.createJobInstance());
    case 'create_job_folder':
      return validateOrThrow(args, JobsRules.createJobFolder());
    case 'update_job_folder':
    case 'delete_job_folder':
      return validateOrThrow(args, JobsRules.getJobFolder());
    case 'get_job_folder':
      return validateOrThrow(args, JobsRules.getJobFolder());
    case 'list_job_folders':
      return validateOrThrow(args, JobsRules.listJobFolders());
    case 'assign_job_to_logical_group':
    case 'assign_job_to_static_group':
    case 'assign_job_to_dynamic_group':
    case 'assign_job_to_universal_dynamic_group':
      return validateOrThrow(args, JobsRules.assignJob());
    case 'create_kiosk_release':
    case 'withdraw_kiosk_release':
      return validateOrThrow(args, JobsRules.releaseKioskJob());
    case 'list_kiosk_releases':
    case 'get_kiosk_release':
      return validateOrThrow(args, JobsRules.listJobInstances());

    // -----------------------------------------------------------------
    // Active Directory API
    // -----------------------------------------------------------------
    case 'list_ad_users':
      return validateOrThrow(args, ActiveDirectoryRules.listADUsers());
    case 'get_ad_user':
      return validateOrThrow(args, ActiveDirectoryRules.getADUser());
    case 'list_ad_groups':
      return validateOrThrow(args, ActiveDirectoryRules.listADGroups());
    case 'get_ad_group':
      return validateOrThrow(args, ActiveDirectoryRules.getADGroup());
    case 'list_ad_objects':
    case 'get_ad_object':
    case 'list_org_units':
    case 'get_org_unit':
    case 'list_ad_users_by_group':
    case 'list_ad_groups_by_org_unit':
      return validateOrThrow(args, ActiveDirectoryRules.getADUser());
    // NEW: get group memberships for any AD object
    case 'get_ad_object_memberships':
      return validateOrThrow(args, ActiveDirectoryRules.getADObjectMemberships());

    // -----------------------------------------------------------------
    // Server Management API
    // -----------------------------------------------------------------
    case 'get_management_server':
      return validateOrThrow(args, ServerManagementRules.getManagementServer());
    case 'get_gateway':
      return validateOrThrow(args, ServerManagementRules.getGateway());
    case 'get_dip_status':
      return validateOrThrow(args, ServerManagementRules.getDipStatus());
    case 'get_vpn_appliance':
      return validateOrThrow(args, ServerManagementRules.getVpnAppliance());
    case 'list_microservices':
      return validateOrThrow(args, ServerManagementRules.listMicroservices());
    case 'get_microservice':
      return validateOrThrow(args, ServerManagementRules.getMicroservice());
    case 'list_cloud_connectors':
      return validateOrThrow(args, ServerManagementRules.listCloudConnectors());
    case 'list_pxe_relays':
      return validateOrThrow(args, ServerManagementRules.listPxeRelays());
    case 'list_security_groups':
      return validateOrThrow(args, ServerManagementRules.listSecurityGroups());
    case 'get_security_group':
      return validateOrThrow(args, ServerManagementRules.getSecurityGroup());
    case 'create_security_group':
      return validateOrThrow(args, ServerManagementRules.createSecurityGroup());
    case 'update_security_group':
      return validateOrThrow(args, ServerManagementRules.updateSecurityGroup());
    case 'delete_security_group':
      return validateOrThrow(args, ServerManagementRules.deleteSecurityGroup());
    case 'restart_management_server':
      return validateOrThrow(args, ServerManagementRules.restartManagementServer());
    case 'cancel_scheduled_restart':
      return validateOrThrow(args, ServerManagementRules.cancelScheduledRestart());
    case 'start_microservice':
      return validateOrThrow(args, ServerManagementRules.startMicroservice());
    case 'stop_microservice':
      return validateOrThrow(args, ServerManagementRules.stopMicroservice());
    case 'restart_microservice':
      return validateOrThrow(args, ServerManagementRules.restartMicroservice());
    case 'create_security_profile':
      return validateOrThrow(args, ServerManagementRules.createSecurityProfile());
    case 'update_security_profile':
      return validateOrThrow(args, ServerManagementRules.updateSecurityProfile());
    case 'delete_security_profile':
      return validateOrThrow(args, ServerManagementRules.deleteSecurityProfile());
    case 'list_security_profiles':
      return validateOrThrow(args, ServerManagementRules.listSecurityProfiles());
    case 'get_security_profile':
      return validateOrThrow(args, ServerManagementRules.getSecurityProfile());
    case 'get_object_access_rights':
      return validateOrThrow(args, ServerManagementRules.getObjectAccessRights());
    case 'update_object_permission':
      return validateOrThrow(args, ServerManagementRules.updateObjectPermission());

    // -----------------------------------------------------------------
    // Variables API
    // -----------------------------------------------------------------
    case 'list_variable_definitions':
      return validateOrThrow(args, VariablesRules.listVariableDefinitions());
    case 'get_variable_definition':
      return validateOrThrow(args, VariablesRules.getVariableDefinition());
    case 'list_variable_instances':
    case 'list_variables_by_endpoint':
    case 'list_variables_by_logical_group':
    case 'list_variables_by_ad_object':
    case 'list_variables_by_windows_application':
    case 'list_variables_by_windows_job':
    case 'get_variable_instance':
    case 'update_variable_instance':
      return validateOrThrow(args, VariablesRules.listVariableInstances());
    case 'create_variable_definition':
      return validateOrThrow(args, VariablesRules.createVariableDefinition());
    case 'update_variable_definition':
      return validateOrThrow(args, VariablesRules.updateVariableDefinition());
    case 'delete_variable_definition':
      return validateOrThrow(args, VariablesRules.deleteVariableDefinition());

    // -----------------------------------------------------------------
    // Defense Control API
    // -----------------------------------------------------------------
    case 'list_bitlocker_windows_endpoints':
      return validateOrThrow(args, DefenseControlRules.listBitLockerEndpoints());
    case 'get_bitlocker_windows_endpoint':
      return validateOrThrow(args, DefenseControlRules.getBitLockerEndpoint());
    case 'get_local_admin_accounts':
    case 'trigger_local_admin_accounts_update':
    case 'patch_local_admin_user_credentials':
      return validateOrThrow(args, DefenseControlRules.getBitLockerEndpoint());
    case 'trigger_update_on_client':
      return validateOrThrow(args, DefenseControlRules.getBitLockerEndpoint());
    case 'list_defender_threats':
      return validateOrThrow(args, DefenseControlRules.listMicrosoftDefenderThreats());
    case 'get_defender_threat':
      return validateOrThrow(args, DefenseControlRules.getMicrosoftDefenderThreat());
    case 'list_defender_threats_by_endpoint':
    case 'list_defender_threats_by_logical_group':
    case 'list_defender_windows_endpoints':
      return validateOrThrow(args, DefenseControlRules.listMicrosoftDefenderEndpoints());
    case 'get_defender_windows_endpoint':
      return validateOrThrow(args, DefenseControlRules.getMicrosoftDefenderThreat());

    // -----------------------------------------------------------------
    // Operating Systems API
    // -----------------------------------------------------------------
    case 'list_os_windows_endpoints':
      return validateOrThrow(args, OperatingSystemsRules.listWindowsEndpoints());
    case 'get_os_windows_endpoint':
      return validateOrThrow(args, OperatingSystemsRules.getWindowsEndpoint());
    case 'list_os_folders':
    case 'list_os_folders_by_parent':
    case 'get_os_folder':
      return validateOrThrow(args, OperatingSystemsRules.getWindowsEndpoint());
    case 'create_os_folder':
      return validateOrThrow(args, OperatingSystemsRules.createOsFolder());
    case 'update_os_folder':
      return validateOrThrow(args, OperatingSystemsRules.updateOsFolder());
    case 'delete_os_folder':
      return validateOrThrow(args, OperatingSystemsRules.deleteOsFolder());
    case 'update_os_windows_endpoint':
      return validateOrThrow(args, OperatingSystemsRules.updateOsWindowsEndpoint());

    // -----------------------------------------------------------------
    // Software API
    // -----------------------------------------------------------------
    case 'list_installed_windows_software':
    case 'list_installed_software_by_endpoint':
    case 'list_installed_software_by_logical_group':
    case 'list_installed_software_by_universal_dynamic_group':
      return validateOrThrow(args, SoftwareRules.listInstalledWindowsSoftware());

    // -----------------------------------------------------------------
    // Update Management API
    // -----------------------------------------------------------------
    case 'list_update_management_windows_endpoints':
      return validateOrThrow(args, UpdateManagementRules.listWindowsEndpoints());
    case 'get_update_management_windows_endpoint':
      return validateOrThrow(args, UpdateManagementRules.getWindowsEndpoint());
    case 'update_update_management_windows_endpoint':
      return validateOrThrow(args, UpdateManagementRules.getWindowsEndpoint());

    // -----------------------------------------------------------------
    // V1.1 API
    // -----------------------------------------------------------------
    case 'get_endpoint_secrets_v1':
    case 'get_bitlocker_pins_v1':
      return validateOrThrow(args, V11Rules.getBitLockerSecrets());
    case 'get_bitlocker_recovery_keys_v1':
      return validateOrThrow(args, V11Rules.getRecoveryKeys());
    case 'get_tpm_owner_passwords_v1':
      return validateOrThrow(args, V11Rules.getTPMOwnerPasswords());
    case 'get_secret_by_volume_v1':
      return validateOrThrow(args, V11Rules.getSecretByVolume());
    case 'get_endpoint_ssh_info_v1':
      return validateOrThrow(args, V11Rules.getSSHInfo());
    case 'list_compliance_violations_v1':
      return validateOrThrow(args, V11Rules.listComplianceViolations());
    case 'get_compliance_violation_v1':
      return validateOrThrow(args, V11Rules.getComplianceViolation());
    case 'list_compliance_violations_by_endpoint_v1':
      return validateOrThrow(args, V11Rules.getComplianceViolationsByEndpoint());
    case 'get_inventory_file_scans_v1':
      return validateOrThrow(args, V11Rules.getFileScans());
    case 'get_inventory_wmi_scans_v1':
      return validateOrThrow(args, V11Rules.getWMIScans());
    case 'get_inventory_custom_scans_v1':
      return validateOrThrow(args, V11Rules.getCustomScans());
    case 'get_inventory_hardware_scans_v1':
      return validateOrThrow(args, V11Rules.getHardwareScans());
    case 'get_inventory_snmp_scans_v1':
      return validateOrThrow(args, V11Rules.getSNMPScans());
    case 'list_vpp_users_v1':
      return validateOrThrow(args, V11Rules.listVPPUsers());
    case 'get_vpp_user_v1':
      return validateOrThrow(args, V11Rules.getVPPUser());
    case 'create_vpp_user_v1':
      return validateOrThrow(args, V11Rules.createVPPUser());
    case 'delete_vpp_user_v1':
      return validateOrThrow(args, V11Rules.deleteVPPUser());
    case 'list_vpp_license_associations_v1':
      return validateOrThrow(args, V11Rules.listVPPLicenseAssociations());
    case 'assign_vpp_license_v1':
      return validateOrThrow(args, V11Rules.assignVPPLicense());
    case 'revoke_vpp_license_v1':
      return validateOrThrow(args, V11Rules.revokeVPPLicense());
    case 'get_bfcrx_integrity_v1':
      return validateOrThrow(args, V11Rules.getBfcrxIntegrity());
    case 'get_agent_setup_integrity_v1':
      return validateOrThrow(args, V11Rules.getAgentSetupIntegrity());

    // -----------------------------------------------------------------
    // Documentation Search API
    // -----------------------------------------------------------------
    case 'search_documentation':
      return validateOrThrow(args, DocumentationSearchRules.searchDocumentation());
    case 'get_documentation_item':
      return validateOrThrow(args, DocumentationSearchRules.getDocumentationItem());
    case 'list_documentation_sources':
      return validateOrThrow(args, DocumentationSearchRules.listDocumentationSources());
    case 'get_popular_topics':
      return validateOrThrow(args, DocumentationSearchRules.getPopularTopics());
    case 'search_known_issues':
      return validateOrThrow(args, DocumentationSearchRules.searchKnownIssues());
    case 'get_known_issues_summary':
      return validateOrThrow(args, DocumentationSearchRules.getKnownIssuesSummary());

    default:
      // Unknown tool — no validation rules defined; caller handles routing.
      break;
  }
}
