/**
 * Assets MCP Tools - E2E Tests
 *
 * End-to-end tests for Assets API MCP tools.
 * Tests complete tool execution flow: Tool Handler → API → MCP Response
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { BConnectClient } from '../../../bconnect-client.js';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  expectValidMCPResponse,
  expectJSONResponse
} from '../helpers/assertions.js';
import {
  TEST_ASSET_IDS,
  TEST_ASSET_TYPE_IDS,
  TEST_ASSET_STOCK_FOLDER_IDS,
  TEST_LOGICAL_GROUP_IDS,
  TEST_ENDPOINT_IDS,
  MOCK_ASSET,
  MOCK_ASSET_TYPE,
  MOCK_ASSET_STOCK_FOLDER,
  generateMockAssets,
  generateMockAssetTypes,
  generateMockAssetStockFolders
} from '../helpers/test-data-fixtures.js';

// MSW server for mocking HTTP requests
const BASE_URL = 'https://bms-win22srv:444/bconnect';

// Generate stable mock data outside the handler to ensure consistency
const allMockAssets = generateMockAssets(100);
const allMockAssetTypes = generateMockAssetTypes(20);
const allMockAssetStockFolders = generateMockAssetStockFolders(10);

const handlers = [
  // Mock: GET /assets/v2.0/Assets (list)
  http.get(`${BASE_URL}/assets/v2.0/Assets`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');
    const searchQuery = url.searchParams.get('SearchQuery');

    let filteredAssets = [...allMockAssets];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filteredAssets = allMockAssets.filter(a =>
        a.manufacturer?.toLowerCase().includes(query) ||
        a.model?.toLowerCase().includes(query) ||
        a.serialNumber?.toLowerCase().includes(query)
      );
    }

    // Apply pagination
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedData = filteredAssets.slice(startIndex, endIndex);

    return HttpResponse.json({
      totalItems: filteredAssets.length,
      data: paginatedData
    });
  }),

  // Mock: GET /assets/v2.0/Assets/{id} (get specific)
  http.get(`${BASE_URL}/assets/v2.0/Assets/:id`, ({ params }) => {
    const { id } = params;

    // Return 404 for invalid asset ID
    if (id === TEST_ASSET_IDS.INVALID) {
      return HttpResponse.json(
        { Message: 'Asset not found' },
        { status: 404 }
      );
    }

    // Return mock asset data
    return HttpResponse.json({
      ...MOCK_ASSET,
      assetId: id as string
    });
  }),

  // Mock: GET /assets/v2.0/AssetTypes (list)
  http.get(`${BASE_URL}/assets/v2.0/AssetTypes`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');
    const searchQuery = url.searchParams.get('SearchQuery');

    let filteredTypes = [...allMockAssetTypes];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filteredTypes = allMockAssetTypes.filter(t =>
        t.name.toLowerCase().includes(query) ||
        t.description?.toLowerCase().includes(query)
      );
    }

    // Apply pagination
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedData = filteredTypes.slice(startIndex, endIndex);

    return HttpResponse.json({
      totalItems: filteredTypes.length,
      data: paginatedData
    });
  }),

  // Mock: GET /assets/v2.0/AssetTypes/{id} (get specific)
  http.get(`${BASE_URL}/assets/v2.0/AssetTypes/:id`, ({ params }) => {
    const { id } = params;

    // Return 404 for invalid asset type ID
    if (id === TEST_ASSET_TYPE_IDS.INVALID) {
      return HttpResponse.json(
        { Message: 'Asset type not found' },
        { status: 404 }
      );
    }

    // Return mock asset type data
    return HttpResponse.json({
      ...MOCK_ASSET_TYPE,
      id: id as string
    });
  }),

  // Mock: GET /assets/v2.0/LogicalGroups/{logicalGroupId}/Assets (list by logical group)
  http.get(`${BASE_URL}/assets/v2.0/LogicalGroups/:logicalGroupId/Assets`, ({ params, request }) => {
    const { logicalGroupId } = params;
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');

    // Filter assets for this logical group (mock: return first 10 assets)
    const groupAssets = allMockAssets.slice(0, 10);

    // Apply pagination
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedData = groupAssets.slice(startIndex, endIndex);

    return HttpResponse.json({
      totalItems: groupAssets.length,
      data: paginatedData
    });
  }),

  // Mock: GET /assets/v2.0/WindowsEndpoint/{endpointId}/Assets (list by endpoint)
  http.get(`${BASE_URL}/assets/v2.0/WindowsEndpoint/:endpointId/Assets`, ({ params, request }) => {
    const { endpointId } = params;
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');

    // Filter assets for this endpoint (mock: return first 5 assets)
    const endpointAssets = allMockAssets.filter(
      a => a.ownerId === endpointId
    );

    // Apply pagination
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedData = endpointAssets.slice(startIndex, endIndex);

    return HttpResponse.json({
      totalItems: endpointAssets.length,
      data: paginatedData
    });
  }),

  // Mock: GET /assets/v2.0/AssetStock/Assets (list stock assets)
  http.get(`${BASE_URL}/assets/v2.0/AssetStock/Assets`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');

    // Return assets in stock (mock: return last 20 assets)
    const stockAssets = allMockAssets.slice(-20);

    // Apply pagination
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedData = stockAssets.slice(startIndex, endIndex);

    return HttpResponse.json({
      totalItems: stockAssets.length,
      data: paginatedData
    });
  }),

  // Mock: GET /assets/v2.0/AssetStock/Folders (list stock folders)
  http.get(`${BASE_URL}/assets/v2.0/AssetStock/Folders`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');

    // Apply pagination
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedData = allMockAssetStockFolders.slice(startIndex, endIndex);

    return HttpResponse.json({
      totalItems: allMockAssetStockFolders.length,
      data: paginatedData
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
    // Assets
    case "list_assets":
      const assets = await bconnect.assets.getAssets(args || {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(assets, null, 2)
          }
        ]
      };

    case "get_asset":
      if (!args?.id) {
        throw new Error("id is required");
      }
      const asset = await bconnect.assets.getAsset(args.id as string);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(asset, null, 2)
          }
        ]
      };

    // Asset Types
    case "list_asset_types":
      const assetTypes = await bconnect.assets.getAssetTypes(args || {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(assetTypes, null, 2)
          }
        ]
      };

    case "get_asset_type":
      if (!args?.id) {
        throw new Error("id is required");
      }
      const assetType = await bconnect.assets.getAssetType(args.id as string);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(assetType, null, 2)
          }
        ]
      };

    // Assets by Logical Group
    case "list_assets_by_logical_group":
      if (!args?.logicalGroupId) {
        throw new Error("logicalGroupId is required");
      }
      const groupAssets = await bconnect.assets.getAssetsByLogicalGroup(
        args.logicalGroupId as string,
        args
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(groupAssets, null, 2)
          }
        ]
      };

    // Assets by Endpoint
    case "list_assets_by_endpoint":
      if (!args?.endpointId) {
        throw new Error("endpointId is required");
      }
      const endpointAssets = await bconnect.assets.getAssetsByEndpoint(
        args.endpointId as string,
        args
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(endpointAssets, null, 2)
          }
        ]
      };

    // Asset Stock
    case "list_asset_stock_assets":
      const stockAssets = await bconnect.assets.getAssetStockAssets(args || {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(stockAssets, null, 2)
          }
        ]
      };

    case "list_asset_stock_folders":
      const stockFolders = await bconnect.assets.getAssetStockFolders(args || {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(stockFolders, null, 2)
          }
        ]
      };

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

describe('Assets MCP Tools - E2E Tests', () => {
  // Setup MSW server before all tests
  beforeAll(() => {
    mswServer.listen({ onUnhandledRequest: 'error' });
  });

  afterAll(() => {
    mswServer.close();
  });

  beforeEach(() => {
    // Reset MSW handlers between tests
    mswServer.resetHandlers();

    // Create BConnectClient instance
    bconnect = new BConnectClient({
      baseUrl: BASE_URL,
      username: 'Administrator',
      password: 'baramundi-2008',
      rejectUnauthorized: false,
      disableHttpsAgent: true  // Disable HTTPS agent to allow MSW interception
    });
  });

  describe('list_assets', () => {
    it('should execute tool and return valid MCP response', async () => {
      // Arrange
      const parameters = {
        PageSize: 10,
        Page: 0
      };

      // Act
      const result = await executeMCPTool("list_assets", parameters);

      // Assert - MCP Response Structure
      expectValidMCPResponse(result);

      // Assert - Response Data
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
      expect(data.data).toBeInstanceOf(Array);
      expect(data.data.length).toBeLessThanOrEqual(10);
    });

    it('should return paginated results with correct page size', async () => {
      // Act
      const result = await executeMCPTool("list_assets", { PageSize: 5, Page: 0 });

      // Assert
      const data = expectJSONResponse(result);
      expect(data.data.length).toBeLessThanOrEqual(5);
    });
  });

  describe('get_asset', () => {
    it('should execute tool and return valid MCP response for existing asset', async () => {
      // Arrange
      const parameters = {
        id: TEST_ASSET_IDS.VALID
      };

      // Act
      const result = await executeMCPTool("get_asset", parameters);

      // Assert - MCP Response Structure
      expectValidMCPResponse(result);

      // Assert - Response Data (validates JSON is returned)
      const data = expectJSONResponse(result);
      expect(data).toBeDefined();
    });

    it('should return 404 error for non-existent asset', async () => {
      // Arrange
      const parameters = {
        id: TEST_ASSET_IDS.INVALID
      };

      // Act & Assert
      await expect(executeMCPTool("get_asset", parameters))
        .rejects.toThrow();
    });

    it('should reject request without required id parameter', async () => {
      // Act & Assert
      await expect(executeMCPTool("get_asset", {}))
        .rejects.toThrow(/id is required/);
    });
  });

  describe('list_asset_types', () => {
    it('should execute tool and return valid MCP response', async () => {
      // Arrange
      const parameters = {
        PageSize: 10,
        Page: 0
      };

      // Act
      const result = await executeMCPTool("list_asset_types", parameters);

      // Assert - MCP Response Structure
      expectValidMCPResponse(result);

      // Assert - Response Data
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
      expect(data.data).toBeInstanceOf(Array);
      expect(data.data.length).toBeLessThanOrEqual(10);
    });

    it('should return paginated results with correct page size', async () => {
      // Act
      const result = await executeMCPTool("list_asset_types", { PageSize: 5, Page: 0 });

      // Assert
      const data = expectJSONResponse(result);
      expect(data.data.length).toBeLessThanOrEqual(5);
    });
  });

  describe('get_asset_type', () => {
    it('should execute tool and return valid MCP response for existing asset type', async () => {
      // Arrange
      const parameters = {
        id: TEST_ASSET_TYPE_IDS.VALID
      };

      // Act
      const result = await executeMCPTool("get_asset_type", parameters);

      // Assert - MCP Response Structure
      expectValidMCPResponse(result);

      // Assert - Response Data
      const data = expectJSONResponse(result);
      expect(data.id).toBe(TEST_ASSET_TYPE_IDS.VALID);
      expect(data).toHaveProperty('name');
    });

    it('should return 404 error for non-existent asset type', async () => {
      // Arrange
      const parameters = {
        id: TEST_ASSET_TYPE_IDS.INVALID
      };

      // Act & Assert
      await expect(executeMCPTool("get_asset_type", parameters))
        .rejects.toThrow();
    });

    it('should reject request without required id parameter', async () => {
      // Act & Assert
      await expect(executeMCPTool("get_asset_type", {}))
        .rejects.toThrow(/id is required/);
    });
  });

  describe('list_assets_by_logical_group', () => {
    it('should execute tool and return valid MCP response', async () => {
      // Arrange
      const parameters = {
        logicalGroupId: TEST_LOGICAL_GROUP_IDS.VALID,
        PageSize: 10,
        Page: 0
      };

      // Act
      const result = await executeMCPTool("list_assets_by_logical_group", parameters);

      // Assert - MCP Response Structure
      expectValidMCPResponse(result);

      // Assert - Response Data
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
      expect(data.data).toBeInstanceOf(Array);
    });

    it('should reject request without required logicalGroupId parameter', async () => {
      // Act & Assert
      await expect(executeMCPTool("list_assets_by_logical_group", {}))
        .rejects.toThrow(/logicalGroupId is required/);
    });
  });

  describe('list_assets_by_endpoint', () => {
    it('should execute tool and return valid MCP response', async () => {
      // Arrange
      const parameters = {
        endpointId: TEST_ENDPOINT_IDS.WINDOWS_VALID,
        PageSize: 10,
        Page: 0
      };

      // Act
      const result = await executeMCPTool("list_assets_by_endpoint", parameters);

      // Assert - MCP Response Structure
      expectValidMCPResponse(result);

      // Assert - Response Data
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
      expect(data.data).toBeInstanceOf(Array);
    });

    it('should reject request without required endpointId parameter', async () => {
      // Act & Assert
      await expect(executeMCPTool("list_assets_by_endpoint", {}))
        .rejects.toThrow(/endpointId is required/);
    });
  });

  describe('list_asset_stock_assets', () => {
    it('should execute tool and return valid MCP response', async () => {
      // Arrange
      const parameters = {
        PageSize: 10,
        Page: 0
      };

      // Act
      const result = await executeMCPTool("list_asset_stock_assets", parameters);

      // Assert - MCP Response Structure
      expectValidMCPResponse(result);

      // Assert - Response Data
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
      expect(data.data).toBeInstanceOf(Array);
      expect(data.data.length).toBeLessThanOrEqual(10);
    });

    it('should return paginated results with correct page size', async () => {
      // Act
      const result = await executeMCPTool("list_asset_stock_assets", { PageSize: 5, Page: 0 });

      // Assert
      const data = expectJSONResponse(result);
      expect(data.data.length).toBeLessThanOrEqual(5);
    });
  });

  describe('list_asset_stock_folders', () => {
    it('should execute tool and return valid MCP response', async () => {
      // Arrange
      const parameters = {
        PageSize: 10,
        Page: 0
      };

      // Act
      const result = await executeMCPTool("list_asset_stock_folders", parameters);

      // Assert - MCP Response Structure
      expectValidMCPResponse(result);

      // Assert - Response Data
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
      expect(data.data).toBeInstanceOf(Array);
      expect(data.data.length).toBeLessThanOrEqual(10);
    });

    it('should return paginated results with correct page size', async () => {
      // Act
      const result = await executeMCPTool("list_asset_stock_folders", { PageSize: 5, Page: 0 });

      // Assert
      const data = expectJSONResponse(result);
      expect(data.data.length).toBeLessThanOrEqual(5);
    });
  });
});
