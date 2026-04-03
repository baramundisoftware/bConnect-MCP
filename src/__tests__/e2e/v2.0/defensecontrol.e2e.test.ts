/**
 * E2E Tests for Defense Control MCP Tools
 *
 * Tests the complete execution flow of Defense Control MCP tools:
 * - Tool handler execution
 * - bConnect client HTTP requests
 * - MSW mock API responses
 * - MCP response format validation
 *
 * Uses MSW (Mock Service Worker) for HTTP mocking to avoid external dependencies.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { BConnectClient } from '../../../bconnect-client.js';
import {
  TEST_ENDPOINT_IDS,
  TEST_LOGICAL_GROUP_IDS,
  TEST_THREAT_IDS,
  MOCK_BITLOCKER_ENDPOINT,
  MOCK_DEFENDER_THREAT,
  MOCK_DEFENDER_ENDPOINT,
  MOCK_LOCAL_ADMIN_ACCOUNT,
  generateMockBitLockerEndpoints,
  generateMockDefenderThreats,
  generateMockDefenderEndpoints
} from '../../e2e/helpers/test-data-fixtures.js';
import {
  expectValidMCPResponse,
  expectJSONResponse
} from '../../e2e/helpers/assertions.js';

const BASE_URL = 'https://bms-win22srv:444/bconnect';

// Generate stable mock data outside handlers (prevents random test failures)
const allMockBitLockerEndpoints = generateMockBitLockerEndpoints(30);
const allMockDefenderThreats = generateMockDefenderThreats(50);
const allMockDefenderEndpoints = generateMockDefenderEndpoints(40);

// MSW Request Handlers for Defense Control API
const handlers = [
  // GET /defensecontrol/v2.0/BitLocker/WindowsEndpoints - List BitLocker endpoints
  http.get(`${BASE_URL}/defensecontrol/v2.0/BitLocker/WindowsEndpoints`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');
    const searchQuery = url.searchParams.get('SearchQuery') || '';

    let filteredEndpoints = [...allMockBitLockerEndpoints];

    // Apply search filter
    if (searchQuery) {
      filteredEndpoints = filteredEndpoints.filter(e =>
        e.endpointName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.encryptionStatus.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Apply pagination
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedData = filteredEndpoints.slice(startIndex, endIndex);

    return HttpResponse.json({
      totalItems: filteredEndpoints.length,
      data: paginatedData
    });
  }),

  // GET /defensecontrol/v2.0/BitLocker/WindowsEndpoints/{id} - Get specific BitLocker endpoint
  http.get(`${BASE_URL}/defensecontrol/v2.0/BitLocker/WindowsEndpoints/:id`, ({ params }) => {
    const { id } = params;

    if (id === TEST_ENDPOINT_IDS.WINDOWS_VALID) {
      return HttpResponse.json(MOCK_BITLOCKER_ENDPOINT);
    }

    return HttpResponse.json(
      { error: 'BitLocker endpoint not found' },
      { status: 404 }
    );
  }),

  // GET /defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id} - Get local admin accounts
  http.get(`${BASE_URL}/defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/:id`, ({ params }) => {
    const { id } = params;

    if (id === TEST_ENDPOINT_IDS.WINDOWS_VALID) {
      return HttpResponse.json(MOCK_LOCAL_ADMIN_ACCOUNT);
    }

    return HttpResponse.json(
      { error: 'Local admin account not found' },
      { status: 404 }
    );
  }),

  // GET /defensecontrol/v2.0/MicrosoftDefender/Threats - List all threats
  http.get(`${BASE_URL}/defensecontrol/v2.0/MicrosoftDefender/Threats`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');
    const searchQuery = url.searchParams.get('SearchQuery') || '';

    let filteredThreats = [...allMockDefenderThreats];

    // Apply search filter
    if (searchQuery) {
      filteredThreats = filteredThreats.filter(t =>
        t.threatName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.threatType.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.severity.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Apply pagination
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedData = filteredThreats.slice(startIndex, endIndex);

    return HttpResponse.json({
      totalItems: filteredThreats.length,
      data: paginatedData
    });
  }),

  // GET /defensecontrol/v2.0/MicrosoftDefender/Threats/{id} - Get specific threat
  http.get(`${BASE_URL}/defensecontrol/v2.0/MicrosoftDefender/Threats/:id`, ({ params }) => {
    const { id } = params;

    if (id === TEST_THREAT_IDS.VALID) {
      return HttpResponse.json(MOCK_DEFENDER_THREAT);
    }

    return HttpResponse.json(
      { error: 'Threat not found' },
      { status: 404 }
    );
  }),

  // GET /defensecontrol/v2.0/MicrosoftDefender/WindowsEndpoints/{endpointId}/Threats - List threats by endpoint
  http.get(`${BASE_URL}/defensecontrol/v2.0/MicrosoftDefender/WindowsEndpoints/:endpointId/Threats`,
    ({ params, request }) => {
      const { endpointId } = params;
      const url = new URL(request.url);
      const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
      const page = parseInt(url.searchParams.get('Page') || '0');

      // For test purposes, return a subset of threats for this endpoint
      const endpointThreats = allMockDefenderThreats.filter(t =>
        t.endpointId === endpointId
      );

      // Apply pagination
      const startIndex = page * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedData = endpointThreats.slice(startIndex, endIndex);

      return HttpResponse.json({
        totalItems: endpointThreats.length,
        data: paginatedData
      });
    }
  ),

  // GET /defensecontrol/v2.0/MicrosoftDefender/LogicalGroups/{logicalGroupId}/Threats - List threats by logical group
  http.get(`${BASE_URL}/defensecontrol/v2.0/MicrosoftDefender/LogicalGroups/:logicalGroupId/Threats`,
    ({ params, request }) => {
      const { logicalGroupId } = params;
      const url = new URL(request.url);
      const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
      const page = parseInt(url.searchParams.get('Page') || '0');

      // For test purposes, return a subset of threats for this logical group
      const groupThreats = allMockDefenderThreats.slice(0, 5);

      // Apply pagination
      const startIndex = page * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedData = groupThreats.slice(startIndex, endIndex);

      return HttpResponse.json({
        totalItems: groupThreats.length,
        data: paginatedData
      });
    }
  ),

  // GET /defensecontrol/v2.0/MicrosoftDefender/WindowsEndpoints - List Defender endpoints
  http.get(`${BASE_URL}/defensecontrol/v2.0/MicrosoftDefender/WindowsEndpoints`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');
    const searchQuery = url.searchParams.get('SearchQuery') || '';

    let filteredEndpoints = [...allMockDefenderEndpoints];

    // Apply search filter
    if (searchQuery) {
      filteredEndpoints = filteredEndpoints.filter(e =>
        e.endpointName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.productStatus.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Apply pagination
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedData = filteredEndpoints.slice(startIndex, endIndex);

    return HttpResponse.json({
      totalItems: filteredEndpoints.length,
      data: paginatedData
    });
  }),

  // GET /defensecontrol/v2.0/MicrosoftDefender/WindowsEndpoints/{id} - Get specific Defender endpoint
  http.get(`${BASE_URL}/defensecontrol/v2.0/MicrosoftDefender/WindowsEndpoints/:id`, ({ params }) => {
    const { id } = params;

    if (id === TEST_ENDPOINT_IDS.WINDOWS_VALID) {
      return HttpResponse.json(MOCK_DEFENDER_ENDPOINT);
    }

    return HttpResponse.json(
      { error: 'Defender endpoint not found' },
      { status: 404 }
    );
  }),
];

// Setup MSW server
const server = setupServer(...handlers);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

// Create bConnect client for testing
const bconnect = new BConnectClient({
  baseUrl: BASE_URL,
  username: 'Administrator',
  password: 'baramundi-2008',
  rejectUnauthorized: false,
      disableHttpsAgent: true  // Disable HTTPS agent to allow MSW interception
});

/**
 * Execute MCP tool by name (mimics CallToolRequestSchema handler)
 * This tests the tool handler logic without MCP transport complexity
 */
async function executeMCPTool(toolName: string, args: any): Promise<any> {
  switch (toolName) {
    case "list_bitlocker_windows_endpoints":
      const bitlockerEndpoints = await bconnect.defensecontrol.getBitLockerWindowsEndpoints(args || {});
      return {
        content: [{
          type: "text",
          text: JSON.stringify(bitlockerEndpoints, null, 2)
        }]
      };

    case "get_bitlocker_windows_endpoint":
      if (!args?.id) {
        throw new Error("id is required");
      }
      const bitlockerEndpoint = await bconnect.defensecontrol.getBitLockerWindowsEndpoint(args.id);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(bitlockerEndpoint, null, 2)
        }]
      };

    case "get_local_admin_accounts":
      if (!args?.id) {
        throw new Error("id is required");
      }
      const localAdminAccount = await bconnect.defensecontrol.getLocalAdministrativeAccounts(args.id);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(localAdminAccount, null, 2)
        }]
      };

    case "list_defender_threats":
      const defenderThreats = await bconnect.defensecontrol.getMicrosoftDefenderThreats(args || {});
      return {
        content: [{
          type: "text",
          text: JSON.stringify(defenderThreats, null, 2)
        }]
      };

    case "get_defender_threat":
      if (!args?.id) {
        throw new Error("id is required");
      }
      const defenderThreat = await bconnect.defensecontrol.getMicrosoftDefenderThreat(args.id);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(defenderThreat, null, 2)
        }]
      };

    case "list_defender_threats_by_endpoint":
      if (!args?.endpointId) {
        throw new Error("endpointId is required");
      }
      const endpointThreats = await bconnect.defensecontrol.getMicrosoftDefenderThreatsByEndpoint(
        args.endpointId,
        args
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify(endpointThreats, null, 2)
        }]
      };

    case "list_defender_threats_by_logical_group":
      if (!args?.logicalGroupId) {
        throw new Error("logicalGroupId is required");
      }
      const groupThreats = await bconnect.defensecontrol.getMicrosoftDefenderThreatsByLogicalGroup(
        args.logicalGroupId,
        args
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify(groupThreats, null, 2)
        }]
      };

    case "list_defender_windows_endpoints":
      const defenderEndpoints = await bconnect.defensecontrol.getMicrosoftDefenderWindowsEndpoints(args || {});
      return {
        content: [{
          type: "text",
          text: JSON.stringify(defenderEndpoints, null, 2)
        }]
      };

    case "get_defender_windows_endpoint":
      if (!args?.id) {
        throw new Error("id is required");
      }
      const defenderEndpoint = await bconnect.defensecontrol.getMicrosoftDefenderWindowsEndpoint(args.id);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(defenderEndpoint, null, 2)
        }]
      };

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

describe('Defense Control MCP Tools - E2E Tests', () => {
  describe('list_bitlocker_windows_endpoints', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = { PageSize: 10, Page: 0 };
      const result = await executeMCPTool("list_bitlocker_windows_endpoints", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
      expect(data.data.length).toBeLessThanOrEqual(10);
    });

    it('should return paginated results with correct page size', async () => {
      const parameters = { PageSize: 5, Page: 0 };
      const result = await executeMCPTool("list_bitlocker_windows_endpoints", parameters);

      const data = expectJSONResponse(result);
      expect(data.data.length).toBeLessThanOrEqual(5);
      expect(data.totalItems).toBeGreaterThan(0);
    });
  });

  describe('get_bitlocker_windows_endpoint', () => {
    it('should execute tool and return valid MCP response for existing endpoint', async () => {
      const parameters = { id: TEST_ENDPOINT_IDS.WINDOWS_VALID };
      const result = await executeMCPTool("get_bitlocker_windows_endpoint", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toBeDefined();
    });

    it('should return 404 error for non-existent endpoint', async () => {
      const parameters = { id: TEST_ENDPOINT_IDS.INVALID };

      await expect(
        executeMCPTool("get_bitlocker_windows_endpoint", parameters)
      ).rejects.toThrow();
    });

    it('should reject request without required id parameter', async () => {
      const parameters = {};

      await expect(
        executeMCPTool("get_bitlocker_windows_endpoint", parameters)
      ).rejects.toThrow(/id is required/);
    });
  });

  describe('get_local_admin_accounts', () => {
    it('should execute tool and return valid MCP response for existing endpoint', async () => {
      const parameters = { id: TEST_ENDPOINT_IDS.WINDOWS_VALID };
      const result = await executeMCPTool("get_local_admin_accounts", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toBeDefined();
    });

    it('should return 404 error for non-existent endpoint', async () => {
      const parameters = { id: TEST_ENDPOINT_IDS.INVALID };

      await expect(
        executeMCPTool("get_local_admin_accounts", parameters)
      ).rejects.toThrow();
    });

    it('should reject request without required id parameter', async () => {
      const parameters = {};

      await expect(
        executeMCPTool("get_local_admin_accounts", parameters)
      ).rejects.toThrow(/id is required/);
    });
  });

  describe('list_defender_threats', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = { PageSize: 10, Page: 0 };
      const result = await executeMCPTool("list_defender_threats", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
      expect(data.data.length).toBeLessThanOrEqual(10);
    });

    it('should return paginated results with correct page size', async () => {
      const parameters = { PageSize: 5, Page: 0 };
      const result = await executeMCPTool("list_defender_threats", parameters);

      const data = expectJSONResponse(result);
      expect(data.data.length).toBeLessThanOrEqual(5);
      expect(data.totalItems).toBeGreaterThan(0);
    });
  });

  describe('get_defender_threat', () => {
    it('should execute tool and return valid MCP response for existing threat', async () => {
      const parameters = { id: TEST_THREAT_IDS.VALID };
      const result = await executeMCPTool("get_defender_threat", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toBeDefined();
    });

    it('should return 404 error for non-existent threat', async () => {
      const parameters = { id: TEST_THREAT_IDS.INVALID };

      await expect(
        executeMCPTool("get_defender_threat", parameters)
      ).rejects.toThrow();
    });

    it('should reject request without required id parameter', async () => {
      const parameters = {};

      await expect(
        executeMCPTool("get_defender_threat", parameters)
      ).rejects.toThrow(/id is required/);
    });
  });

  describe('list_defender_threats_by_endpoint', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = { endpointId: TEST_ENDPOINT_IDS.WINDOWS_VALID };
      const result = await executeMCPTool("list_defender_threats_by_endpoint", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
    });

    it('should reject request without required endpointId parameter', async () => {
      const parameters = {};

      await expect(
        executeMCPTool("list_defender_threats_by_endpoint", parameters)
      ).rejects.toThrow(/endpointId is required/);
    });
  });

  describe('list_defender_threats_by_logical_group', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = { logicalGroupId: TEST_LOGICAL_GROUP_IDS.VALID };
      const result = await executeMCPTool("list_defender_threats_by_logical_group", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
    });

    it('should reject request without required logicalGroupId parameter', async () => {
      const parameters = {};

      await expect(
        executeMCPTool("list_defender_threats_by_logical_group", parameters)
      ).rejects.toThrow(/logicalGroupId is required/);
    });
  });

  describe('list_defender_windows_endpoints', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = { PageSize: 10, Page: 0 };
      const result = await executeMCPTool("list_defender_windows_endpoints", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
      expect(data.data.length).toBeLessThanOrEqual(10);
    });

    it('should return paginated results with correct page size', async () => {
      const parameters = { PageSize: 5, Page: 0 };
      const result = await executeMCPTool("list_defender_windows_endpoints", parameters);

      const data = expectJSONResponse(result);
      expect(data.data.length).toBeLessThanOrEqual(5);
      expect(data.totalItems).toBeGreaterThan(0);
    });
  });

  describe('get_defender_windows_endpoint', () => {
    it('should execute tool and return valid MCP response for existing endpoint', async () => {
      const parameters = { id: TEST_ENDPOINT_IDS.WINDOWS_VALID };
      const result = await executeMCPTool("get_defender_windows_endpoint", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toBeDefined();
    });

    it('should return 404 error for non-existent endpoint', async () => {
      const parameters = { id: TEST_ENDPOINT_IDS.INVALID };

      await expect(
        executeMCPTool("get_defender_windows_endpoint", parameters)
      ).rejects.toThrow();
    });

    it('should reject request without required id parameter', async () => {
      const parameters = {};

      await expect(
        executeMCPTool("get_defender_windows_endpoint", parameters)
      ).rejects.toThrow(/id is required/);
    });
  });
});
