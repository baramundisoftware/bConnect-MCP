/**
 * Endpoints MCP Tools - E2E Tests
 *
 * End-to-end tests for all Endpoints API MCP tools.
 * Tests complete tool execution flow: Tool Handler → API → MCP Response
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { BConnectClient } from '../../../bconnect-client.js';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  expectValidMCPResponse,
  expectJSONResponse,
  expectPaginatedResponse,
  expectPageSize,
  expectNonEmptyResults,
  expectDataItemWithId,
  expectErrorResponse
} from '../helpers/assertions.js';
import {
  TEST_ENDPOINT_IDS,
  TEST_PAGINATION,
  TEST_ORDER_BY,
  MOCK_WINDOWS_ENDPOINT,
  generateMockEndpoints
} from '../helpers/test-data-fixtures.js';

// MSW server for mocking HTTP requests
const BASE_URL = 'https://bms-win22srv:444/bconnect';

// Generate stable mock data outside the handler to ensure consistency across requests
const allMockEndpoints = generateMockEndpoints(50);

const handlers = [
  // Mock: GET /endpoints/v2.0/WindowsEndpoints (list)
  http.get(`${BASE_URL}/endpoints/v2.0/WindowsEndpoints`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');
    const searchQuery = url.searchParams.get('SearchQuery');

    // Use stable mock data
    let filteredEndpoints = [...allMockEndpoints];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filteredEndpoints = allMockEndpoints.filter(e =>
        e.displayName.toLowerCase().includes(query) ||
        e.hostName.toLowerCase().includes(query) ||
        e.primaryIP.toLowerCase().includes(query)
      );
    }

    // Apply pagination
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedData = filteredEndpoints.slice(startIndex, endIndex);

    // bConnect API response format: { totalItems, data }
    // Note: pageSize and page are NOT returned in response (they're request parameters only)
    return HttpResponse.json({
      totalItems: filteredEndpoints.length,
      data: paginatedData
    });
  }),

  // Mock: GET /endpoints/v2.0/WindowsEndpoints/{id} (get specific)
  http.get(`${BASE_URL}/endpoints/v2.0/WindowsEndpoints/:id`, ({ params }) => {
    const { id } = params;

    // Return 404 for invalid endpoint ID
    if (id === TEST_ENDPOINT_IDS.WINDOWS_INVALID) {
      return HttpResponse.json(
        { Message: 'Endpoint not found' },
        { status: 404 }
      );
    }

    // Return mock endpoint data
    return HttpResponse.json({
      ...MOCK_WINDOWS_ENDPOINT,
      id: id as string
    });
  })
];

const mswServer = setupServer(...handlers);

// BConnectClient instance
let bconnect: BConnectClient;

/**
 * Simulate MCP tool execution
 * This mimics the CallToolRequestSchema handler from index.ts
 */
async function executeMCPTool(toolName: string, args: any): Promise<any> {
  switch (toolName) {
    case "list_windows_endpoints":
      const windowsEndpoints = await bconnect.endpoints.getWindowsEndpoints(args || {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(windowsEndpoints, null, 2)
          }
        ]
      };

    case "get_windows_endpoint":
      if (!args?.id) {
        throw new Error("id is required");
      }
      const windowsEndpoint = await bconnect.endpoints.getWindowsEndpoint(args.id as string);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(windowsEndpoint, null, 2)
          }
        ]
      };

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

describe('Endpoints MCP Tools - E2E Tests', () => {
  // Setup MSW server before all tests
  beforeAll(() => {
    mswServer.listen({ onUnhandledRequest: 'warn' });
    // Create BConnectClient instance once
    bconnect = new BConnectClient({
      baseUrl: BASE_URL,
      username: 'Administrator',
      password: 'baramundi-2008',
      rejectUnauthorized: false,
      disableHttpsAgent: true  // Disable HTTPS agent to allow MSW interception
    });
  });

  afterEach(() => {
    // Reset MSW handlers after each test (not before!)
    mswServer.resetHandlers();
  });

  afterAll(() => {
    mswServer.close();
  });

  describe('list_windows_endpoints', () => {
    it('should execute tool and return valid MCP response', async () => {
      // Arrange
      const parameters = {
        PageSize: 10,
        Page: 0
      };

      // Act
      const result = await executeMCPTool("list_windows_endpoints", parameters);

      // Assert - MCP Response Structure
      expectValidMCPResponse(result);

      // Assert - Response Data (bConnect API format: { totalItems, data })
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
      expect(data.data).toBeInstanceOf(Array);
      expect(data.data.length).toBeLessThanOrEqual(10);
    });

    it('should return paginated results with correct page size', async () => {
      // Act
      const result = await executeMCPTool("list_windows_endpoints", { PageSize: 5, Page: 0 });

      // Assert
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
      expect(data.data.length).toBeLessThanOrEqual(5);
    });

    it('should handle pagination correctly for different pages', async () => {
      // Act - Page 0
      const page0 = await executeMCPTool("list_windows_endpoints", { PageSize: 5, Page: 0 });

      // Act - Page 1
      const page1 = await executeMCPTool("list_windows_endpoints", { PageSize: 5, Page: 1 });

      // Assert
      const data0 = expectJSONResponse(page0);
      const data1 = expectJSONResponse(page1);

      expect(data0.data.length).toBeLessThanOrEqual(5);
      expect(data1.data.length).toBeLessThanOrEqual(5);

      // First items should be different (different pages)
      if (data0.data.length > 0 && data1.data.length > 0) {
        expect(data0.data[0].id).not.toBe(data1.data[0].id);
      }
    });

    it('should handle search query parameter', async () => {
      // Act
      const result = await executeMCPTool("list_windows_endpoints", {
        SearchQuery: "endpoint-1",
        PageSize: 20,
        Page: 0
      });

      // Assert
      const data = expectJSONResponse(result);
      expect(data.totalItems).toBeGreaterThan(0);
      expect(data.data.length).toBeGreaterThan(0);

      // Verify search results contain the query
      const hasMatch = data.data.some((item: any) =>
        item.displayName.includes("endpoint-1") ||
        item.hostName.includes("endpoint-1")
      );
      expect(hasMatch).toBe(true);
    });

    it('should return empty results for non-existent search query', async () => {
      // Act
      const result = await executeMCPTool("list_windows_endpoints", {
        SearchQuery: "this-device-does-not-exist-xyz",
        PageSize: 20,
        Page: 0
      });

      // Assert
      const data = expectJSONResponse(result);
      expect(data.totalItems).toBe(0);
      expect(data.data.length).toBe(0);
    });
  });

  describe('get_windows_endpoint', () => {
    it('should execute tool and return valid MCP response for existing endpoint', async () => {
      // Arrange
      const parameters = {
        id: TEST_ENDPOINT_IDS.WINDOWS_VALID
      };

      // Act
      const result = await executeMCPTool("get_windows_endpoint", parameters);

      // Assert - MCP Response Structure
      expectValidMCPResponse(result);

      // Assert - Response Data
      const data = expectJSONResponse(result);
      expect(data.id).toBe(TEST_ENDPOINT_IDS.WINDOWS_VALID);
      expect(data).toHaveProperty('displayName');
      expect(data).toHaveProperty('hostName');
      expect(data).toHaveProperty('primaryIP');
    });

    it('should return 404 error for non-existent endpoint', async () => {
      // Arrange
      const parameters = {
        id: TEST_ENDPOINT_IDS.WINDOWS_INVALID
      };

      // Act & Assert
      await expect(executeMCPTool("get_windows_endpoint", parameters))
        .rejects.toThrow();
    });

    it('should reject request without required id parameter', async () => {
      // Act & Assert
      await expect(executeMCPTool("get_windows_endpoint", {}))
        .rejects.toThrow(/id is required/);
    });
  });
});
