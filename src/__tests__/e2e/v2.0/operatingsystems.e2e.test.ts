import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { BConnectClient } from '../../../bconnect-client.js';
import {
  TEST_OS_FOLDER_IDS,
  TEST_ENDPOINT_IDS,
  MOCK_OS_FOLDER,
  MOCK_OS_WINDOWS_ENDPOINT,
  generateMockOSFolders,
  generateMockOSWindowsEndpoints
} from '../helpers/test-data-fixtures.js';
import {
  expectValidMCPResponse,
  expectJSONResponse
} from '../helpers/assertions.js';

// Test configuration
const BASE_URL = 'https://bms-win22srv:444/bconnect';

// Pre-generate stable mock data outside of handlers
const allMockOSFolders = generateMockOSFolders(20);
const allMockOSWindowsEndpoints = generateMockOSWindowsEndpoints(30);

// MSW HTTP Handlers
const handlers = [
  // GET /operatingsystems/v2.0/Folders - List all OS folders
  http.get(`${BASE_URL}/operatingsystems/v2.0/Folders`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');
    const searchQuery = url.searchParams.get('SearchQuery') || '';

    let filteredFolders = [...allMockOSFolders];

    // Apply search filter
    if (searchQuery) {
      filteredFolders = filteredFolders.filter(folder =>
        folder.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (folder.description && folder.description.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }

    // Apply pagination
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedData = filteredFolders.slice(startIndex, endIndex);

    return HttpResponse.json({
      totalItems: filteredFolders.length,
      data: paginatedData
    });
  }),

  // GET /operatingsystems/v2.0/Folders/{id} - Get specific OS folder
  http.get(`${BASE_URL}/operatingsystems/v2.0/Folders/:id`, ({ params }) => {
    const { id } = params;

    if (id === TEST_OS_FOLDER_IDS.VALID) {
      return HttpResponse.json(MOCK_OS_FOLDER);
    }

    return HttpResponse.json(
      { error: 'OS folder not found' },
      { status: 404 }
    );
  }),

  // GET /operatingsystems/v2.0/Folders/{folderId}/Folders - List subfolders
  http.get(`${BASE_URL}/operatingsystems/v2.0/Folders/:folderId/Folders`, ({ params, request }) => {
    const { folderId } = params;
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');

    // Filter folders by parent
    const subfolders = allMockOSFolders.filter(f =>
      f.parentFolderId === folderId
    );

    // Apply pagination
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedData = subfolders.slice(startIndex, endIndex);

    return HttpResponse.json({
      totalItems: subfolders.length,
      data: paginatedData
    });
  }),

  // GET /operatingsystems/v2.0/WindowsEndpoints - List Windows endpoints with OS info
  http.get(`${BASE_URL}/operatingsystems/v2.0/WindowsEndpoints`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');
    const searchQuery = url.searchParams.get('SearchQuery') || '';

    let filteredEndpoints = [...allMockOSWindowsEndpoints];

    // Apply search filter
    if (searchQuery) {
      filteredEndpoints = filteredEndpoints.filter(endpoint =>
        endpoint.endpointName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        endpoint.operatingSystem.toLowerCase().includes(searchQuery.toLowerCase())
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

  // GET /operatingsystems/v2.0/WindowsEndpoints/{id} - Get specific Windows endpoint OS info
  http.get(`${BASE_URL}/operatingsystems/v2.0/WindowsEndpoints/:id`, ({ params }) => {
    const { id } = params;

    if (id === TEST_ENDPOINT_IDS.WINDOWS_VALID) {
      return HttpResponse.json(MOCK_OS_WINDOWS_ENDPOINT);
    }

    return HttpResponse.json(
      { error: 'Windows endpoint not found' },
      { status: 404 }
    );
  })
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
// OPERATING SYSTEMS MCP TOOLS - E2E TESTS
// ============================================================================

describe('Operating Systems MCP Tools - E2E Tests', () => {
  // Create bConnect client inside describe block (after MSW setup)
  const bconnect = new BConnectClient({
    baseUrl: BASE_URL,
    username: 'Administrator',
    password: 'baramundi-2008',
    rejectUnauthorized: false,
      disableHttpsAgent: true  // Disable HTTPS agent to allow MSW interception
  });

  /**
   * Execute an MCP tool by name with given arguments
   * This simulates the MCP tool execution flow
   */
  async function executeMCPTool(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case "list_os_folders":
        const osFolders = await bconnect.operatingsystems.getFolders(args || {});
        return {
          content: [{
            type: "text",
            text: JSON.stringify(osFolders, null, 2)
          }]
        };

      case "get_os_folder":
        if (!args?.id) {
          throw new Error("id is required");
        }
        const osFolder = await bconnect.operatingsystems.getFolder(args.id);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(osFolder, null, 2)
          }]
        };

      case "list_os_folders_by_parent":
        if (!args?.folderId) {
          throw new Error("folderId is required");
        }
        const subfolders = await bconnect.operatingsystems.getFoldersByFolderId(
          args.folderId,
          args || {}
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify(subfolders, null, 2)
          }]
        };

      case "list_os_windows_endpoints":
        const osWindowsEndpoints = await bconnect.operatingsystems.getWindowsEndpoints(args || {});
        return {
          content: [{
            type: "text",
            text: JSON.stringify(osWindowsEndpoints, null, 2)
          }]
        };

      case "get_os_windows_endpoint":
        if (!args?.id) {
          throw new Error("id is required");
        }
        const osWindowsEndpoint = await bconnect.operatingsystems.getWindowsEndpoint(args.id);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(osWindowsEndpoint, null, 2)
          }]
        };

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  // ==========================================================================
  // list_os_folders
  // ==========================================================================

  describe('list_os_folders', () => {
    it('should execute tool and return valid MCP response', async () => {
      // Arrange
      const parameters = { PageSize: 10, Page: 0 };

      // Act
      const result = await executeMCPTool("list_os_folders", parameters);

      // Assert
      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
      expect(data.data.length).toBeLessThanOrEqual(10);
    });

    it('should return paginated results with correct page size', async () => {
      // Arrange
      const parameters = { PageSize: 5, Page: 0 };

      // Act
      const result = await executeMCPTool("list_os_folders", parameters);

      // Assert
      const data = expectJSONResponse(result);
      expect(data.data.length).toBeLessThanOrEqual(5);
      expect(data.totalItems).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // get_os_folder
  // ==========================================================================

  describe('get_os_folder', () => {
    it('should execute tool and return valid MCP response for existing folder', async () => {
      // Arrange
      const parameters = { id: TEST_OS_FOLDER_IDS.VALID };

      // Act
      const result = await executeMCPTool("get_os_folder", parameters);

      // Assert
      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('name');
      expect(data.id).toBe(TEST_OS_FOLDER_IDS.VALID);
    });

    it('should return 404 error for non-existent folder', async () => {
      // Arrange
      const parameters = { id: TEST_OS_FOLDER_IDS.INVALID };

      // Act & Assert
      await expect(
        executeMCPTool("get_os_folder", parameters)
      ).rejects.toThrow();
    });

    it('should reject request without required id parameter', async () => {
      // Arrange
      const parameters = {};

      // Act & Assert
      await expect(
        executeMCPTool("get_os_folder", parameters)
      ).rejects.toThrow("id is required");
    });
  });

  // ==========================================================================
  // list_os_folders_by_parent
  // ==========================================================================

  describe('list_os_folders_by_parent', () => {
    it('should execute tool and return valid MCP response', async () => {
      // Arrange
      const parameters = {
        folderId: TEST_OS_FOLDER_IDS.PARENT,
        PageSize: 10,
        Page: 0
      };

      // Act
      const result = await executeMCPTool("list_os_folders_by_parent", parameters);

      // Assert
      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
    });

    it('should reject request without required folderId parameter', async () => {
      // Arrange
      const parameters = { PageSize: 10 };

      // Act & Assert
      await expect(
        executeMCPTool("list_os_folders_by_parent", parameters)
      ).rejects.toThrow("folderId is required");
    });
  });

  // ==========================================================================
  // list_os_windows_endpoints
  // ==========================================================================

  describe('list_os_windows_endpoints', () => {
    it('should execute tool and return valid MCP response', async () => {
      // Arrange
      const parameters = { PageSize: 10, Page: 0 };

      // Act
      const result = await executeMCPTool("list_os_windows_endpoints", parameters);

      // Assert
      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
      expect(data.data.length).toBeLessThanOrEqual(10);
    });

    it('should return paginated results with correct page size', async () => {
      // Arrange
      const parameters = { PageSize: 5, Page: 0 };

      // Act
      const result = await executeMCPTool("list_os_windows_endpoints", parameters);

      // Assert
      const data = expectJSONResponse(result);
      expect(data.data.length).toBeLessThanOrEqual(5);
      expect(data.totalItems).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // get_os_windows_endpoint
  // ==========================================================================

  describe('get_os_windows_endpoint', () => {
    it('should execute tool and return valid MCP response for existing endpoint', async () => {
      // Arrange
      const parameters = { id: TEST_ENDPOINT_IDS.WINDOWS_VALID };

      // Act
      const result = await executeMCPTool("get_os_windows_endpoint", parameters);

      // Assert
      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      // Check for basic OS endpoint properties (actual API response structure)
      expect(data).toHaveProperty('endpointId');
      expect(data.endpointId).toBe(TEST_ENDPOINT_IDS.WINDOWS_VALID);
    });

    it('should return 404 error for non-existent endpoint', async () => {
      // Arrange
      const parameters = { id: TEST_ENDPOINT_IDS.INVALID };

      // Act & Assert
      await expect(
        executeMCPTool("get_os_windows_endpoint", parameters)
      ).rejects.toThrow();
    });

    it('should reject request without required id parameter', async () => {
      // Arrange
      const parameters = {};

      // Act & Assert
      await expect(
        executeMCPTool("get_os_windows_endpoint", parameters)
      ).rejects.toThrow("id is required");
    });
  });
});
