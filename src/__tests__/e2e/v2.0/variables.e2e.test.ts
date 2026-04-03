/**
 * E2E Tests for Variables MCP Tools
 *
 * Tests the complete execution flow of Variables MCP tools:
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
  TEST_AD_IDS,
  TEST_JOB_DEFINITION_IDS,
  TEST_WINDOWS_APP_IDS,
  TEST_VARIABLE_DEFINITION_IDS,
  TEST_VARIABLE_INSTANCE_IDS,
  MOCK_VARIABLE_DEFINITION,
  MOCK_VARIABLE_INSTANCE,
  generateMockVariableDefinitions,
  generateMockVariableInstances
} from '../../e2e/helpers/test-data-fixtures.js';
import {
  expectValidMCPResponse,
  expectJSONResponse
} from '../../e2e/helpers/assertions.js';

const BASE_URL = 'https://bms-win22srv:444/bconnect';

// Generate stable mock data outside handlers (prevents random test failures)
const allMockVariableDefinitions = generateMockVariableDefinitions(30);
const allMockVariableInstances = generateMockVariableInstances(50);

// MSW Request Handlers for Variables API
const handlers = [
  // GET /variables/v2.0/VariableDefinitions - List all variable definitions
  http.get(`${BASE_URL}/variables/v2.0/VariableDefinitions`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');
    const searchQuery = url.searchParams.get('SearchQuery') || '';

    let filteredDefinitions = [...allMockVariableDefinitions];

    // Apply search filter
    if (searchQuery) {
      filteredDefinitions = filteredDefinitions.filter(d =>
        d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (d.description && d.description.toLowerCase().includes(searchQuery.toLowerCase()))
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

  // GET /variables/v2.0/VariableDefinitions/{id} - Get specific variable definition
  http.get(`${BASE_URL}/variables/v2.0/VariableDefinitions/:id`, ({ params }) => {
    const { id } = params;

    if (id === TEST_VARIABLE_DEFINITION_IDS.VALID) {
      return HttpResponse.json(MOCK_VARIABLE_DEFINITION);
    }

    return HttpResponse.json(
      { error: 'Variable definition not found' },
      { status: 404 }
    );
  }),

  // GET /variables/v2.0/VariableInstances - List all variable instances
  http.get(`${BASE_URL}/variables/v2.0/VariableInstances`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');
    const searchQuery = url.searchParams.get('SearchQuery') || '';

    let filteredInstances = [...allMockVariableInstances];

    // Apply search filter
    if (searchQuery) {
      filteredInstances = filteredInstances.filter(i =>
        i.variableDefinitionName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        i.entityName.toLowerCase().includes(searchQuery.toLowerCase())
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

  // GET /variables/v2.0/VariableInstances/{id} - Get specific variable instance
  http.get(`${BASE_URL}/variables/v2.0/VariableInstances/:id`, ({ params }) => {
    const { id } = params;

    if (id === TEST_VARIABLE_INSTANCE_IDS.VALID) {
      return HttpResponse.json(MOCK_VARIABLE_INSTANCE);
    }

    return HttpResponse.json(
      { error: 'Variable instance not found' },
      { status: 404 }
    );
  }),

  // GET /variables/v2.0/Endpoints/{endpointId}/VariableInstances - List variables by endpoint
  http.get(`${BASE_URL}/variables/v2.0/Endpoints/:endpointId/VariableInstances`,
    ({ params, request }) => {
      const { endpointId } = params;
      const url = new URL(request.url);
      const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
      const page = parseInt(url.searchParams.get('Page') || '0');

      // For test purposes, return a subset of instances for this endpoint
      const endpointInstances = allMockVariableInstances.filter(i =>
        i.entityId === endpointId && i.entityType === 'Endpoint'
      );

      // Apply pagination
      const startIndex = page * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedData = endpointInstances.slice(startIndex, endIndex);

      return HttpResponse.json({
        totalItems: endpointInstances.length,
        data: paginatedData
      });
    }
  ),

  // GET /variables/v2.0/LogicalGroups/{logicalGroupId}/VariableInstances - List variables by logical group
  http.get(`${BASE_URL}/variables/v2.0/LogicalGroups/:logicalGroupId/VariableInstances`,
    ({ params, request }) => {
      const { logicalGroupId } = params;
      const url = new URL(request.url);
      const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
      const page = parseInt(url.searchParams.get('Page') || '0');

      // For test purposes, return a subset of instances for this logical group
      const groupInstances = allMockVariableInstances.slice(0, 3);

      // Apply pagination
      const startIndex = page * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedData = groupInstances.slice(startIndex, endIndex);

      return HttpResponse.json({
        totalItems: groupInstances.length,
        data: paginatedData
      });
    }
  ),

  // GET /variables/v2.0/ADObjects/{adObjectId}/VariableInstances - List variables by AD object
  http.get(`${BASE_URL}/variables/v2.0/ADObjects/:adObjectId/VariableInstances`,
    ({ params, request }) => {
      const { adObjectId } = params;
      const url = new URL(request.url);
      const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
      const page = parseInt(url.searchParams.get('Page') || '0');

      // For test purposes, return a subset of instances for this AD object
      const adObjectInstances = allMockVariableInstances.slice(0, 2);

      // Apply pagination
      const startIndex = page * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedData = adObjectInstances.slice(startIndex, endIndex);

      return HttpResponse.json({
        totalItems: adObjectInstances.length,
        data: paginatedData
      });
    }
  ),

  // GET /variables/v2.0/WindowsApplications/{windowsApplicationId}/VariableInstances - List variables by Windows application
  http.get(`${BASE_URL}/variables/v2.0/WindowsApplications/:windowsApplicationId/VariableInstances`,
    ({ params, request }) => {
      const { windowsApplicationId } = params;
      const url = new URL(request.url);
      const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
      const page = parseInt(url.searchParams.get('Page') || '0');

      // For test purposes, return a subset of instances for this Windows application
      const appInstances = allMockVariableInstances.slice(0, 4);

      // Apply pagination
      const startIndex = page * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedData = appInstances.slice(startIndex, endIndex);

      return HttpResponse.json({
        totalItems: appInstances.length,
        data: paginatedData
      });
    }
  ),

  // GET /variables/v2.0/WindowsJobDefinitions/{windowsJobDefinitionId}/VariableInstances - List variables by Windows job definition
  http.get(`${BASE_URL}/variables/v2.0/WindowsJobDefinitions/:windowsJobDefinitionId/VariableInstances`,
    ({ params, request }) => {
      const { windowsJobDefinitionId } = params;
      const url = new URL(request.url);
      const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
      const page = parseInt(url.searchParams.get('Page') || '0');

      // For test purposes, return a subset of instances for this Windows job definition
      const jobInstances = allMockVariableInstances.slice(0, 5);

      // Apply pagination
      const startIndex = page * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedData = jobInstances.slice(startIndex, endIndex);

      return HttpResponse.json({
        totalItems: jobInstances.length,
        data: paginatedData
      });
    }
  ),
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
    case "list_variable_definitions":
      const variableDefinitions = await bconnect.variables.getVariableDefinitions(args || {});
      return {
        content: [{
          type: "text",
          text: JSON.stringify(variableDefinitions, null, 2)
        }]
      };

    case "get_variable_definition":
      if (!args?.id) {
        throw new Error("id is required");
      }
      const variableDefinition = await bconnect.variables.getVariableDefinition(args.id);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(variableDefinition, null, 2)
        }]
      };

    case "list_variable_instances":
      const variableInstances = await bconnect.variables.getVariableInstances(args || {});
      return {
        content: [{
          type: "text",
          text: JSON.stringify(variableInstances, null, 2)
        }]
      };

    case "get_variable_instance":
      if (!args?.id) {
        throw new Error("id is required");
      }
      const variableInstance = await bconnect.variables.getVariableInstance(args.id);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(variableInstance, null, 2)
        }]
      };

    case "list_variables_by_endpoint":
      if (!args?.endpointId) {
        throw new Error("endpointId is required");
      }
      const endpointVariables = await bconnect.variables.getVariableInstancesByEndpoint(
        args.endpointId,
        args
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify(endpointVariables, null, 2)
        }]
      };

    case "list_variables_by_logical_group":
      if (!args?.logicalGroupId) {
        throw new Error("logicalGroupId is required");
      }
      const groupVariables = await bconnect.variables.getVariableInstancesByLogicalGroup(
        args.logicalGroupId,
        args
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify(groupVariables, null, 2)
        }]
      };

    case "list_variables_by_ad_object":
      if (!args?.adObjectId) {
        throw new Error("adObjectId is required");
      }
      const adObjectVariables = await bconnect.variables.getVariableInstancesByADObject(
        args.adObjectId,
        args
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify(adObjectVariables, null, 2)
        }]
      };

    case "list_variables_by_windows_application":
      if (!args?.windowsApplicationId) {
        throw new Error("windowsApplicationId is required");
      }
      const appVariables = await bconnect.variables.getVariableInstancesByWindowsApplication(
        args.windowsApplicationId,
        args
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify(appVariables, null, 2)
        }]
      };

    case "list_variables_by_windows_job":
      if (!args?.windowsJobDefinitionId) {
        throw new Error("windowsJobDefinitionId is required");
      }
      const jobVariables = await bconnect.variables.getVariableInstancesByWindowsJobDefinition(
        args.windowsJobDefinitionId,
        args
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify(jobVariables, null, 2)
        }]
      };

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

describe('Variables MCP Tools - E2E Tests', () => {
  describe('list_variable_definitions', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = { PageSize: 10, Page: 0 };
      const result = await executeMCPTool("list_variable_definitions", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
      expect(data.data.length).toBeLessThanOrEqual(10);
    });

    it('should return paginated results with correct page size', async () => {
      const parameters = { PageSize: 5, Page: 0 };
      const result = await executeMCPTool("list_variable_definitions", parameters);

      const data = expectJSONResponse(result);
      expect(data.data.length).toBeLessThanOrEqual(5);
      expect(data.totalItems).toBeGreaterThan(0);
    });
  });

  describe('get_variable_definition', () => {
    it('should execute tool and return valid MCP response for existing definition', async () => {
      const parameters = { id: TEST_VARIABLE_DEFINITION_IDS.VALID };
      const result = await executeMCPTool("get_variable_definition", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toBeDefined();
    });

    it('should return 404 error for non-existent definition', async () => {
      const parameters = { id: TEST_VARIABLE_DEFINITION_IDS.INVALID };

      await expect(
        executeMCPTool("get_variable_definition", parameters)
      ).rejects.toThrow();
    });

    it('should reject request without required id parameter', async () => {
      const parameters = {};

      await expect(
        executeMCPTool("get_variable_definition", parameters)
      ).rejects.toThrow(/id is required/);
    });
  });

  describe('list_variable_instances', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = { PageSize: 10, Page: 0 };
      const result = await executeMCPTool("list_variable_instances", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
      expect(data.data.length).toBeLessThanOrEqual(10);
    });

    it('should return paginated results with correct page size', async () => {
      const parameters = { PageSize: 5, Page: 0 };
      const result = await executeMCPTool("list_variable_instances", parameters);

      const data = expectJSONResponse(result);
      expect(data.data.length).toBeLessThanOrEqual(5);
      expect(data.totalItems).toBeGreaterThan(0);
    });
  });

  describe('get_variable_instance', () => {
    it('should execute tool and return valid MCP response for existing instance', async () => {
      const parameters = { id: TEST_VARIABLE_INSTANCE_IDS.VALID };
      const result = await executeMCPTool("get_variable_instance", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toBeDefined();
    });

    it('should return 404 error for non-existent instance', async () => {
      const parameters = { id: TEST_VARIABLE_INSTANCE_IDS.INVALID };

      await expect(
        executeMCPTool("get_variable_instance", parameters)
      ).rejects.toThrow();
    });

    it('should reject request without required id parameter', async () => {
      const parameters = {};

      await expect(
        executeMCPTool("get_variable_instance", parameters)
      ).rejects.toThrow(/id is required/);
    });
  });

  describe('list_variables_by_endpoint', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = { endpointId: TEST_ENDPOINT_IDS.WINDOWS_VALID };
      const result = await executeMCPTool("list_variables_by_endpoint", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
    });

    it('should reject request without required endpointId parameter', async () => {
      const parameters = {};

      await expect(
        executeMCPTool("list_variables_by_endpoint", parameters)
      ).rejects.toThrow(/endpointId is required/);
    });
  });

  describe('list_variables_by_logical_group', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = { logicalGroupId: TEST_LOGICAL_GROUP_IDS.VALID };
      const result = await executeMCPTool("list_variables_by_logical_group", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
    });

    it('should reject request without required logicalGroupId parameter', async () => {
      const parameters = {};

      await expect(
        executeMCPTool("list_variables_by_logical_group", parameters)
      ).rejects.toThrow(/logicalGroupId is required/);
    });
  });

  describe('list_variables_by_ad_object', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = { adObjectId: TEST_AD_IDS.USER_VALID };
      const result = await executeMCPTool("list_variables_by_ad_object", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
    });

    it('should reject request without required adObjectId parameter', async () => {
      const parameters = {};

      await expect(
        executeMCPTool("list_variables_by_ad_object", parameters)
      ).rejects.toThrow(/adObjectId is required/);
    });
  });

  describe('list_variables_by_windows_application', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = { windowsApplicationId: TEST_WINDOWS_APP_IDS.VALID };
      const result = await executeMCPTool("list_variables_by_windows_application", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
    });

    it('should reject request without required windowsApplicationId parameter', async () => {
      const parameters = {};

      await expect(
        executeMCPTool("list_variables_by_windows_application", parameters)
      ).rejects.toThrow(/windowsApplicationId is required/);
    });
  });

  describe('list_variables_by_windows_job', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = { windowsJobDefinitionId: TEST_JOB_DEFINITION_IDS.WINDOWS_VALID };
      const result = await executeMCPTool("list_variables_by_windows_job", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
    });

    it('should reject request without required windowsJobDefinitionId parameter', async () => {
      const parameters = {};

      await expect(
        executeMCPTool("list_variables_by_windows_job", parameters)
      ).rejects.toThrow(/windowsJobDefinitionId is required/);
    });
  });
});
