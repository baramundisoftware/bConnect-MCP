/**
 * Test Data Fixtures
 *
 * Reusable test data for E2E tests across all MCP tools.
 * Provides mock data matching bConnect API responses.
 */

/**
 * Common test endpoint IDs
 */
export const TEST_ENDPOINT_IDS = {
  WINDOWS_VALID: "98cdf559-1733-42b4-ae1f-42eabf7f9281", // bms-win22srv
  WINDOWS_INVALID: "00000000-0000-0000-0000-000000000000", // Non-existent
  LINUX_VALID: "11111111-1111-1111-1111-111111111111",
  MAC_VALID: "22222222-2222-2222-2222-222222222222",
  ANDROID_VALID: "33333333-3333-3333-3333-333333333333"
};

/**
 * Common test job definition IDs
 */
export const TEST_JOB_DEFINITION_IDS = {
  WINDOWS_VALID: "44444444-4444-4444-4444-444444444444",
  INVALID: "00000000-0000-0000-0000-000000000000"
};

/**
 * Common test job instance IDs
 */
export const TEST_JOB_INSTANCE_IDS = {
  VALID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  INVALID: "00000000-0000-0000-0000-000000000000"
};

/**
 * Common test kiosk release IDs
 */
export const TEST_KIOSK_RELEASE_IDS = {
  VALID: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  INVALID: "00000000-0000-0000-0000-000000000000"
};

/**
 * Common test folder IDs
 */
export const TEST_FOLDER_IDS = {
  VALID: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  INVALID: "00000000-0000-0000-0000-000000000000"
};

/**
 * Common test asset IDs
 */
export const TEST_ASSET_IDS = {
  VALID: "55555555-5555-5555-5555-555555555555",
  INVALID: "00000000-0000-0000-0000-000000000000"
};

/**
 * Common test asset type IDs
 */
export const TEST_ASSET_TYPE_IDS = {
  VALID: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
  INVALID: "00000000-0000-0000-0000-000000000000"
};

/**
 * Common test asset stock folder IDs
 */
export const TEST_ASSET_STOCK_FOLDER_IDS = {
  VALID: "ffffffff-ffff-ffff-ffff-ffffffffffff",
  INVALID: "00000000-0000-0000-0000-000000000000"
};

/**
 * Common test logical group IDs
 */
export const TEST_LOGICAL_GROUP_IDS = {
  VALID: "66666666-6666-6666-6666-666666666666",
  INVALID: "00000000-0000-0000-0000-000000000000"
};

/**
 * Common test Active Directory IDs
 */
export const TEST_AD_IDS = {
  USER_VALID: "77777777-7777-7777-7777-777777777777",
  GROUP_VALID: "88888888-8888-8888-8888-888888888888",
  OU_VALID: "99999999-9999-9999-9999-999999999999",
  INVALID: "00000000-0000-0000-0000-000000000000"
};

/**
 * Common pagination parameters
 */
export const TEST_PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 1000,
  FIRST_PAGE: 0,
  SECOND_PAGE: 1,
  SMALL_PAGE: 5,
  MEDIUM_PAGE: 50,
  LARGE_PAGE: 100
};

/**
 * Common search queries
 */
export const TEST_SEARCH_QUERIES = {
  WINDOWS_HOSTNAME: "bms-win22srv",
  IP_ADDRESS: "192.168.1.100",
  SERIAL_NUMBER: "VMware-56 4d 1f",
  NON_EXISTENT: "this-device-does-not-exist-xyz"
};

/**
 * Common OrderBy parameters
 */
export const TEST_ORDER_BY = {
  DISPLAY_NAME_ASC: "DisplayName asc",
  DISPLAY_NAME_DESC: "DisplayName desc",
  HOST_NAME_ASC: "HostName asc",
  LAST_SEEN_DESC: "LastSeen desc",
  OPERATING_SYSTEM_ASC: "OperatingSystem asc"
};

/**
 * Mock Windows endpoint data
 */
export const MOCK_WINDOWS_ENDPOINT = {
  id: TEST_ENDPOINT_IDS.WINDOWS_VALID,
  displayName: "bms-win22srv",
  hostName: "bms-win22srv",
  primaryMAC: "00:50:56:9C:7E:2A",
  primaryIP: "192.168.1.100",
  operatingSystem: "Microsoft Windows Server 2022 Standard",
  osVersionString: "10.0.20348",
  serialNumber: "VMware-56 4d 1f 7a 4e 3b 8f 2c-9d 1a 6b 5c 3e 8f 2d 1c",
  manufacturer: "VMware, Inc.",
  model: "VMware Virtual Platform",
  lastSeen: "2025-01-29T10:30:00Z",
  isOnline: true,
  comment: "Test Windows Server"
};

/**
 * Mock Linux endpoint data
 */
export const MOCK_LINUX_ENDPOINT = {
  id: TEST_ENDPOINT_IDS.LINUX_VALID,
  displayName: "ubuntu-server",
  hostName: "ubuntu-server",
  primaryMAC: "00:50:56:9C:7E:2B",
  primaryIP: "192.168.1.101",
  operatingSystem: "Ubuntu 22.04 LTS",
  osVersionString: "22.04",
  serialNumber: "VMware-56 4d 1f 7a 4e 3b 8f 2c-9d 1a 6b 5c 3e 8f 2d 1d",
  manufacturer: "VMware, Inc.",
  model: "VMware Virtual Platform",
  lastSeen: "2025-01-29T10:30:00Z",
  isOnline: true,
  comment: "Test Linux Server"
};

/**
 * Mock Mac endpoint data
 */
export const MOCK_MAC_ENDPOINT = {
  id: TEST_ENDPOINT_IDS.MAC_VALID,
  displayName: "macbook-pro",
  hostName: "macbook-pro",
  primaryMAC: "00:50:56:9C:7E:2C",
  primaryIP: "192.168.1.102",
  operatingSystem: "macOS 14.2 Sonoma",
  osVersionString: "14.2",
  serialNumber: "C02XXXXXXXXXXX",
  manufacturer: "Apple Inc.",
  model: "MacBookPro18,1",
  lastSeen: "2025-01-29T10:30:00Z",
  isOnline: true,
  comment: "Test Mac Laptop"
};

/**
 * Mock job definition data
 */
export const MOCK_JOB_DEFINITION = {
  id: TEST_JOB_DEFINITION_IDS.WINDOWS_VALID,
  name: "Install Software Package",
  displayName: "Install Software Package",
  type: "WindowsJobDefinition",
  description: "Installs a software package on Windows endpoints",
  category: "Software Deployment",
  isActive: true,
  createdAt: "2025-01-01T00:00:00Z",
  modifiedAt: "2025-01-29T10:00:00Z"
};

/**
 * Mock job instance data
 */
export const MOCK_JOB_INSTANCE = {
  id: TEST_JOB_INSTANCE_IDS.VALID,
  jobDefinitionId: TEST_JOB_DEFINITION_IDS.WINDOWS_VALID,
  jobDefinitionName: "Install Software Package",
  endpointId: TEST_ENDPOINT_IDS.WINDOWS_VALID,
  endpointName: "bms-win22srv",
  status: "Completed",
  startTime: "2025-01-29T10:00:00Z",
  endTime: "2025-01-29T10:05:00Z",
  exitCode: 0,
  message: "Installation completed successfully"
};

/**
 * Mock kiosk release data
 */
export const MOCK_KIOSK_RELEASE = {
  id: TEST_KIOSK_RELEASE_IDS.VALID,
  jobDefinitionId: TEST_JOB_DEFINITION_IDS.WINDOWS_VALID,
  jobDefinitionName: "Install Software Package",
  targetType: "LogicalGroup",
  targetId: TEST_LOGICAL_GROUP_IDS.VALID,
  targetName: "All Windows Servers",
  supportedPlatforms: ["Windows"],
  isActive: true,
  createdAt: "2025-01-29T10:00:00Z",
  modifiedAt: "2025-01-29T10:00:00Z"
};

/**
 * Mock job folder data
 */
export const MOCK_JOB_FOLDER = {
  id: TEST_FOLDER_IDS.VALID,
  name: "Production Jobs",
  description: "Job folder for production deployments",
  parentId: null,
  createdAt: "2025-01-01T00:00:00Z",
  modifiedAt: "2025-01-29T10:00:00Z"
};

/**
 * Mock asset data
 */
export const MOCK_ASSET = {
  assetId: TEST_ASSET_IDS.VALID,
  assetTypeId: TEST_ASSET_TYPE_IDS.VALID,
  assetTypeName: "Laptop",
  ownerId: TEST_ENDPOINT_IDS.WINDOWS_VALID,
  ownerName: "bms-win22srv",
  ownerType: "WindowsEndpoint",
  manufacturer: "Dell Inc.",
  model: "Latitude 5520",
  serialNumber: "ABCD1234",
  purchaseDate: "2024-01-15",
  warrantyEndDate: "2027-01-15",
  status: "Active",
  location: "Building A, Floor 3, Room 301",
  comment: "Test laptop asset"
};

/**
 * Mock asset type data
 */
export const MOCK_ASSET_TYPE = {
  id: TEST_ASSET_TYPE_IDS.VALID,
  name: "Laptop",
  description: "Laptop computers",
  category: "Hardware",
  isActive: true,
  createdAt: "2024-01-01T00:00:00Z",
  modifiedAt: "2025-01-29T10:00:00Z"
};

/**
 * Mock asset stock folder data
 */
export const MOCK_ASSET_STOCK_FOLDER = {
  id: TEST_ASSET_STOCK_FOLDER_IDS.VALID,
  name: "Building A Stock",
  description: "Stock room for Building A",
  parentId: null,
  createdAt: "2024-01-01T00:00:00Z",
  modifiedAt: "2025-01-29T10:00:00Z"
};

/**
 * Mock logical group data
 */
export const MOCK_LOGICAL_GROUP = {
  id: TEST_LOGICAL_GROUP_IDS.VALID,
  name: "All Windows Servers",
  description: "Group containing all Windows Server endpoints",
  type: "Dynamic",
  endpointCount: 12,
  filterExpression: "OperatingSystem contains 'Windows Server'",
  createdAt: "2024-01-01T00:00:00Z",
  modifiedAt: "2025-01-29T10:00:00Z"
};

/**
 * Mock Active Directory user data
 */
export const MOCK_AD_USER = {
  id: TEST_AD_IDS.USER_VALID,
  name: "John Doe",
  sAMAccountName: "jdoe",
  userPrincipalName: "jdoe@bsag.dev",
  displayName: "John Doe",
  email: "john.doe@bsag.dev",
  department: "IT",
  title: "System Administrator",
  enabled: true,
  domain: "BSAG",
  type: "User"
};

/**
 * Mock Active Directory group data
 */
export const MOCK_AD_GROUP = {
  id: TEST_AD_IDS.GROUP_VALID,
  name: "IT Administrators",
  sAMAccountName: "IT-Admins",
  description: "Group for IT administrators",
  groupType: "Security",
  domain: "BSAG",
  type: "Group",
  memberCount: 5
};

/**
 * Mock Active Directory object data (generic AD object - can be user, group, or computer)
 */
export const MOCK_AD_OBJECT = {
  id: TEST_AD_IDS.USER_VALID,
  name: "John Doe",
  sAMAccountName: "jdoe",
  distinguishedName: "CN=John Doe,OU=IT,DC=bsag,DC=dev",
  objectClass: "user",
  domain: "BSAG",
  type: "User"
};

/**
 * Mock Organizational Unit data
 */
export const MOCK_ORG_UNIT = {
  id: TEST_AD_IDS.OU_VALID,
  name: "IT Department",
  distinguishedName: "OU=IT,DC=bsag,DC=dev",
  description: "Organizational unit for IT department",
  domain: "BSAG",
  type: "OrganizationalUnit"
};

/**
 * Mock paginated response structure
 */
export function createMockPaginatedResponse<T>(
  data: T[],
  pageSize: number = TEST_PAGINATION.DEFAULT_PAGE_SIZE,
  page: number = TEST_PAGINATION.FIRST_PAGE
): {
  totalItems: number;
  pageSize: number;
  page: number;
  data: T[];
} {
  const startIndex = page * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedData = data.slice(startIndex, endIndex);

  return {
    totalItems: data.length,
    pageSize,
    page,
    data: paginatedData
  };
}

/**
 * Generate multiple mock endpoints
 */
export function generateMockEndpoints(count: number): any[] {
  const endpoints = [];
  for (let i = 0; i < count; i++) {
    endpoints.push({
      ...MOCK_WINDOWS_ENDPOINT,
      id: `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
      displayName: `endpoint-${i}`,
      hostName: `endpoint-${i}`,
      primaryIP: `192.168.1.${100 + i}`
    });
  }
  return endpoints;
}

/**
 * Generate multiple mock job definitions
 */
export function generateMockJobDefinitions(count: number): any[] {
  const jobDefinitions = [];
  for (let i = 0; i < count; i++) {
    jobDefinitions.push({
      ...MOCK_JOB_DEFINITION,
      id: `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
      name: `Job Definition ${i}`,
      displayName: `Job Definition ${i}`
    });
  }
  return jobDefinitions;
}

/**
 * Generate multiple mock job instances
 */
export function generateMockJobInstances(count: number): any[] {
  const jobInstances = [];
  for (let i = 0; i < count; i++) {
    jobInstances.push({
      ...MOCK_JOB_INSTANCE,
      id: `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
      status: i % 3 === 0 ? "Completed" : i % 3 === 1 ? "Running" : "Failed"
    });
  }
  return jobInstances;
}

/**
 * Generate multiple mock kiosk releases
 */
export function generateMockKioskReleases(count: number): any[] {
  const releases = [];
  for (let i = 0; i < count; i++) {
    releases.push({
      ...MOCK_KIOSK_RELEASE,
      id: `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
      jobDefinitionName: `Kiosk Job ${i}`
    });
  }
  return releases;
}

/**
 * Generate multiple mock assets
 */
export function generateMockAssets(count: number): any[] {
  const assets = [];
  for (let i = 0; i < count; i++) {
    assets.push({
      ...MOCK_ASSET,
      assetId: `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
      serialNumber: `ASSET${i.toString().padStart(4, '0')}`
    });
  }
  return assets;
}

/**
 * Generate multiple mock asset types
 */
export function generateMockAssetTypes(count: number): any[] {
  const assetTypes = [];
  for (let i = 0; i < count; i++) {
    assetTypes.push({
      ...MOCK_ASSET_TYPE,
      id: `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
      name: `Asset Type ${i}`,
      description: `Description for asset type ${i}`
    });
  }
  return assetTypes;
}

/**
 * Generate multiple mock asset stock folders
 */
export function generateMockAssetStockFolders(count: number): any[] {
  const folders = [];
  for (let i = 0; i < count; i++) {
    folders.push({
      ...MOCK_ASSET_STOCK_FOLDER,
      id: `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
      name: `Stock Folder ${i}`,
      description: `Description for stock folder ${i}`
    });
  }
  return folders;
}

/**
 * Generate multiple mock AD users
 */
export function generateMockADUsers(count: number): any[] {
  const users = [];
  for (let i = 0; i < count; i++) {
    users.push({
      ...MOCK_AD_USER,
      id: `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
      name: `User ${i}`,
      sAMAccountName: `user${i}`,
      userPrincipalName: `user${i}@bsag.dev`,
      displayName: `User ${i}`,
      email: `user${i}@bsag.dev`
    });
  }
  return users;
}

/**
 * Generate multiple mock AD groups
 */
export function generateMockADGroups(count: number): any[] {
  const groups = [];
  for (let i = 0; i < count; i++) {
    groups.push({
      ...MOCK_AD_GROUP,
      id: `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
      name: `Group ${i}`,
      sAMAccountName: `group${i}`,
      description: `Description for group ${i}`
    });
  }
  return groups;
}

/**
 * Generate multiple mock AD objects
 */
export function generateMockADObjects(count: number): any[] {
  const objects = [];
  for (let i = 0; i < count; i++) {
    objects.push({
      ...MOCK_AD_OBJECT,
      id: `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
      name: `Object ${i}`,
      sAMAccountName: `object${i}`,
      distinguishedName: `CN=Object ${i},OU=IT,DC=bsag,DC=dev`
    });
  }
  return objects;
}

/**
 * Generate multiple mock organizational units
 */
export function generateMockOrgUnits(count: number): any[] {
  const orgUnits = [];
  for (let i = 0; i < count; i++) {
    orgUnits.push({
      ...MOCK_ORG_UNIT,
      id: `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
      name: `OU ${i}`,
      distinguishedName: `OU=OU${i},DC=bsag,DC=dev`,
      description: `Description for organizational unit ${i}`
    });
  }
  return orgUnits;
}

/**
 * Common test threat IDs (Microsoft Defender)
 */
export const TEST_THREAT_IDS = {
  VALID: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  INVALID: "00000000-0000-0000-0000-000000000000"
};

/**
 * Mock BitLocker Windows endpoint data
 */
export const MOCK_BITLOCKER_ENDPOINT = {
  id: TEST_ENDPOINT_IDS.WINDOWS_VALID,
  endpointName: "bms-win22srv",
  encryptionStatus: "FullyEncrypted",
  protectionStatus: "On",
  encryptionMethod: "XtsAes256",
  volumeType: "OperatingSystem",
  conversionStatus: "FullyEncrypted",
  lastUpdated: "2025-01-29T10:00:00Z"
};

/**
 * Mock Microsoft Defender threat data
 */
export const MOCK_DEFENDER_THREAT = {
  id: TEST_THREAT_IDS.VALID,
  threatName: "Trojan:Win32/Wacatac.B!ml",
  threatType: "Trojan",
  severity: "Severe",
  category: "Malware",
  detectionTime: "2025-01-29T09:00:00Z",
  remediationTime: "2025-01-29T09:05:00Z",
  threatStatus: "Quarantined",
  affectedResources: [
    "C:\\Users\\Admin\\Downloads\\suspicious.exe"
  ],
  endpointId: TEST_ENDPOINT_IDS.WINDOWS_VALID,
  endpointName: "bms-win22srv"
};

/**
 * Mock Microsoft Defender Windows endpoint state data
 */
export const MOCK_DEFENDER_ENDPOINT = {
  id: TEST_ENDPOINT_IDS.WINDOWS_VALID,
  endpointName: "bms-win22srv",
  antivirusEnabled: true,
  antivirusSignatureVersion: "1.381.2140.0",
  antivirusSignatureUpdateTime: "2025-01-29T08:00:00Z",
  antispywareEnabled: true,
  antispywareSignatureVersion: "1.381.2140.0",
  behaviorMonitorEnabled: true,
  ioavProtectionEnabled: true,
  nisEnabled: true,
  nisSignatureVersion: "1.381.2140.0",
  realTimeProtectionEnabled: true,
  quickScanTime: "2025-01-29T07:00:00Z",
  fullScanTime: "2025-01-28T02:00:00Z",
  productStatus: "Active"
};

/**
 * Mock Local Admin Account data
 */
export const MOCK_LOCAL_ADMIN_ACCOUNT = {
  id: TEST_ENDPOINT_IDS.WINDOWS_VALID,
  endpointName: "bms-win22srv",
  userName: "LocalAdmin",
  expirationDate: "2025-12-31T23:59:59Z",
  isExpired: false,
  lastUpdated: "2025-01-29T10:00:00Z",
  comment: "Managed local administrator account"
};

/**
 * Generate multiple mock BitLocker endpoints
 */
export function generateMockBitLockerEndpoints(count: number): any[] {
  const endpoints = [];
  for (let i = 0; i < count; i++) {
    endpoints.push({
      ...MOCK_BITLOCKER_ENDPOINT,
      id: `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
      endpointName: `endpoint-${i}`,
      encryptionStatus: i % 2 === 0 ? "FullyEncrypted" : "EncryptionInProgress"
    });
  }
  return endpoints;
}

/**
 * Generate multiple mock Defender threats
 */
export function generateMockDefenderThreats(count: number): any[] {
  const threats = [];
  const threatNames = [
    "Trojan:Win32/Wacatac.B!ml",
    "Backdoor:Win32/Hupigon",
    "Ransom:Win32/Locky",
    "Worm:Win32/Conficker",
    "Adware:Win32/EoRezo"
  ];
  const severities = ["Severe", "High", "Medium", "Low"];
  const statuses = ["Quarantined", "Removed", "Allowed", "Blocked"];

  for (let i = 0; i < count; i++) {
    threats.push({
      ...MOCK_DEFENDER_THREAT,
      id: `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
      threatName: threatNames[i % threatNames.length],
      severity: severities[i % severities.length],
      threatStatus: statuses[i % statuses.length]
    });
  }
  return threats;
}

/**
 * Generate multiple mock Defender endpoints
 */
export function generateMockDefenderEndpoints(count: number): any[] {
  const endpoints = [];
  for (let i = 0; i < count; i++) {
    endpoints.push({
      ...MOCK_DEFENDER_ENDPOINT,
      id: `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
      endpointName: `endpoint-${i}`,
      antivirusEnabled: i % 2 === 0
    });
  }
  return endpoints;
}

/**
 * Common test variable definition IDs
 */
export const TEST_VARIABLE_DEFINITION_IDS = {
  VALID: "aabbccdd-aabb-ccdd-eeff-aabbccddeeff",
  INVALID: "00000000-0000-0000-0000-000000000000"
};

/**
 * Common test variable instance IDs
 */
export const TEST_VARIABLE_INSTANCE_IDS = {
  VALID: "ddeeffaa-ddee-ffaa-bbcc-ddeeffaabbcc",
  INVALID: "00000000-0000-0000-0000-000000000000"
};

/**
 * Common test Windows application IDs
 */
export const TEST_WINDOWS_APP_IDS = {
  VALID: "eeffaabb-eeff-aabb-ccdd-eeffaabbccdd",
  INVALID: "00000000-0000-0000-0000-000000000000"
};

/**
 * Mock variable definition data
 */
export const MOCK_VARIABLE_DEFINITION = {
  id: TEST_VARIABLE_DEFINITION_IDS.VALID,
  name: "DEPLOYMENT_PATH",
  description: "Standard deployment path for applications",
  dataType: "String",
  defaultValue: "C:\\Program Files\\Company\\",
  scope: "Global",
  isReadOnly: false,
  createdAt: "2024-01-01T00:00:00Z",
  modifiedAt: "2025-01-29T10:00:00Z"
};

/**
 * Mock variable instance data
 */
export const MOCK_VARIABLE_INSTANCE = {
  id: TEST_VARIABLE_INSTANCE_IDS.VALID,
  variableDefinitionId: TEST_VARIABLE_DEFINITION_IDS.VALID,
  variableDefinitionName: "DEPLOYMENT_PATH",
  entityId: TEST_ENDPOINT_IDS.WINDOWS_VALID,
  entityName: "bms-win22srv",
  entityType: "Endpoint",
  value: "D:\\CustomApps\\",
  inheritedFrom: null,
  lastModified: "2025-01-29T10:00:00Z"
};

/**
 * Generate multiple mock variable definitions
 */
export function generateMockVariableDefinitions(count: number): any[] {
  const definitions = [];
  const dataTypes = ["String", "Integer", "Boolean", "Date"];
  const scopes = ["Global", "Endpoint", "LogicalGroup"];

  for (let i = 0; i < count; i++) {
    definitions.push({
      ...MOCK_VARIABLE_DEFINITION,
      id: `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
      name: `VAR_${i}`,
      description: `Variable definition ${i}`,
      dataType: dataTypes[i % dataTypes.length],
      scope: scopes[i % scopes.length]
    });
  }
  return definitions;
}

/**
 * Generate multiple mock variable instances
 */
export function generateMockVariableInstances(count: number): any[] {
  const instances = [];
  for (let i = 0; i < count; i++) {
    instances.push({
      ...MOCK_VARIABLE_INSTANCE,
      id: `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
      variableDefinitionName: `VAR_${i}`,
      value: `value-${i}`
    });
  }
  return instances;
}

// ============================================================================
// OPERATING SYSTEMS TEST DATA
// ============================================================================

/**
 * Common test OS folder IDs
 */
export const TEST_OS_FOLDER_IDS = {
  VALID: "ffffffff-ffff-ffff-ffff-ffffffffffff",
  PARENT: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
  INVALID: "00000000-0000-0000-0000-000000000000"
};

/**
 * Mock OS folder data
 */
export const MOCK_OS_FOLDER = {
  id: TEST_OS_FOLDER_IDS.VALID,
  name: "Windows 11 Images",
  description: "Windows 11 OS installation images",
  parentFolderId: null,
  path: "/Windows 11 Images",
  createdAt: "2024-01-01T00:00:00Z",
  modifiedAt: "2025-01-29T10:00:00Z"
};

/**
 * Mock OS Windows endpoint data (with OS installation info)
 */
export const MOCK_OS_WINDOWS_ENDPOINT = {
  endpointId: TEST_ENDPOINT_IDS.WINDOWS_VALID,
  endpointName: "bms-win22srv",
  bootEnvironmentId: null,
  hardwareProfileId: null,
  isOSInstallAllowed: true,
  inheritsAutoInstallation: false,
  operatingSystem: {
    name: "Windows Server 2022 Standard",
    version: {
      major: 10,
      minor: 0,
      build: 20348
    },
    displayVersion: "21H2",
    releaseId: null,
    localeId: 1033
  }
};

/**
 * Generate multiple mock OS folders
 */
export function generateMockOSFolders(count: number): any[] {
  const folders = [];
  for (let i = 0; i < count; i++) {
    folders.push({
      ...MOCK_OS_FOLDER,
      id: `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
      name: `Folder-${i}`,
      description: `OS folder ${i}`,
      path: `/Folder-${i}`
    });
  }
  return folders;
}

/**
 * Generate multiple mock OS Windows endpoints
 */
export function generateMockOSWindowsEndpoints(count: number): any[] {
  const endpoints = [];
  const osNames = [
    "Windows Server 2022 Standard",
    "Windows 11 Pro",
    "Windows 10 Enterprise",
    "Windows Server 2019 Datacenter"
  ];

  for (let i = 0; i < count; i++) {
    endpoints.push({
      ...MOCK_OS_WINDOWS_ENDPOINT,
      endpointId: `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
      endpointName: `endpoint-${i}`,
      operatingSystem: {
        name: osNames[i % osNames.length],
        version: {
          major: 10,
          minor: 0,
          build: 19041 + i
        },
        displayVersion: "21H2",
        releaseId: null,
        localeId: 1033
      }
    });
  }
  return endpoints;
}
