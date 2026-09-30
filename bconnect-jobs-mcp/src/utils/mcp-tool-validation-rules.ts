/**
 * MCP Tool Validation Rules
 *
 * Centralized validation rules for all 121 MCP tools.
 * Organized by module for maintainability.
 */

import { ValidationRule, CommonRules } from "@bconnect/mcp-core";

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
 * Validation rules per registered tool (REQ-SRV-018). The server validates a
 * tool's arguments with these before any request; a tool missing here fails
 * the tool-argument guard test instead of passing unchecked.
 */
export const TOOL_RULES: Record<string, () => ValidationRule[]> = {
  assign_job_to_dynamic_group: () => [CommonRules.guid('dynamicGroupId'), CommonRules.guid('jobDefinitionId')],
  assign_job_to_logical_group: () => [CommonRules.guid('logicalGroupId'), CommonRules.guid('jobDefinitionId')],
  assign_job_to_static_group: () => [CommonRules.guid('staticGroupId'), CommonRules.guid('jobDefinitionId')],
  assign_job_to_universal_dynamic_group: () => [CommonRules.guid('universalDynamicGroupId'), CommonRules.guid('jobDefinitionId')],
  create_job_folder: () => [CommonRules.guidOptional('parentId')],
  create_job_instance: () => [CommonRules.guid('jobDefinitionId'), CommonRules.guidOptional('endpointId')],
  create_kiosk_release: JobsRules.releaseKioskJob,
  delete_job_folder: JobsRules.getJobFolder,
  delete_job_instance: JobsRules.getJobInstance,
  get_job_definition: JobsRules.getJobDefinition,
  get_job_folder: JobsRules.getJobFolder,
  get_job_instance: JobsRules.getJobInstance,
  get_kiosk_release: () => [CommonRules.guid('id')],
  list_endpoint_job_instances: JobsRules.listEndpointJobInstances,
  list_job_definitions: JobsRules.listJobDefinitions,
  list_job_definitions_by_folder: JobsRules.listJobDefinitionsByFolder,
  list_job_folders: JobsRules.listJobFolders,
  list_job_instances: JobsRules.listJobInstances,
  list_job_instances_by_definition: JobsRules.listJobInstancesByDefinition,
  list_job_instances_by_dynamic_group: () => [CommonRules.guid('dynamicGroupId'), CommonRules.page(), CommonRules.pageSize()],
  list_job_instances_by_logical_group: JobsRules.listJobInstancesByLogicalGroup,
  list_job_instances_by_static_group: () => [CommonRules.guid('staticGroupId'), CommonRules.page(), CommonRules.pageSize()],
  list_job_instances_by_universal_dynamic_group: () => [CommonRules.guid('universalDynamicGroupId'), CommonRules.page(), CommonRules.pageSize()],
  list_job_subfolders: () => [CommonRules.guid('folderId'), CommonRules.page(), CommonRules.pageSize()],
  list_kiosk_releases: JobsRules.listJobInstances,
  list_kiosk_releases_by_ad_object: () => [CommonRules.guid('adObjectId'), CommonRules.page(), CommonRules.pageSize()],
  list_kiosk_releases_by_endpoint: () => [CommonRules.guid('endpointId'), CommonRules.page(), CommonRules.pageSize()],
  list_kiosk_releases_by_job_definition: () => [CommonRules.guid('jobDefinitionId'), CommonRules.page(), CommonRules.pageSize()],
  list_kiosk_releases_by_logical_group: () => [CommonRules.guid('logicalGroupId'), CommonRules.page(), CommonRules.pageSize()],
  resume_job_instance: JobsRules.getJobInstance,
  start_job_instance: JobsRules.getJobInstance,
  stop_job_instance: JobsRules.getJobInstance,
  update_job_folder: JobsRules.getJobFolder,
  withdraw_kiosk_release: () => [CommonRules.guid('id')],
};
