import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { BConnectClient } from '../../../bconnect-client.js';
import {
  TEST_ENDPOINT_IDS,
  TEST_LOGICAL_GROUP_IDS
} from '../helpers/test-data-fixtures.js';
import {
  expectValidMCPResponse,
  expectJSONResponse
} from '../helpers/assertions.js';

// Test configuration
const BASE_URL = 'https://bms-win22srv:444/bconnect';
const TEST_DYNAMIC_GROUP_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

// Mock installed software data
const mockInstalledSoftware = Array.from({ length: 50 }, (_, i) => ({
  id: `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
  name: `Software-${i}`,
  version: `1.${i}.0`,
  publisher: i % 2 === 0 ? "Microsoft Corporation" : "Adobe Inc.",
  installDate: "2024-01-15",
  endpointId: TEST_ENDPOINT_IDS.WINDOWS_VALID,
  endpointName: "bms-win22srv"
}));

// MSW HTTP Handlers
const handlers = [
  // GET /software/v2.0/InstalledWindowsSoftware - List all installed software
  http.get(`${BASE_URL}/software/v2.0/InstalledWindowsSoftware`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');

    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedData = mockInstalledSoftware.slice(startIndex, endIndex);

    return HttpResponse.json({
      totalItems: mockInstalledSoftware.length,
      data: paginatedData
    });
  }),

  // GET /software/v2.0/WindowsEndpoints/{endpointId}/InstalledWindowsSoftware
  http.get(`${BASE_URL}/software/v2.0/WindowsEndpoints/:endpointId/InstalledWindowsSoftware`,
    ({ params, request }) => {
      const url = new URL(request.url);
      const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
      const page = parseInt(url.searchParams.get('Page') || '0');

      const endpointSoftware = mockInstalledSoftware.filter(s =>
        s.endpointId === params.endpointId
      );

      const startIndex = page * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedData = endpointSoftware.slice(startIndex, endIndex);

      return HttpResponse.json({
        totalItems: endpointSoftware.length,
        data: paginatedData
      });
    }
  ),

  // GET /software/v2.0/LogicalGroups/{logicalGroupId}/InstalledWindowsSoftware
  http.get(`${BASE_URL}/software/v2.0/LogicalGroups/:logicalGroupId/InstalledWindowsSoftware`,
    ({ request }) => {
      const url = new URL(request.url);
      const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
      const page = parseInt(url.searchParams.get('Page') || '0');

      const startIndex = page * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedData = mockInstalledSoftware.slice(startIndex, endIndex);

      return HttpResponse.json({
        totalItems: mockInstalledSoftware.length,
        data: paginatedData
      });
    }
  ),

  // GET /software/v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/InstalledWindowsSoftware
  http.get(`${BASE_URL}/software/v2.0/UniversalDynamicGroups/:universalDynamicGroupId/InstalledWindowsSoftware`,
    ({ request }) => {
      const url = new URL(request.url);
      const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
      const page = parseInt(url.searchParams.get('Page') || '0');

      const startIndex = page * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedData = mockInstalledSoftware.slice(startIndex, endIndex);

      return HttpResponse.json({
        totalItems: mockInstalledSoftware.length,
        data: paginatedData
      });
    }
  )
];

// Setup MSW server
const server = setupServer(...handlers);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

// ============================================================================
// SOFTWARE MCP TOOLS - E2E TESTS
// ============================================================================

describe('Software MCP Tools - E2E Tests', () => {
  const bconnect = new BConnectClient({
    baseUrl: BASE_URL,
    username: 'Administrator',
    password: 'baramundi-2008',
    rejectUnauthorized: false,
      disableHttpsAgent: true  // Disable HTTPS agent to allow MSW interception
  });

  async function executeMCPTool(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case "list_installed_windows_software":
        const software = await bconnect.software.getInstalledWindowsSoftware(args || {});
        return {
          content: [{
            type: "text",
            text: JSON.stringify(software, null, 2)
          }]
        };

      case "list_installed_software_by_endpoint":
        if (!args?.endpointId) {
          throw new Error("endpointId is required");
        }
        const softwareByEndpoint = await bconnect.software.getInstalledSoftwareByEndpoint(
          args.endpointId,
          args || {}
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify(softwareByEndpoint, null, 2)
          }]
        };

      case "list_installed_software_by_logical_group":
        if (!args?.logicalGroupId) {
          throw new Error("logicalGroupId is required");
        }
        const softwareByGroup = await bconnect.software.getInstalledSoftwareByLogicalGroup(
          args.logicalGroupId,
          args || {}
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify(softwareByGroup, null, 2)
          }]
        };

      case "list_installed_software_by_universal_dynamic_group":
        if (!args?.universalDynamicGroupId) {
          throw new Error("universalDynamicGroupId is required");
        }
        const softwareByDynamicGroup = await bconnect.software.getInstalledSoftwareByUniversalDynamicGroup(
          args.universalDynamicGroupId,
          args || {}
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify(softwareByDynamicGroup, null, 2)
          }]
        };

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  // ==========================================================================
  // list_installed_windows_software
  // ==========================================================================

  describe('list_installed_windows_software', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = { PageSize: 10, Page: 0 };
      const result = await executeMCPTool("list_installed_windows_software", parameters);
      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
      expect(data.data.length).toBeLessThanOrEqual(10);
    });

    it('should return paginated results with correct page size', async () => {
      const parameters = { PageSize: 5, Page: 0 };
      const result = await executeMCPTool("list_installed_windows_software", parameters);
      const data = expectJSONResponse(result);
      expect(data.data.length).toBeLessThanOrEqual(5);
      expect(data.totalItems).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // list_installed_software_by_endpoint
  // ==========================================================================

  describe('list_installed_software_by_endpoint', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = {
        endpointId: TEST_ENDPOINT_IDS.WINDOWS_VALID,
        PageSize: 10,
        Page: 0
      };
      const result = await executeMCPTool("list_installed_software_by_endpoint", parameters);
      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
    });

    it('should reject request without required endpointId parameter', async () => {
      const parameters = { PageSize: 10 };
      await expect(
        executeMCPTool("list_installed_software_by_endpoint", parameters)
      ).rejects.toThrow("endpointId is required");
    });
  });

  // ==========================================================================
  // list_installed_software_by_logical_group
  // ==========================================================================

  describe('list_installed_software_by_logical_group', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = {
        logicalGroupId: TEST_LOGICAL_GROUP_IDS.VALID,
        PageSize: 10,
        Page: 0
      };
      const result = await executeMCPTool("list_installed_software_by_logical_group", parameters);
      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
    });

    it('should reject request without required logicalGroupId parameter', async () => {
      const parameters = { PageSize: 10 };
      await expect(
        executeMCPTool("list_installed_software_by_logical_group", parameters)
      ).rejects.toThrow("logicalGroupId is required");
    });
  });

  // ==========================================================================
  // list_installed_software_by_universal_dynamic_group
  // ==========================================================================

  describe('list_installed_software_by_universal_dynamic_group', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = {
        universalDynamicGroupId: TEST_DYNAMIC_GROUP_ID,
        PageSize: 10,
        Page: 0
      };
      const result = await executeMCPTool("list_installed_software_by_universal_dynamic_group", parameters);
      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
    });

    it('should reject request without required universalDynamicGroupId parameter', async () => {
      const parameters = { PageSize: 10 };
      await expect(
        executeMCPTool("list_installed_software_by_universal_dynamic_group", parameters)
      ).rejects.toThrow("universalDynamicGroupId is required");
    });
  });
});
