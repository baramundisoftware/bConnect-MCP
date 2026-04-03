/**
 * MSW Request Handlers for bConnect API Mock
 *
 * Mocks HTTP responses for integration and E2E tests.
 * Each handler corresponds to a bConnect API endpoint.
 */

import { http, HttpResponse } from 'msw';

const BASE_URL = 'https://bms-win22srv:444/bconnect';

export const handlers = [
  // ========================================
  // Endpoints API - Windows Endpoints
  // ========================================

  // List Windows endpoints
  http.get(`${BASE_URL}/endpoints/v2.0/WindowsEndpoints`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');

    return HttpResponse.json({
      totalItems: 8,
      data: [
        {
          id: 'endpoint-001',
          displayName: 'bms-win22srv',
          osType: 'Windows',
          ipAddress: '192.168.1.10',
          lastSeen: '2025-01-29T10:00:00Z'
        },
        {
          id: 'endpoint-002',
          displayName: 'PC-001',
          osType: 'Windows',
          ipAddress: '192.168.1.20',
          lastSeen: '2025-01-29T09:30:00Z'
        }
      ].slice(page * pageSize, (page + 1) * pageSize)
    });
  }),

  // Get specific Windows endpoint
  http.get(`${BASE_URL}/endpoints/v2.0/WindowsEndpoints/:id`, ({ params }) => {
    const { id } = params;

    // Return 404 for non-existent endpoint (e.g., all zeros GUID)
    if (id === '00000000-0000-0000-0000-000000000000' || id === 'invalid-id') {
      return HttpResponse.json(
        { Message: 'Endpoint not found' },
        { status: 404 }
      );
    }

    // Return endpoint data for valid IDs
    return HttpResponse.json({
      id: params.id,
      displayName: 'bms-win22srv',
      osType: 'Windows',
      ipAddress: '192.168.1.10',
      macAddress: '00:11:22:33:44:55',
      lastSeen: '2025-01-29T10:00:00Z',
      manufacturer: 'VMware',
      model: 'Virtual Machine',
      operatingSystem: 'Microsoft Windows Server 2022 Standard',
      primaryIP: '172.21.165.56'
    });
  }),

  // ========================================
  // Endpoints API - Logical Groups
  // ========================================

  // List logical groups
  http.get(`${BASE_URL}/endpoints/v2.0/LogicalGroups`, () => {
    return HttpResponse.json({
      totalItems: 3,
      data: [
        { id: 'group-001', name: 'All Windows Endpoints', memberCount: 8 },
        { id: 'group-002', name: 'Test Group', memberCount: 2 },
        { id: 'group-003', name: 'Production Servers', memberCount: 3 }
      ]
    });
  }),

  // Get specific logical group
  http.get(`${BASE_URL}/endpoints/v2.0/LogicalGroups/:id`, ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      name: 'All Windows Endpoints',
      description: 'Dynamic group containing all Windows endpoints',
      memberCount: 8,
      isDynamic: true
    });
  }),

  // List endpoints in logical group
  http.get(`${BASE_URL}/endpoints/v2.0/LogicalGroups/:id/Endpoints`, ({ params }) => {
    return HttpResponse.json({
      totalItems: 8,
      data: [
        { id: 'endpoint-001', displayName: 'bms-win22srv', osType: 'Windows' },
        { id: 'endpoint-002', displayName: 'PC-001', osType: 'Windows' }
      ]
    });
  }),

  // ========================================
  // Jobs API
  // ========================================

  // List job definitions
  http.get(`${BASE_URL}/jobs/v2.0/JobDefinitions`, () => {
    return HttpResponse.json({
      totalItems: 5,
      data: [
        {
          id: 'job-001',
          name: 'Windows Updates',
          type: 'Update',
          lastModified: '2025-01-20T10:00:00Z'
        },
        {
          id: 'job-002',
          name: 'Software Deploy',
          type: 'SoftwareDeployment',
          lastModified: '2025-01-25T14:30:00Z'
        }
      ]
    });
  }),

  // Get specific job definition
  http.get(`${BASE_URL}/jobs/v2.0/JobDefinitions/:id`, ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      name: 'Windows Updates',
      description: 'Deploy Windows updates to endpoints',
      type: 'Update',
      lastModified: '2025-01-20T10:00:00Z',
      steps: [
        { id: 'step-001', name: 'Check for updates', order: 1 },
        { id: 'step-002', name: 'Install updates', order: 2 }
      ]
    });
  }),

  // List job instances
  http.get(`${BASE_URL}/jobs/v2.0/JobInstances`, () => {
    return HttpResponse.json({
      totalItems: 20,
      data: [
        {
          id: 'instance-001',
          jobDefinitionId: 'job-001',
          endpointId: 'endpoint-001',
          status: 'Success',
          startTime: '2025-01-29T08:00:00Z',
          endTime: '2025-01-29T08:15:00Z'
        },
        {
          id: 'instance-002',
          jobDefinitionId: 'job-001',
          endpointId: 'endpoint-002',
          status: 'Running',
          startTime: '2025-01-29T09:00:00Z'
        }
      ]
    });
  }),

  // Create job instance (POST)
  http.post(`${BASE_URL}/jobs/v2.0/JobInstances`, async ({ request }) => {
    const body = await request.json() as { JobDefinitionId?: string; EndpointId?: string };
    return HttpResponse.json({
      id: 'instance-new',
      jobDefinitionId: body?.JobDefinitionId || 'default-job',
      endpointId: body?.EndpointId || 'default-endpoint',
      status: 'Pending',
      createdAt: new Date().toISOString()
    }, { status: 201 });
  }),

  // Delete job instance
  http.delete(`${BASE_URL}/jobs/v2.0/JobInstances/:id`, ({ params }) => {
    return new HttpResponse(null, { status: 204 });
  }),

  // ========================================
  // Assets API
  // ========================================

  // List assets
  http.get(`${BASE_URL}/assets/v2.0/Assets`, () => {
    return HttpResponse.json({
      totalItems: 10,
      data: [
        {
          id: 'asset-001',
          name: 'Laptop Dell Latitude',
          assetType: 'Hardware',
          serialNumber: 'SN123456',
          status: 'In Use'
        },
        {
          id: 'asset-002',
          name: 'Microsoft Office License',
          assetType: 'Software',
          licenseKey: 'XXXXX-XXXXX',
          status: 'Active'
        }
      ]
    });
  }),

  // ========================================
  // Active Directory API
  // ========================================

  // List AD users
  http.get(`${BASE_URL}/activedirectory/v2.0/Users`, () => {
    return HttpResponse.json({
      totalItems: 50,
      data: [
        {
          id: 'user-001',
          username: 'john.doe',
          displayName: 'John Doe',
          email: 'john.doe@company.com'
        },
        {
          id: 'user-002',
          username: 'jane.smith',
          displayName: 'Jane Smith',
          email: 'jane.smith@company.com'
        }
      ]
    });
  }),

  // ========================================
  // Variables API
  // ========================================

  // List variable definitions
  http.get(`${BASE_URL}/variables/v2.0/VariableDefinitions`, () => {
    return HttpResponse.json({
      totalItems: 15,
      data: [
        {
          id: 'var-001',
          name: 'Department',
          type: 'String',
          description: 'Employee department'
        },
        {
          id: 'var-002',
          name: 'InstallDate',
          type: 'DateTime',
          description: 'Software installation date'
        }
      ]
    });
  }),

  // ========================================
  // V1.1 APIs
  // ========================================

  // List compliance violations (V1.1)
  http.get(`${BASE_URL}/defensecontrol/v1.1/ComplianceViolations`, () => {
    return HttpResponse.json({
      data: [
        {
          endpointId: 'endpoint-001',
          cveId: 'CVE-2024-12345',
          severity: 'High',
          detectedDate: '2025-01-28T10:00:00Z'
        },
        {
          endpointId: 'endpoint-002',
          cveId: 'CVE-2024-67890',
          severity: 'Critical',
          detectedDate: '2025-01-29T08:00:00Z'
        }
      ]
    });
  }),

  // Get BitLocker secrets (V1.1)
  http.get(`${BASE_URL}/v1.1/BitLockerSecrets`, () => {
    return HttpResponse.json({
      data: [
        {
          endpointId: 'endpoint-001',
          recoveryKey: 'XXXXXX-XXXXXX-XXXXXX-XXXXXX',
          tpmPassword: 'TPM_PASSWORD_HASH'
        }
      ]
    });
  }),

  // ========================================
  // Error Handlers (for testing error cases)
  // ========================================

  // 404 Not Found
  http.get(`${BASE_URL}/endpoints/v2.0/WindowsEndpoints/invalid-id`, () => {
    return HttpResponse.json(
      { Message: 'Endpoint not found' },
      { status: 404 }
    );
  }),

  // 401 Unauthorized
  http.get(`${BASE_URL}/unauthorized`, () => {
    return HttpResponse.json(
      { Message: 'Authentication failed' },
      { status: 401 }
    );
  }),

  // 500 Internal Server Error
  http.get(`${BASE_URL}/server-error`, () => {
    return HttpResponse.json(
      { Message: 'Internal server error' },
      { status: 500 }
    );
  })
];
