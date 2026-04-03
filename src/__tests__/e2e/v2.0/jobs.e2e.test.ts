/**
 * Jobs MCP Tools - E2E Tests
 *
 * End-to-end tests for Jobs API MCP tools.
 * Tests complete tool execution flow: Tool Handler → API → MCP Response
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { BConnectClient } from '../../../bconnect-client.js';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  expectValidMCPResponse,
  expectJSONResponse,
  expectNonEmptyResults,
  expectDataItemWithId
} from '../helpers/assertions.js';
import {
  TEST_JOB_DEFINITION_IDS,
  TEST_JOB_INSTANCE_IDS,
  TEST_KIOSK_RELEASE_IDS,
  TEST_ENDPOINT_IDS,
  TEST_PAGINATION,
  MOCK_JOB_DEFINITION,
  MOCK_JOB_INSTANCE,
  MOCK_KIOSK_RELEASE,
  generateMockJobDefinitions,
  generateMockJobInstances,
  generateMockKioskReleases
} from '../helpers/test-data-fixtures.js';

// MSW server for mocking HTTP requests
const BASE_URL = 'https://bms-win22srv:444/bconnect';

// Generate stable mock data outside the handler to ensure consistency
const allMockJobDefinitions = generateMockJobDefinitions(50);
const allMockJobInstances = generateMockJobInstances(100);
const allMockKioskReleases = generateMockKioskReleases(20);

const handlers = [
  // Mock: GET /jobs/v2.0/JobDefinitions (list)
  http.get(`${BASE_URL}/jobs/v2.0/JobDefinitions`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');
    const searchQuery = url.searchParams.get('SearchQuery');

    let filteredDefinitions = [...allMockJobDefinitions];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filteredDefinitions = allMockJobDefinitions.filter(j =>
        j.name.toLowerCase().includes(query) ||
        j.displayName.toLowerCase().includes(query)
      );
    }

    // Apply pagination
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedData = filteredDefinitions.slice(startIndex, endIndex);

    return HttpResponse.json({
      totalItems: filteredDefinitions.length,
      data: paginatedData
    });
  }),

  // Mock: GET /jobs/v2.0/JobDefinitions/{id} (get specific)
  http.get(`${BASE_URL}/jobs/v2.0/JobDefinitions/:id`, ({ params }) => {
    const { id } = params;

    // Return 404 for invalid job definition ID
    if (id === TEST_JOB_DEFINITION_IDS.INVALID) {
      return HttpResponse.json(
        { Message: 'Job definition not found' },
        { status: 404 }
      );
    }

    // Return mock job definition data
    return HttpResponse.json({
      ...MOCK_JOB_DEFINITION,
      id: id as string
    });
  }),

  // Mock: GET /jobs/v2.0/JobInstances (list)
  http.get(`${BASE_URL}/jobs/v2.0/JobInstances`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');
    const searchQuery = url.searchParams.get('SearchQuery');

    let filteredInstances = [...allMockJobInstances];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filteredInstances = allMockJobInstances.filter(j =>
        j.jobDefinitionName.toLowerCase().includes(query) ||
        j.endpointName.toLowerCase().includes(query)
      );
    }

    // Apply pagination
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedData = filteredInstances.slice(startIndex, endIndex);

    return HttpResponse.json({
      totalItems: filteredInstances.length,
      data: paginatedData
    });
  }),

  // Mock: GET /jobs/v2.0/JobInstances/{id} (get specific)
  http.get(`${BASE_URL}/jobs/v2.0/JobInstances/:id`, ({ params }) => {
    const { id } = params;

    // Return 404 for invalid job instance ID
    if (id === TEST_JOB_INSTANCE_IDS.INVALID) {
      return HttpResponse.json(
        { Message: 'Job instance not found' },
        { status: 404 }
      );
    }

    // Return mock job instance data
    return HttpResponse.json({
      ...MOCK_JOB_INSTANCE,
      id: id as string
    });
  }),

  // Mock: GET /jobs/v2.0/Endpoints/{endpointId}/JobInstances (list by endpoint)
  http.get(`${BASE_URL}/jobs/v2.0/Endpoints/:endpointId/JobInstances`, ({ params, request }) => {
    const { endpointId } = params;
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');

    // Filter job instances for this endpoint
    const endpointInstances = allMockJobInstances.filter(
      j => j.endpointId === endpointId
    );

    // Apply pagination
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedData = endpointInstances.slice(startIndex, endIndex);

    return HttpResponse.json({
      totalItems: endpointInstances.length,
      data: paginatedData
    });
  }),

  // Mock: GET /jobs/v2.0/KioskReleases (list)
  http.get(`${BASE_URL}/jobs/v2.0/KioskReleases`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');
    const searchQuery = url.searchParams.get('SearchQuery');

    let filteredReleases = [...allMockKioskReleases];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filteredReleases = allMockKioskReleases.filter(k =>
        k.jobDefinitionName.toLowerCase().includes(query) ||
        k.targetName.toLowerCase().includes(query)
      );
    }

    // Apply pagination
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedData = filteredReleases.slice(startIndex, endIndex);

    return HttpResponse.json({
      totalItems: filteredReleases.length,
      data: paginatedData
    });
  }),

  // Mock: GET /jobs/v2.0/KioskReleases/{id} (get specific)
  http.get(`${BASE_URL}/jobs/v2.0/KioskReleases/:id`, ({ params }) => {
    const { id } = params;

    // Return 404 for invalid kiosk release ID
    if (id === TEST_KIOSK_RELEASE_IDS.INVALID) {
      return HttpResponse.json(
        { Message: 'Kiosk release not found' },
        { status: 404 }
      );
    }

    // Return mock kiosk release data
    return HttpResponse.json({
      ...MOCK_KIOSK_RELEASE,
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
    // Job Definitions
    case "list_job_definitions":
      const jobDefinitions = await bconnect.jobs.getJobDefinitions(args || {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(jobDefinitions, null, 2)
          }
        ]
      };

    case "get_job_definition":
      if (!args?.id) {
        throw new Error("id is required");
      }
      const jobDefinition = await bconnect.jobs.getJobDefinition(args.id as string);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(jobDefinition, null, 2)
          }
        ]
      };

    // Job Instances
    case "list_job_instances":
      const jobInstances = await bconnect.jobs.getJobInstances(args || {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(jobInstances, null, 2)
          }
        ]
      };

    case "get_job_instance":
      if (!args?.id) {
        throw new Error("id is required");
      }
      const jobInstance = await bconnect.jobs.getJobInstance(args.id as string);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(jobInstance, null, 2)
          }
        ]
      };

    case "list_endpoint_job_instances":
      if (!args?.endpointId) {
        throw new Error("endpointId is required");
      }
      const endpointJobInstances = await bconnect.jobs.getEndpointJobInstances(
        args.endpointId as string,
        args
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(endpointJobInstances, null, 2)
          }
        ]
      };

    // Kiosk Releases
    case "list_kiosk_releases":
      const kioskReleases = await bconnect.jobs.getKioskReleases(args || {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(kioskReleases, null, 2)
          }
        ]
      };

    case "get_kiosk_release":
      if (!args?.id) {
        throw new Error("id is required");
      }
      const kioskRelease = await bconnect.jobs.getKioskRelease(args.id as string);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(kioskRelease, null, 2)
          }
        ]
      };

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

describe('Jobs MCP Tools - E2E Tests', () => {
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

  describe('list_job_definitions', () => {
    it('should execute tool and return valid MCP response', async () => {
      // Arrange
      const parameters = {
        PageSize: 10,
        Page: 0
      };

      // Act
      const result = await executeMCPTool("list_job_definitions", parameters);

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
      const result = await executeMCPTool("list_job_definitions", { PageSize: 5, Page: 0 });

      // Assert
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
      expect(data.data.length).toBeLessThanOrEqual(5);
    });
  });

  describe('get_job_definition', () => {
    it('should execute tool and return valid MCP response for existing job definition', async () => {
      // Arrange
      const parameters = {
        id: TEST_JOB_DEFINITION_IDS.WINDOWS_VALID
      };

      // Act
      const result = await executeMCPTool("get_job_definition", parameters);

      // Assert - MCP Response Structure
      expectValidMCPResponse(result);

      // Assert - Response Data
      const data = expectJSONResponse(result);
      expect(data.id).toBe(TEST_JOB_DEFINITION_IDS.WINDOWS_VALID);
      expect(data).toHaveProperty('name');
    });

    it('should return 404 error for non-existent job definition', async () => {
      // Arrange
      const parameters = {
        id: TEST_JOB_DEFINITION_IDS.INVALID
      };

      // Act & Assert
      await expect(executeMCPTool("get_job_definition", parameters))
        .rejects.toThrow();
    });

    it('should reject request without required id parameter', async () => {
      // Act & Assert
      await expect(executeMCPTool("get_job_definition", {}))
        .rejects.toThrow(/id is required/);
    });
  });

  describe('list_job_instances', () => {
    it('should execute tool and return valid MCP response', async () => {
      // Arrange
      const parameters = {
        PageSize: 10,
        Page: 0
      };

      // Act
      const result = await executeMCPTool("list_job_instances", parameters);

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
      const result = await executeMCPTool("list_job_instances", { PageSize: 5, Page: 0 });

      // Assert
      const data = expectJSONResponse(result);
      expect(data.data.length).toBeLessThanOrEqual(5);
    });
  });

  describe('get_job_instance', () => {
    it('should execute tool and return valid MCP response for existing job instance', async () => {
      // Arrange
      const parameters = {
        id: TEST_JOB_INSTANCE_IDS.VALID
      };

      // Act
      const result = await executeMCPTool("get_job_instance", parameters);

      // Assert - MCP Response Structure
      expectValidMCPResponse(result);

      // Assert - Response Data
      const data = expectJSONResponse(result);
      expect(data.id).toBe(TEST_JOB_INSTANCE_IDS.VALID);
      expect(data).toHaveProperty('jobDefinitionId');
      expect(data).toHaveProperty('endpointId');
      expect(data).toHaveProperty('status');
    });

    it('should return 404 error for non-existent job instance', async () => {
      // Arrange
      const parameters = {
        id: TEST_JOB_INSTANCE_IDS.INVALID
      };

      // Act & Assert
      await expect(executeMCPTool("get_job_instance", parameters))
        .rejects.toThrow();
    });

    it('should reject request without required id parameter', async () => {
      // Act & Assert
      await expect(executeMCPTool("get_job_instance", {}))
        .rejects.toThrow(/id is required/);
    });
  });

  describe('list_endpoint_job_instances', () => {
    it('should execute tool and return valid MCP response', async () => {
      // Arrange
      const parameters = {
        endpointId: TEST_ENDPOINT_IDS.WINDOWS_VALID,
        PageSize: 10,
        Page: 0
      };

      // Act
      const result = await executeMCPTool("list_endpoint_job_instances", parameters);

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
      await expect(executeMCPTool("list_endpoint_job_instances", {}))
        .rejects.toThrow(/endpointId is required/);
    });
  });

  describe('list_kiosk_releases', () => {
    it('should execute tool and return valid MCP response', async () => {
      // Arrange
      const parameters = {
        PageSize: 10,
        Page: 0
      };

      // Act
      const result = await executeMCPTool("list_kiosk_releases", parameters);

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
      const result = await executeMCPTool("list_kiosk_releases", { PageSize: 5, Page: 0 });

      // Assert
      const data = expectJSONResponse(result);
      expect(data.data.length).toBeLessThanOrEqual(5);
    });
  });

  describe('get_kiosk_release', () => {
    it('should execute tool and return valid MCP response for existing kiosk release', async () => {
      // Arrange
      const parameters = {
        id: TEST_KIOSK_RELEASE_IDS.VALID
      };

      // Act
      const result = await executeMCPTool("get_kiosk_release", parameters);

      // Assert - MCP Response Structure
      expectValidMCPResponse(result);

      // Assert - Response Data
      const data = expectJSONResponse(result);
      expect(data.id).toBe(TEST_KIOSK_RELEASE_IDS.VALID);
      expect(data).toHaveProperty('jobDefinitionId');
      expect(data).toHaveProperty('targetType');
      expect(data).toHaveProperty('targetId');
    });

    it('should return 404 error for non-existent kiosk release', async () => {
      // Arrange
      const parameters = {
        id: TEST_KIOSK_RELEASE_IDS.INVALID
      };

      // Act & Assert
      await expect(executeMCPTool("get_kiosk_release", parameters))
        .rejects.toThrow();
    });

    it('should reject request without required id parameter', async () => {
      // Act & Assert
      await expect(executeMCPTool("get_kiosk_release", {}))
        .rejects.toThrow(/id is required/);
    });
  });
});
