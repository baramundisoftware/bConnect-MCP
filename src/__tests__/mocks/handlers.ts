/**
 * MSW Handlers for Integration Tests
 *
 * Define mock API responses for bConnect API endpoints.
 * These handlers intercept HTTP requests and return realistic mock data.
 */

import { http, HttpResponse } from 'msw';

const BASE_URL = 'https://bms-win22srv:444/bconnect';

export const handlers = [
  // ============================================================================
  // V2.0 API Handlers - Endpoints Module
  // ============================================================================

  // GET /endpoints/v2.0/WindowsEndpoints - List Windows endpoints
  http.get(`${BASE_URL}/endpoints/v2.0/WindowsEndpoints`, () => {
    return HttpResponse.json({
      totalItems: 3,
      data: [
        {
          id: '98cdf559-1733-42b4-ae1f-42eabf7f9281',
          displayName: 'bms-win22srv',
          hostName: 'bms-win22srv',
          operatingSystem: 'Microsoft Windows Server 2022 Standard',
          primaryIP: '172.21.165.56',
          lastSeen: '2025-01-22T10:00:00Z',
          online: true,
        },
        {
          id: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
          displayName: 'WIN-PC-001',
          hostName: 'WIN-PC-001',
          operatingSystem: 'Microsoft Windows 11 Pro',
          primaryIP: '192.168.1.100',
          lastSeen: '2025-01-22T09:30:00Z',
          online: true,
        },
        {
          id: 'b2c3d4e5-6789-01bc-def1-2345678901bc',
          displayName: 'WIN-LAPTOP-002',
          hostName: 'WIN-LAPTOP-002',
          operatingSystem: 'Microsoft Windows 11 Pro',
          primaryIP: '192.168.1.101',
          lastSeen: '2025-01-21T18:45:00Z',
          online: false,
        },
      ],
    });
  }),

  // GET /endpoints/v2.0/WindowsEndpoints/:id - Get specific Windows endpoint
  http.get(`${BASE_URL}/endpoints/v2.0/WindowsEndpoints/:id`, ({ params }) => {
    const id = params.id as string;

    // Return 404 for non-existent endpoints
    if (id === '00000000-0000-0000-0000-000000000000' || id === 'invalid-id' || id === 'non-existent-id') {
      return HttpResponse.json(
        { Message: 'Endpoint not found' },
        { status: 404 }
      );
    }

    // Return endpoint data for valid IDs
    if (id === '98cdf559-1733-42b4-ae1f-42eabf7f9281') {
      return HttpResponse.json({
        id: '98cdf559-1733-42b4-ae1f-42eabf7f9281',
        displayName: 'bms-win22srv',
        hostName: 'bms-win22srv',
        operatingSystem: 'Microsoft Windows Server 2022 Standard',
        osVersionString: '10.0.20348',
        primaryIP: '172.21.165.56',
        primaryMAC: '00-15-5D-01-02-03',
        serialNumber: 'VMware-56 4d e1 e9',
        lastSeen: '2025-01-22T10:00:00Z',
        lastInventory: '2025-01-22T09:00:00Z',
        online: true,
        comment: 'baramundi Management Server',
        logicalGroupId: 'f1e2d3c4-5678-90ab-cdef-1234567890ab',
      });
    }

    // Default: return generic endpoint data
    return HttpResponse.json({
      id: id,
      displayName: `Endpoint-${id.slice(0, 8)}`,
      hostName: `HOST-${id.slice(0, 8)}`,
      operatingSystem: 'Microsoft Windows 11 Pro',
      primaryIP: '192.168.1.100',
      lastSeen: '2025-01-22T10:00:00Z',
      online: true,
    });
  }),

  // GET /endpoints/v2.0/LogicalGroups - List logical groups
  http.get(`${BASE_URL}/endpoints/v2.0/LogicalGroups`, () => {
    return HttpResponse.json({
      totalItems: 2,
      data: [
        {
          id: 'f1e2d3c4-5678-90ab-cdef-1234567890ab',
          name: 'Servers',
          comment: 'Windows Servers',
          parentId: null,
        },
        {
          id: 'a2b3c4d5-6789-01bc-def1-2345678901bc',
          name: 'Workstations',
          comment: 'Windows Workstations',
          parentId: null,
        },
      ],
    });
  }),

  // ============================================================================
  // V2.0 API Handlers - Jobs Module
  // ============================================================================

  // GET /jobs/v2.0/JobDefinitions - List job definitions
  http.get(`${BASE_URL}/jobs/v2.0/JobDefinitions`, () => {
    return HttpResponse.json({
      totalItems: 2,
      data: [
        {
          id: 'job-123-456-789',
          name: 'Windows Update',
          comment: 'Install Windows updates',
          jobType: 'SoftwareDeployment',
          enabled: true,
        },
        {
          id: 'job-987-654-321',
          name: 'Software Installation',
          comment: 'Install required software',
          jobType: 'SoftwareDeployment',
          enabled: true,
        },
      ],
    });
  }),

  // GET /jobs/v2.0/JobDefinitions/:id - Get specific job definition
  http.get(`${BASE_URL}/jobs/v2.0/JobDefinitions/:id`, ({ params }) => {
    const id = params.id as string;

    // Return 404 for non-existent job
    if (id === '00000000-0000-0000-0000-000000000000' || id === 'invalid-job-id') {
      return HttpResponse.json(
        { Message: 'Job definition not found' },
        { status: 404 }
      );
    }

    // Return job data for valid IDs
    if (id === 'job-123-456-789') {
      return HttpResponse.json({
        id: 'job-123-456-789',
        name: 'Windows Update',
        comment: 'Install Windows updates',
        jobType: 'SoftwareDeployment',
        enabled: true,
        steps: [
          { id: 'step-1', name: 'Download updates', order: 1 },
          { id: 'step-2', name: 'Install updates', order: 2 }
        ]
      });
    }

    // Default: return generic job data
    return HttpResponse.json({
      id: id,
      name: `Job-${id.slice(0, 8)}`,
      comment: 'Generic job',
      jobType: 'SoftwareDeployment',
      enabled: true,
    });
  }),

  // GET /jobs/v2.0/Endpoints/:endpointId/JobInstances - Get job instances for endpoint
  http.get(`${BASE_URL}/jobs/v2.0/Endpoints/:endpointId/JobInstances`, ({ params }) => {
    const { endpointId } = params;

    return HttpResponse.json({
      totalItems: 2,
      data: [
        {
          id: 'job-instance-1',
          jobDefinitionId: 'job-123-456-789',
          endpointId: endpointId,
          status: 'Success',
          startTime: '2025-01-22T08:00:00Z',
          endTime: '2025-01-22T08:15:00Z',
        },
        {
          id: 'job-instance-2',
          jobDefinitionId: 'job-987-654-321',
          endpointId: endpointId,
          status: 'Success',
          startTime: '2025-01-21T14:00:00Z',
          endTime: '2025-01-21T14:30:00Z',
        },
      ],
    });
  }),

  // ============================================================================
  // V2.0 API Handlers - Assets Module
  // ============================================================================

  // GET /assets/v2.0/Assets - List assets
  http.get(`${BASE_URL}/assets/v2.0/Assets`, () => {
    return HttpResponse.json({
      totalItems: 3,
      data: [
        {
          assetId: 'asset-001',
          assetTypeId: 'type-001',
          assetTypeName: 'Hardware',
          ownerId: '98cdf559-1733-42b4-ae1f-42eabf7f9281',
          ownerName: 'bms-win22srv',
          ownerType: 'Machine',
          name: 'Dell Latitude 5520',
          comments: 'Company laptop',
          contact: null,
          inventoryNumber: 'INV-001',
          url: 'http://',
          costCenter: null,
          purchaseDate: '2023-01-15T00:00:00Z',
          purchasePrice: 1200.00,
          operatingCost: 0,
          lastChanged: '2025-01-29T10:00:00Z',
          energyOff: -1,
          energyOn: -1,
          additionalProperties: [],
          assetReferenceList: [],
        },
        {
          assetId: 'asset-002',
          assetTypeId: 'type-002',
          assetTypeName: 'Software',
          ownerId: '98cdf559-1733-42b4-ae1f-42eabf7f9281',
          ownerName: 'bms-win22srv',
          ownerType: 'Machine',
          name: 'Microsoft Office 365 License',
          comments: 'Volume license',
          contact: null,
          inventoryNumber: null,
          url: 'http://',
          costCenter: null,
          purchaseDate: '2023-02-01T00:00:00Z',
          purchasePrice: 500.00,
          operatingCost: 0,
          lastChanged: '2025-01-29T10:00:00Z',
          energyOff: -1,
          energyOn: -1,
          additionalProperties: [],
          assetReferenceList: [],
        },
        {
          assetId: 'asset-003',
          assetTypeId: 'type-001',
          assetTypeName: 'Hardware',
          ownerId: '98cdf559-1733-42b4-ae1f-42eabf7f9281',
          ownerName: 'bms-win22srv',
          ownerType: 'Machine',
          name: 'Dell UltraSharp 27" Monitor',
          comments: null,
          contact: null,
          inventoryNumber: 'MON-001',
          url: 'http://',
          costCenter: null,
          purchaseDate: '2023-03-01T00:00:00Z',
          purchasePrice: 400.00,
          operatingCost: 0,
          lastChanged: '2025-01-29T10:00:00Z',
          energyOff: -1,
          energyOn: -1,
          additionalProperties: [],
          assetReferenceList: [],
        },
      ],
    });
  }),

  // GET /assets/v2.0/Assets/:id - Get specific asset
  http.get(`${BASE_URL}/assets/v2.0/Assets/:id`, ({ params }) => {
    const id = params.id as string;

    // Return 404 for non-existent asset
    if (id === '00000000-0000-0000-0000-000000000000' || id === 'invalid-asset-id') {
      return HttpResponse.json(
        { Message: 'Asset not found' },
        { status: 404 }
      );
    }

    // Return asset data for valid IDs
    if (id === 'asset-001') {
      return HttpResponse.json({
        assetId: 'asset-001',
        assetTypeId: 'type-001',
        assetTypeName: 'Hardware',
        ownerId: '98cdf559-1733-42b4-ae1f-42eabf7f9281',
        ownerName: 'bms-win22srv',
        ownerType: 'Machine',
        name: 'Dell Latitude 5520',
        comments: 'Company laptop - IT Department',
        contact: 'John Doe',
        inventoryNumber: 'INV-001',
        url: 'http://',
        costCenter: 'IT-001',
        purchaseDate: '2023-01-15T00:00:00Z',
        purchasePrice: 1200.00,
        operatingCost: 100.00,
        lastChanged: '2025-01-29T10:00:00Z',
        energyOff: -1,
        energyOn: -1,
        additionalProperties: [
          { name: 'Manufacturer', type: 'String', value: 'Dell' },
          { name: 'Model', type: 'String', value: 'Latitude 5520' },
          { name: 'SerialNumber', type: 'String', value: 'SN123456789' },
        ],
        assetReferenceList: [],
      });
    }

    // Default: return generic asset data
    return HttpResponse.json({
      assetId: id,
      assetTypeId: 'type-001',
      assetTypeName: 'Hardware',
      name: `Asset-${id.slice(0, 8)}`,
      ownerId: '98cdf559-1733-42b4-ae1f-42eabf7f9281',
      ownerName: 'bms-win22srv',
      ownerType: 'Machine',
      comments: null,
      contact: null,
      inventoryNumber: null,
      url: 'http://',
      costCenter: null,
      purchaseDate: '2025-01-29T00:00:00Z',
      purchasePrice: 0,
      operatingCost: 0,
      lastChanged: '2025-01-29T10:00:00Z',
      energyOff: -1,
      energyOn: -1,
      additionalProperties: [],
      assetReferenceList: [],
    });
  }),

  // GET /assets/v2.0/AssetTypes - List asset types
  http.get(`${BASE_URL}/assets/v2.0/AssetTypes`, () => {
    return HttpResponse.json({
      totalItems: 2,
      data: [
        {
          guid: 'type-001',
          name: 'Hardware',
          comments: 'Physical devices',
          contact: null,
          inventoryNumber: null,
          url: 'http://',
          costCenter: null,
          purchasePrice: 0,
          purchaseDate: '2009-09-01T08:08:19Z',
          operatingCost: 0,
          iconChanged: '2009-09-01T08:08:49Z',
          energyOptions: '0',
          guidParent: '474c4c60-10ae-4e92-a48c-1ec7c3c32b09',
          additionalProperties: null,
          summary: null,
          encodedIcon: null,
        },
        {
          guid: 'type-002',
          name: 'Software',
          comments: 'Software licenses',
          contact: null,
          inventoryNumber: null,
          url: 'http://',
          costCenter: null,
          purchasePrice: 0,
          purchaseDate: '2009-09-01T07:56:34Z',
          operatingCost: 0,
          iconChanged: '2009-09-01T07:56:42Z',
          energyOptions: '0',
          guidParent: '474c4c60-10ae-4e92-a48c-1ec7c3c32b09',
          additionalProperties: null,
          summary: null,
          encodedIcon: null,
        },
      ],
    });
  }),

  // ============================================================================
  // V2.0 API Handlers - Active Directory Module
  // ============================================================================

  // GET /activedirectory/v2.0/ADUsers - List AD users
  http.get(`${BASE_URL}/activedirectory/v2.0/ADUsers`, () => {
    return HttpResponse.json({
      totalItems: 3,
      data: [
        {
          id: 'user-001',
          principalName: 'jdoe',
          name: 'John Doe',
          firstName: 'John',
          lastName: 'Doe',
          mail: 'john.doe@company.com',
          domain: 'company.com',
          enabled: true,
          comment: null,
          ldapPath: 'LDAP://CN=John Doe,OU=Users,DC=company,DC=com',
          type: 'User',
        },
        {
          id: 'user-002',
          principalName: 'jsmith',
          name: 'Jane Smith',
          firstName: 'Jane',
          lastName: 'Smith',
          mail: 'jane.smith@company.com',
          domain: 'company.com',
          enabled: true,
          comment: null,
          ldapPath: 'LDAP://CN=Jane Smith,OU=Users,DC=company,DC=com',
          type: 'User',
        },
        {
          id: 'user-003',
          principalName: 'mbrown',
          name: 'Mike Brown',
          firstName: 'Mike',
          lastName: 'Brown',
          mail: 'mike.brown@company.com',
          domain: 'company.com',
          enabled: true,
          comment: null,
          ldapPath: 'LDAP://CN=Mike Brown,OU=Users,DC=company,DC=com',
          type: 'User',
        },
      ],
    });
  }),

  // GET /activedirectory/v2.0/ADUsers/:id - Get specific AD user
  http.get(`${BASE_URL}/activedirectory/v2.0/ADUsers/:id`, ({ params }) => {
    const id = params.id as string;

    // Return 404 for non-existent user
    if (id === '00000000-0000-0000-0000-000000000000' || id === 'invalid-user-id') {
      return HttpResponse.json(
        { Message: 'User not found' },
        { status: 404 }
      );
    }

    // Return user data for valid IDs
    if (id === 'user-001') {
      return HttpResponse.json({
        id: 'user-001',
        principalName: 'jdoe',
        name: 'John Doe',
        firstName: 'John',
        lastName: 'Doe',
        mail: 'john.doe@company.com',
        domain: 'company.com',
        title: 'System Administrator',
        enabled: true,
        comment: null,
        ldapPath: 'LDAP://CN=John Doe,OU=Users,DC=company,DC=com',
        managerUserPrincipalName: 'manager@company.com',
        type: 'User',
      });
    }

    // Default: return generic user data
    return HttpResponse.json({
      id: id,
      principalName: `user-${id.slice(0, 8)}`,
      name: `User ${id.slice(0, 8)}`,
      firstName: 'Generic',
      lastName: 'User',
      domain: 'company.com',
      enabled: true,
      comment: null,
      type: 'User',
    });
  }),

  // GET /activedirectory/v2.0/ADGroups - List AD groups
  http.get(`${BASE_URL}/activedirectory/v2.0/ADGroups`, () => {
    return HttpResponse.json({
      totalItems: 2,
      data: [
        {
          id: 'group-001',
          name: 'IT-Admins',
          domain: 'company.com',
          comment: 'IT department administrators',
          ldapPath: 'LDAP://CN=IT-Admins,OU=Groups,DC=company,DC=com',
          type: 'Group',
          description: 'IT department administrators',
          memberCount: 5,
        },
        {
          id: 'group-002',
          name: 'All-Users',
          domain: 'company.com',
          comment: 'All company users',
          ldapPath: 'LDAP://CN=All-Users,OU=Groups,DC=company,DC=com',
          type: 'Group',
          description: 'All company users',
          memberCount: 150,
        },
      ],
    });
  }),

  // ============================================================================
  // V2.0 API Handlers - Variables Module
  // ============================================================================

  // GET /variables/v2.0/VariableDefinitions - List variable definitions
  http.get(`${BASE_URL}/variables/v2.0/VariableDefinitions`, () => {
    return HttpResponse.json({
      totalItems: 3,
      data: [
        {
          id: 'var-001',
          scopes: ['Endpoint'],
          category: 'User',
          name: 'Department',
          type: 'String',
          defaultValue: '',
          comment: 'Employee department',
        },
        {
          id: 'var-002',
          scopes: ['Endpoint'],
          category: 'Software',
          name: 'InstallDate',
          type: 'DateTime',
          defaultValue: null,
          comment: 'Software installation date',
        },
        {
          id: 'var-003',
          scopes: ['Endpoint'],
          category: 'Asset',
          name: 'CostCenter',
          type: 'Integer',
          defaultValue: '1000',
          comment: 'Asset cost center code',
        },
      ],
    });
  }),

  // GET /variables/v2.0/VariableDefinitions/:id - Get specific variable definition
  http.get(`${BASE_URL}/variables/v2.0/VariableDefinitions/:id`, ({ params }) => {
    const id = params.id as string;

    // Return 404 for non-existent variable
    if (id === '00000000-0000-0000-0000-000000000000' || id === 'invalid-var-id') {
      return HttpResponse.json(
        { Message: 'Variable definition not found' },
        { status: 404 }
      );
    }

    // Return variable data for valid IDs
    if (id === 'var-001') {
      return HttpResponse.json({
        id: 'var-001',
        scopes: ['Endpoint'],
        category: 'User',
        name: 'Department',
        type: 'String',
        defaultValue: '',
        comment: 'Employee department',
      });
    }

    // Default: return generic variable data
    return HttpResponse.json({
      id: id,
      scopes: ['Endpoint'],
      category: 'Custom',
      name: `Variable-${id.slice(0, 8)}`,
      type: 'String',
      defaultValue: null,
      comment: null,
    });
  }),

  // GET /variables/v2.0/Endpoints/:endpointId/VariableInstances - Get variable instances for endpoint
  http.get(`${BASE_URL}/variables/v2.0/Endpoints/:endpointId/VariableInstances`, ({ params }) => {
    const { endpointId } = params;

    return HttpResponse.json({
      totalItems: 2,
      data: [
        {
          id: 'inst-001',
          ownerId: endpointId,
          ownerName: 'bms-win22srv',
          variableDefinitionId: 'var-001',
          name: 'Department',
          scope: 'Endpoint',
          category: 'User',
          type: 'String',
          value: 'IT',
          isDefault: false,
        },
        {
          id: 'inst-002',
          ownerId: endpointId,
          ownerName: 'bms-win22srv',
          variableDefinitionId: 'var-003',
          name: 'CostCenter',
          scope: 'Endpoint',
          category: 'Asset',
          type: 'Integer',
          value: '2000',
          isDefault: false,
        },
      ],
    });
  }),

  // ============================================================================
  // V2.0 API Handlers - Server Management Module
  // ============================================================================

  // GET /servermanagement/v2.0/ManagementServer - Get management server info
  http.get(`${BASE_URL}/servermanagement/v2.0/ManagementServer`, () => {
    return HttpResponse.json({
      name: 'bms-win22srv',
      version: '25.2.29.0',
      state: 'Running',
      plannedServerRestartTimes: null,
    });
  }),

  // GET /servermanagement/v2.0/Gateway - Get gateway info
  http.get(`${BASE_URL}/servermanagement/v2.0/Gateway`, () => {
    return HttpResponse.json({
      configurationStatus: 'Enrolled',
      availability: 'Up',
      lastContact: '2025-11-03T10:51:52.9510008Z',
    });
  }),

  // GET /servermanagement/v2.0/Dips - Get DIP status
  http.get(`${BASE_URL}/servermanagement/v2.0/Dips`, () => {
    return HttpResponse.json([
      {
        id: '839e6bec-47c0-4e06-8c4a-fa7d97ce79c2',
        hostName: 'bms-win22srv',
        state: 'Running',
        lastUpdate: '2025-11-03T10:53:27Z',
        details: 'Connected and operational',
      },
      {
        id: 'dip-002-guid',
        hostName: 'DIP-002',
        state: 'Running',
        lastUpdate: '2025-11-03T10:52:00Z',
        details: 'Connected and operational',
      },
    ]);
  }),

  // GET /servermanagement/v2.0/VpnAppliance - Get VPN appliance info
  http.get(`${BASE_URL}/servermanagement/v2.0/VpnAppliance`, () => {
    return HttpResponse.json({
      id: 'vpn-001',
      name: 'VPN Appliance',
      hostname: 'vpn.company.local',
      ipAddress: '192.168.1.40',
      isActive: true,
      connectedUsers: 42,
    });
  }),

  // GET /servermanagement/v2.0/Microservices - List microservices
  http.get(`${BASE_URL}/servermanagement/v2.0/Microservices`, () => {
    return HttpResponse.json([
      {
        id: 'micro-001',
        name: 'Inventory Service',
        state: 'Running',
        message: null,
      },
      {
        id: 'micro-002',
        name: 'Deployment Service',
        state: 'Running',
        message: null,
      },
    ]);
  }),

  // GET /servermanagement/v2.0/Microservices/:id - Get specific microservice
  http.get(`${BASE_URL}/servermanagement/v2.0/Microservices/:id`, ({ params }) => {
    const id = params.id as string;

    if (id === '00000000-0000-0000-0000-000000000000' || id === 'invalid-micro-id') {
      return HttpResponse.json(
        { Message: 'Microservice not found' },
        { status: 404 }
      );
    }

    if (id === 'micro-001') {
      return HttpResponse.json({
        id: 'micro-001',
        name: 'Inventory Service',
        state: 'Running',
        message: null,
      });
    }

    return HttpResponse.json({
      id: id,
      name: `Microservice-${id.slice(0, 8)}`,
      state: 'Running',
      message: null,
    });
  }),

  // GET /servermanagement/v2.0/CloudConnectors - List cloud connectors
  http.get(`${BASE_URL}/servermanagement/v2.0/CloudConnectors`, () => {
    return HttpResponse.json([
      {
        id: 'cloud-001',
        name: 'Azure Connector',
        provider: 'Azure',
        status: 'Connected',
        lastSync: '2025-01-29T10:00:00Z',
      },
    ]);
  }),

  // GET /servermanagement/v2.0/PxeRelays - List PXE relays
  http.get(`${BASE_URL}/servermanagement/v2.0/PxeRelays`, () => {
    return HttpResponse.json([
      {
        id: 'pxe-001',
        hostName: 'PXE-Relay-01',
        ipAddress: '192.168.1.50',
        state: 'Running',
        subnets: ['192.168.1.0/24'],
      },
    ]);
  }),

  // GET /servermanagement/v2.0/SecurityGroups - List security groups
  http.get(`${BASE_URL}/servermanagement/v2.0/SecurityGroups`, () => {
    return HttpResponse.json({
      totalItems: 2,
      data: [
        {
          id: 'secgroup-001',
          groupName: 'Administrators',
          assignedSecurityProfiles: [
            {
              id: 'profile-001',
              name: 'Full Access Profile',
            },
          ],
        },
        {
          id: 'secgroup-002',
          groupName: 'Operators',
          assignedSecurityProfiles: [
            {
              id: 'profile-002',
              name: 'Read Only Profile',
            },
          ],
        },
      ],
    });
  }),

  // GET /servermanagement/v2.0/SecurityGroups/:id - Get specific security group
  http.get(`${BASE_URL}/servermanagement/v2.0/SecurityGroups/:id`, ({ params }) => {
    const id = params.id as string;

    if (id === '00000000-0000-0000-0000-000000000000' || id === 'invalid-group-id') {
      return HttpResponse.json(
        { Message: 'Security group not found' },
        { status: 404 }
      );
    }

    if (id === 'secgroup-001') {
      return HttpResponse.json({
        id: 'secgroup-001',
        groupName: 'Administrators',
        assignedSecurityProfiles: [
          {
            id: 'profile-001',
            name: 'Full Access Profile',
          },
        ],
      });
    }

    return HttpResponse.json({
      id: id,
      groupName: `SecurityGroup-${id.slice(0, 8)}`,
      assignedSecurityProfiles: [],
    });
  }),

  // GET /servermanagement/v2.0/SecurityProfiles - List security profiles
  http.get(`${BASE_URL}/servermanagement/v2.0/SecurityProfiles`, () => {
    return HttpResponse.json({
      totalItems: 2,
      data: [
        {
          id: 'profile-001',
          name: 'Full Access Profile',
          comment: 'Complete system access',
          displayAdministratorIdentities: true,
          displayEndpointUserIdentities: true,
        },
        {
          id: 'profile-002',
          name: 'Read Only Profile',
          comment: 'View-only access',
          displayAdministratorIdentities: true,
          displayEndpointUserIdentities: false,
        },
      ],
    });
  }),

  // GET /servermanagement/v2.0/SecurityProfiles/:id - Get specific security profile
  http.get(`${BASE_URL}/servermanagement/v2.0/SecurityProfiles/:id`, ({ params }) => {
    const id = params.id as string;

    if (id === '00000000-0000-0000-0000-000000000000' || id === 'invalid-profile-id') {
      return HttpResponse.json(
        { Message: 'Security profile not found' },
        { status: 404 }
      );
    }

    if (id === 'profile-001') {
      return HttpResponse.json({
        id: 'profile-001',
        name: 'Full Access Profile',
        comment: 'Complete system access',
        displayAdministratorIdentities: true,
        displayEndpointUserIdentities: true,
      });
    }

    return HttpResponse.json({
      id: id,
      name: `SecurityProfile-${id.slice(0, 8)}`,
      comment: null,
      displayAdministratorIdentities: true,
      displayEndpointUserIdentities: true,
    });
  }),

  // ============================================================================
  // V2.0 API Handlers - Defense Control Module
  // ============================================================================

  // GET /defensecontrol/v2.0/BitLocker/WindowsEndpoints - List BitLocker endpoints
  http.get(`${BASE_URL}/defensecontrol/v2.0/BitLocker/WindowsEndpoints`, () => {
    return HttpResponse.json({
      totalItems: 2,
      data: [
        {
          endpointId: 'endpoint-001',
          endpointName: 'bms-win22srv',
          isSecureBootEnabled: true,
          isStartupPinEnabled: false,
          isStartupUsbKeyEnabled: false,
          networkUnlockStatus: 'NotSupported',
          tpmData: {
            version: '2.0',
            tpmStatus: 'Enabled',
            isOwned: true,
          },
          storageMedia: [
            {
              index: 0,
              name: 'Msft Virtual Disk',
              byteSize: 136365211648,
              busType: 'SAS',
              partitionStyle: 'GPT',
              storageVolumes: [
                {
                  bitLockerVolumeData: {
                    conversionStatus: 'FullyEncrypted',
                    encryptionPercentage: 100,
                    suspendCount: 0,
                    bitLockerVersion: 'Win7',
                    protectionStatus: 'Protected',
                    lockStatus: 'Unlocked',
                  },
                  driveLetter: 'C',
                  name: '',
                  fileSystem: 'NTFS',
                  fileSystemType: 'NTFS',
                  capacity: 136242524160,
                  freeSpace: 111446134784,
                  isSystemVolume: true,
                  volumeId: 'e70e6800-7c08-4ad5-b8e1-5c425f061fc9',
                  partitionType: 'Data',
                },
              ],
            },
          ],
        },
        {
          endpointId: 'endpoint-002',
          endpointName: 'PC-001',
          isSecureBootEnabled: true,
          isStartupPinEnabled: false,
          isStartupUsbKeyEnabled: false,
          networkUnlockStatus: 'Deactivated',
          tpmData: {
            version: '2.0',
            tpmStatus: 'Enabled',
            isOwned: true,
          },
          storageMedia: [],
        },
      ],
    });
  }),

  // GET /defensecontrol/v2.0/BitLocker/WindowsEndpoints/:id
  http.get(`${BASE_URL}/defensecontrol/v2.0/BitLocker/WindowsEndpoints/:id`, ({ params }) => {
    const id = params.id as string;

    if (id === '00000000-0000-0000-0000-000000000000') {
      return HttpResponse.json(
        { Message: 'Endpoint not found' },
        { status: 404 }
      );
    }

    return HttpResponse.json({
      endpointId: id,
      endpointName: 'bms-win22srv',
      isSecureBootEnabled: true,
      isStartupPinEnabled: false,
      isStartupUsbKeyEnabled: false,
      networkUnlockStatus: 'NotSupported',
      tpmData: {
        version: '2.0',
        tpmStatus: 'Enabled',
        isOwned: true,
      },
      storageMedia: [
        {
          index: 0,
          name: 'Msft Virtual Disk',
          byteSize: 136365211648,
          busType: 'SAS',
          partitionStyle: 'GPT',
          storageVolumes: [
            {
              bitLockerVolumeData: {
                conversionStatus: 'FullyEncrypted',
                encryptionPercentage: 100,
                suspendCount: 0,
                bitLockerVersion: 'Win7',
                protectionStatus: 'Protected',
                lockStatus: 'Unlocked',
              },
              driveLetter: 'C',
              name: '',
              fileSystem: 'NTFS',
              fileSystemType: 'NTFS',
              capacity: 136242524160,
              freeSpace: 111446134784,
              isSystemVolume: true,
              volumeId: 'e70e6800-7c08-4ad5-b8e1-5c425f061fc9',
              partitionType: 'Data',
            },
          ],
        },
      ],
    });
  }),

  // GET /defensecontrol/v2.0/MicrosoftDefender/Threats - List threats
  http.get(`${BASE_URL}/defensecontrol/v2.0/MicrosoftDefender/Threats`, () => {
    return HttpResponse.json({
      totalItems: 2,
      data: [
        {
          id: 'threat-001',
          name: 'Trojan.Generic',
          severity: 'High',
          status: 'Quarantined',
          detectedDate: '2025-01-28T10:00:00Z',
        },
        {
          id: 'threat-002',
          name: 'Adware.Win32',
          severity: 'Medium',
          status: 'Removed',
          detectedDate: '2025-01-29T08:00:00Z',
        },
      ],
    });
  }),

  // GET /defensecontrol/v2.0/MicrosoftDefender/Threats/:id
  http.get(`${BASE_URL}/defensecontrol/v2.0/MicrosoftDefender/Threats/:id`, ({ params }) => {
    const id = params.id as string;

    if (id === '00000000-0000-0000-0000-000000000000') {
      return HttpResponse.json(
        { Message: 'Threat not found' },
        { status: 404 }
      );
    }

    return HttpResponse.json({
      id: id,
      name: 'Trojan.Generic',
      severity: 'High',
      status: 'Quarantined',
      detectedDate: '2025-01-28T10:00:00Z',
      fileNames: ['C:\\Windows\\Temp\\malware.exe'],
    });
  }),

  // GET /defensecontrol/v2.0/MicrosoftDefender/WindowsEndpoints - List Defender states
  http.get(`${BASE_URL}/defensecontrol/v2.0/MicrosoftDefender/WindowsEndpoints`, () => {
    return HttpResponse.json({
      totalItems: 2,
      data: [
        {
          endpointId: 'endpoint-001',
          endpointName: 'bms-win22srv',
          isMicrosoftDefenderActive: true,
          microsoftDefenderState: {
            antimalware: {
              engineVersion: '1.1.24080.9',
              productVersion: '4.18.24080.9',
              runningMode: 'Normal',
              isActive: true,
              serviceVersion: '4.18.24080.9',
            },
            antispyware: {
              isActive: true,
              definitionCreation: '2024-10-18T03:10:15Z',
              definitionVersion: '1.419.569.0',
            },
            antivirus: {
              isActive: true,
              definitionCreation: '2024-10-18T03:10:13Z',
              definitionVersion: '1.419.569.0',
            },
            networkInspectionSystem: {
              isActive: true,
              engineVersion: '1.1.24080.9',
              definitionCreation: '2024-10-18T03:10:13Z',
              definitionVersion: '1.419.569.0',
            },
            isBehaviorMonitoringActive: true,
            isIoavProtectionActive: true,
            isTamperProtectionActive: true,
            isOnAccessProtectionActive: true,
            isRealTimeProtectionActive: true,
            realTimeScanDirection: 'IncomingAndOutgoingFiles',
            lastFullScan: '2024-10-18T08:46:54.792Z',
            lastQuickScan: '2024-10-18T06:54:21.453Z',
            highestSeverity: 'None',
            activeThreats: 0,
            resolvedThreats: 0,
          },
        },
        {
          endpointId: 'endpoint-002',
          endpointName: 'PC-001',
          isMicrosoftDefenderActive: true,
          microsoftDefenderState: {
            antimalware: {
              engineVersion: '1.1.25040.1',
              productVersion: '4.18.25040.2',
              runningMode: 'Normal',
              isActive: true,
              serviceVersion: '4.18.25040.2',
            },
            antispyware: {
              isActive: true,
              definitionCreation: '2025-05-23T04:32:56Z',
              definitionVersion: '1.429.144.0',
            },
            antivirus: {
              isActive: true,
              definitionCreation: '2025-05-23T04:32:57Z',
              definitionVersion: '1.429.144.0',
            },
            networkInspectionSystem: {
              isActive: true,
              engineVersion: '1.1.25040.1',
              definitionCreation: '2025-05-23T04:32:57Z',
              definitionVersion: '1.429.144.0',
            },
            isBehaviorMonitoringActive: true,
            isIoavProtectionActive: true,
            isTamperProtectionActive: true,
            isOnAccessProtectionActive: true,
            isRealTimeProtectionActive: true,
            realTimeScanDirection: 'IncomingAndOutgoingFiles',
            lastFullScan: null,
            lastQuickScan: '2025-05-23T09:39:55.353Z',
            highestSeverity: 'None',
            activeThreats: 0,
            resolvedThreats: 0,
          },
        },
      ],
    });
  }),

  // ============================================================================
  // V2.0 API Handlers - Operating Systems Module
  // ============================================================================

  // GET /operatingsystems/v2.0/WindowsEndpoints - List Windows endpoints with OS info
  http.get(`${BASE_URL}/operatingsystems/v2.0/WindowsEndpoints`, () => {
    return HttpResponse.json({
      totalItems: 3,
      data: [
        {
          endpointId: 'os-001',
          endpointName: 'bms-win22srv',
          bootEnvironmentId: null,
          hardwareProfileId: '0a11d10b-66c2-491c-87c5-9af04461142f',
          isOSInstallAllowed: false,
          inheritsAutoInstallation: true,
          operatingSystem: {
            name: 'Windows 11 Pro',
            version: {
              full: '10.0.22621',
              major: 10,
              minor: 0,
              build: 22621,
              patchLevel: 0,
            },
            displayVersion: '22H2',
            releaseId: '2009',
            localeId: 1033,
          },
        },
        {
          endpointId: 'os-002',
          endpointName: 'WIN-SERVER-01',
          bootEnvironmentId: null,
          hardwareProfileId: '0a11d10b-66c2-491c-87c5-9af04461142f',
          isOSInstallAllowed: false,
          inheritsAutoInstallation: true,
          operatingSystem: {
            name: 'Windows Server 2022',
            version: {
              full: '10.0.20348',
              major: 10,
              minor: 0,
              build: 20348,
              patchLevel: 0,
            },
            displayVersion: '21H2',
            releaseId: '2009',
            localeId: 1033,
          },
        },
        {
          endpointId: 'os-003',
          endpointName: 'WIN-CLIENT-01',
          bootEnvironmentId: null,
          hardwareProfileId: '0a11d10b-66c2-491c-87c5-9af04461142f',
          isOSInstallAllowed: false,
          inheritsAutoInstallation: true,
          operatingSystem: {
            name: 'Windows 10 Enterprise',
            version: {
              full: '10.0.19045',
              major: 10,
              minor: 0,
              build: 19045,
              patchLevel: 0,
            },
            displayVersion: '22H2',
            releaseId: '2009',
            localeId: 1033,
          },
        },
      ],
    });
  }),

  // GET /operatingsystems/v2.0/WindowsEndpoints/:id - Get specific endpoint OS info
  http.get(`${BASE_URL}/operatingsystems/v2.0/WindowsEndpoints/:id`, ({ params }) => {
    const id = params.id as string;

    if (id === '00000000-0000-0000-0000-000000000000') {
      return HttpResponse.json(
        { Message: 'Operating system endpoint not found' },
        { status: 404 }
      );
    }

    return HttpResponse.json({
      endpointId: id,
      endpointName: 'bms-win22srv',
      bootEnvironmentId: null,
      hardwareProfileId: '0a11d10b-66c2-491c-87c5-9af04461142f',
      isOSInstallAllowed: false,
      inheritsAutoInstallation: true,
      operatingSystem: {
        name: 'Windows 11 Pro',
        version: {
          full: '10.0.22621',
          major: 10,
          minor: 0,
          build: 22621,
          patchLevel: 0,
        },
        displayVersion: '22H2',
        releaseId: '2009',
        localeId: 1033,
      },
    });
  }),

  // ============================================================================
  // V2.0 API Handlers - Update Management Module
  // ============================================================================

  // GET /updatemanagement/v2.0/WindowsEndpoints - List Windows endpoints with update info
  http.get(`${BASE_URL}/updatemanagement/v2.0/WindowsEndpoints`, () => {
    return HttpResponse.json({
      totalItems: 2,
      data: [
        {
          endpointId: 'endpoint-001',
          endpointName: 'bms-win22srv',
          updateProfileId: '27b22f86-0c8d-4c9f-8978-6b6d9398956c',
          updateProfileName: 'Critical Updates Only',
          missingCriticalUpdates: 0,
          missingSecurityUpdates: 1,
          missingOtherUpdates: 0,
          updateDownloadMode: 'HttpOnly',
          lastInventory: '2024-10-18T07:16:01Z',
          lastInventorySource: 'WindowsOnline',
          lastSuccessfulUpdate: '2024-10-18T06:49:35Z',
          lastSuccessfulUpdateSource: 'WindowsOnline',
          deferredUpdates: 0,
          blockedUpdates: 0,
          featureUpdatesAvailable: false,
          updateState: 'InventoryOutdated',
          targetReleaseVersion: '',
        },
        {
          endpointId: 'endpoint-002',
          endpointName: 'WIN-CLIENT-01',
          updateProfileId: '27b22f86-0c8d-4c9f-8978-6b6d9398956c',
          updateProfileName: 'All Updates',
          missingCriticalUpdates: 2,
          missingSecurityUpdates: 5,
          missingOtherUpdates: 5,
          updateDownloadMode: 'HttpOnly',
          lastInventory: '2024-10-17T14:20:00Z',
          lastInventorySource: 'WindowsOnline',
          lastSuccessfulUpdate: '2024-10-15T08:30:00Z',
          lastSuccessfulUpdateSource: 'WindowsOnline',
          deferredUpdates: 0,
          blockedUpdates: 0,
          featureUpdatesAvailable: true,
          updateState: 'UpdatesPending',
          targetReleaseVersion: '22H2',
        },
      ],
    });
  }),

  // GET /updatemanagement/v2.0/WindowsEndpoints/:id - Get specific endpoint update info
  http.get(`${BASE_URL}/updatemanagement/v2.0/WindowsEndpoints/:id`, ({ params }) => {
    const id = params.id as string;

    if (id === '00000000-0000-0000-0000-000000000000') {
      return HttpResponse.json(
        { Message: 'Update management endpoint not found' },
        { status: 404 }
      );
    }

    return HttpResponse.json({
      endpointId: id,
      endpointName: 'bms-win22srv',
      updateProfileId: '27b22f86-0c8d-4c9f-8978-6b6d9398956c',
      updateProfileName: 'Critical Updates Only',
      missingCriticalUpdates: 0,
      missingSecurityUpdates: 1,
      missingOtherUpdates: 0,
      updateDownloadMode: 'HttpOnly',
      lastInventory: '2024-10-18T07:16:01Z',
      lastInventorySource: 'WindowsOnline',
      lastSuccessfulUpdate: '2024-10-18T06:49:35Z',
      lastSuccessfulUpdateSource: 'WindowsOnline',
      deferredUpdates: 0,
      blockedUpdates: 0,
      featureUpdatesAvailable: false,
      updateState: 'InventoryOutdated',
      targetReleaseVersion: '',
    });
  }),

  // ============================================================================
  // V2.0 API Handlers - Software Module
  // ============================================================================

  // GET /software/v2.0/InstalledWindowsSoftware - List installed Windows software
  http.get(`${BASE_URL}/software/v2.0/InstalledWindowsSoftware`, () => {
    return HttpResponse.json({
      totalItems: 3,
      data: [
        {
          endpointId: 'endpoint-001',
          name: 'Microsoft Office 2021',
          version: '16.0.14332',
          publisher: 'Microsoft Corporation',
          installDate: '2024-01-15',
        },
        {
          endpointId: 'endpoint-002',
          name: 'Adobe Acrobat Reader',
          version: '23.001.20143',
          publisher: 'Adobe Inc.',
          installDate: '2024-02-10',
        },
        {
          endpointId: 'endpoint-001',
          name: '7-Zip',
          version: '23.01',
          publisher: 'Igor Pavlov',
          installDate: '2024-03-05',
        },
      ],
    });
  }),

  // ============================================================================
  // Error Handling - Simulate API Errors
  // ============================================================================

  // Catch-all handler for unhandled requests (useful for debugging)
  // This will log unhandled requests to help identify missing handlers
];
