/**
 * E2E Tests for Active Directory MCP Tools
 *
 * Tests the complete execution flow of Active Directory MCP tools:
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
  TEST_AD_IDS,
  MOCK_AD_USER,
  MOCK_AD_GROUP,
  MOCK_AD_OBJECT,
  MOCK_ORG_UNIT,
  generateMockADUsers,
  generateMockADGroups,
  generateMockADObjects,
  generateMockOrgUnits
} from '../../e2e/helpers/test-data-fixtures.js';
import {
  expectValidMCPResponse,
  expectJSONResponse
} from '../../e2e/helpers/assertions.js';

const BASE_URL = 'https://bms-win22srv:444/bconnect';

// Generate stable mock data outside handlers (prevents random test failures)
const allMockADUsers = generateMockADUsers(50);
const allMockADGroups = generateMockADGroups(30);
const allMockADObjects = generateMockADObjects(80);
const allMockOrgUnits = generateMockOrgUnits(20);

// MSW Request Handlers for Active Directory API
const handlers = [
  // GET /activedirectory/v2.0/ADGroups - List all AD groups
  http.get(`${BASE_URL}/activedirectory/v2.0/ADGroups`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');
    const searchQuery = url.searchParams.get('SearchQuery') || '';

    let filteredGroups = [...allMockADGroups];

    // Apply search filter
    if (searchQuery) {
      filteredGroups = filteredGroups.filter(g =>
        g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        g.sAMAccountName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (g.description && g.description.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }

    // Apply pagination
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedData = filteredGroups.slice(startIndex, endIndex);

    return HttpResponse.json({
      totalItems: filteredGroups.length,
      data: paginatedData
    });
  }),

  // GET /activedirectory/v2.0/ADGroups/{id} - Get specific AD group
  http.get(`${BASE_URL}/activedirectory/v2.0/ADGroups/:id`, ({ params }) => {
    const { id } = params;

    if (id === TEST_AD_IDS.GROUP_VALID) {
      return HttpResponse.json(MOCK_AD_GROUP);
    }

    return HttpResponse.json(
      { error: 'AD group not found' },
      { status: 404 }
    );
  }),

  // GET /activedirectory/v2.0/ADUsers - List all AD users
  http.get(`${BASE_URL}/activedirectory/v2.0/ADUsers`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');
    const searchQuery = url.searchParams.get('SearchQuery') || '';

    let filteredUsers = [...allMockADUsers];

    // Apply search filter
    if (searchQuery) {
      filteredUsers = filteredUsers.filter(u =>
        u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.sAMAccountName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (u.email && u.email.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }

    // Apply pagination
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedData = filteredUsers.slice(startIndex, endIndex);

    return HttpResponse.json({
      totalItems: filteredUsers.length,
      data: paginatedData
    });
  }),

  // GET /activedirectory/v2.0/ADUsers/{id} - Get specific AD user
  http.get(`${BASE_URL}/activedirectory/v2.0/ADUsers/:id`, ({ params }) => {
    const { id } = params;

    if (id === TEST_AD_IDS.USER_VALID) {
      return HttpResponse.json(MOCK_AD_USER);
    }

    return HttpResponse.json(
      { error: 'AD user not found' },
      { status: 404 }
    );
  }),

  // GET /activedirectory/v2.0/ADObjects - List all AD objects
  http.get(`${BASE_URL}/activedirectory/v2.0/ADObjects`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');
    const searchQuery = url.searchParams.get('SearchQuery') || '';

    let filteredObjects = [...allMockADObjects];

    // Apply search filter
    if (searchQuery) {
      filteredObjects = filteredObjects.filter(o =>
        o.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        o.sAMAccountName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (o.distinguishedName && o.distinguishedName.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }

    // Apply pagination
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedData = filteredObjects.slice(startIndex, endIndex);

    return HttpResponse.json({
      totalItems: filteredObjects.length,
      data: paginatedData
    });
  }),

  // GET /activedirectory/v2.0/ADObjects/{id} - Get specific AD object
  http.get(`${BASE_URL}/activedirectory/v2.0/ADObjects/:id`, ({ params }) => {
    const { id } = params;

    if (id === TEST_AD_IDS.USER_VALID) {
      return HttpResponse.json(MOCK_AD_OBJECT);
    }

    return HttpResponse.json(
      { error: 'AD object not found' },
      { status: 404 }
    );
  }),

  // GET /activedirectory/v2.0/OrgUnits - List all organizational units
  http.get(`${BASE_URL}/activedirectory/v2.0/OrgUnits`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');
    const searchQuery = url.searchParams.get('SearchQuery') || '';

    let filteredOrgUnits = [...allMockOrgUnits];

    // Apply search filter
    if (searchQuery) {
      filteredOrgUnits = filteredOrgUnits.filter(ou =>
        ou.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (ou.distinguishedName && ou.distinguishedName.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (ou.description && ou.description.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }

    // Apply pagination
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedData = filteredOrgUnits.slice(startIndex, endIndex);

    return HttpResponse.json({
      totalItems: filteredOrgUnits.length,
      data: paginatedData
    });
  }),

  // GET /activedirectory/v2.0/OrgUnits/{id} - Get specific organizational unit
  http.get(`${BASE_URL}/activedirectory/v2.0/OrgUnits/:id`, ({ params }) => {
    const { id } = params;

    if (id === TEST_AD_IDS.OU_VALID) {
      return HttpResponse.json(MOCK_ORG_UNIT);
    }

    return HttpResponse.json(
      { error: 'Organizational unit not found' },
      { status: 404 }
    );
  }),

  // GET /activedirectory/v2.0/ADGroups/{adGroupId}/ADUsers - List users in AD group
  http.get(`${BASE_URL}/activedirectory/v2.0/ADGroups/:adGroupId/ADUsers`,
    ({ params, request }) => {
      const { adGroupId } = params;
      const url = new URL(request.url);
      const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
      const page = parseInt(url.searchParams.get('Page') || '0');

      // For test purposes, return a subset of users for this group
      const groupUsers = allMockADUsers.slice(0, 5);

      // Apply pagination
      const startIndex = page * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedData = groupUsers.slice(startIndex, endIndex);

      return HttpResponse.json({
        totalItems: groupUsers.length,
        data: paginatedData
      });
    }
  ),

  // GET /activedirectory/v2.0/OrgUnits/{orgUnitId}/ADGroups - List groups in org unit
  http.get(`${BASE_URL}/activedirectory/v2.0/OrgUnits/:orgUnitId/ADGroups`,
    ({ params, request }) => {
      const { orgUnitId } = params;
      const url = new URL(request.url);
      const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
      const page = parseInt(url.searchParams.get('Page') || '0');

      // For test purposes, return a subset of groups for this OU
      const ouGroups = allMockADGroups.slice(0, 3);

      // Apply pagination
      const startIndex = page * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedData = ouGroups.slice(startIndex, endIndex);

      return HttpResponse.json({
        totalItems: ouGroups.length,
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
    case "list_ad_groups":
      const adGroups = await bconnect.activedirectory.getADGroups(args || {});
      return {
        content: [{
          type: "text",
          text: JSON.stringify(adGroups, null, 2)
        }]
      };

    case "get_ad_group":
      const adGroup = await bconnect.activedirectory.getADGroup(args.id);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(adGroup, null, 2)
        }]
      };

    case "list_ad_users":
      const adUsers = await bconnect.activedirectory.getADUsers(args || {});
      return {
        content: [{
          type: "text",
          text: JSON.stringify(adUsers, null, 2)
        }]
      };

    case "get_ad_user":
      if (!args?.id) {
        throw new Error("id is required");
      }
      const adUser = await bconnect.activedirectory.getADUser(args.id);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(adUser, null, 2)
        }]
      };

    case "list_ad_objects":
      const adObjects = await bconnect.activedirectory.getADObjects(args || {});
      return {
        content: [{
          type: "text",
          text: JSON.stringify(adObjects, null, 2)
        }]
      };

    case "get_ad_object":
      const adObject = await bconnect.activedirectory.getADObject(args.id);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(adObject, null, 2)
        }]
      };

    case "list_org_units":
      const orgUnits = await bconnect.activedirectory.getOrgUnits(args || {});
      return {
        content: [{
          type: "text",
          text: JSON.stringify(orgUnits, null, 2)
        }]
      };

    case "get_org_unit":
      const orgUnit = await bconnect.activedirectory.getOrgUnit(args.id);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(orgUnit, null, 2)
        }]
      };

    case "list_ad_users_by_group":
      if (!args?.adGroupId) {
        throw new Error("adGroupId is required");
      }
      const groupUsers = await bconnect.activedirectory.getADUsersByGroup(
        args.adGroupId,
        args
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify(groupUsers, null, 2)
        }]
      };

    case "list_ad_groups_by_org_unit":
      if (!args?.orgUnitId) {
        throw new Error("orgUnitId is required");
      }
      const ouGroups = await bconnect.activedirectory.getADGroupsByOrgUnit(
        args.orgUnitId,
        args
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify(ouGroups, null, 2)
        }]
      };

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

describe('Active Directory MCP Tools - E2E Tests', () => {
  describe('list_ad_groups', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = { PageSize: 10, Page: 0 };
      const result = await executeMCPTool("list_ad_groups", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
      expect(data.data.length).toBeLessThanOrEqual(10);
    });

    it('should return paginated results with correct page size', async () => {
      const parameters = { PageSize: 5, Page: 0 };
      const result = await executeMCPTool("list_ad_groups", parameters);

      const data = expectJSONResponse(result);
      expect(data.data.length).toBeLessThanOrEqual(5);
      expect(data.totalItems).toBeGreaterThan(0);
    });
  });

  describe('get_ad_group', () => {
    it('should execute tool and return valid MCP response for existing AD group', async () => {
      const parameters = { id: TEST_AD_IDS.GROUP_VALID };
      const result = await executeMCPTool("get_ad_group", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toBeDefined();
    });

    it('should return 404 error for non-existent AD group', async () => {
      const parameters = { id: TEST_AD_IDS.INVALID };

      await expect(
        executeMCPTool("get_ad_group", parameters)
      ).rejects.toThrow();
    });

    it('should reject request without required id parameter', async () => {
      const parameters = {};

      await expect(
        executeMCPTool("get_ad_group", parameters)
      ).rejects.toThrow();
    });
  });

  describe('list_ad_users', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = { PageSize: 10, Page: 0 };
      const result = await executeMCPTool("list_ad_users", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
      expect(data.data.length).toBeLessThanOrEqual(10);
    });

    it('should return paginated results with correct page size', async () => {
      const parameters = { PageSize: 5, Page: 0 };
      const result = await executeMCPTool("list_ad_users", parameters);

      const data = expectJSONResponse(result);
      expect(data.data.length).toBeLessThanOrEqual(5);
      expect(data.totalItems).toBeGreaterThan(0);
    });
  });

  describe('get_ad_user', () => {
    it('should execute tool and return valid MCP response for existing AD user', async () => {
      const parameters = { id: TEST_AD_IDS.USER_VALID };
      const result = await executeMCPTool("get_ad_user", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toBeDefined();
    });

    it('should return 404 error for non-existent AD user', async () => {
      const parameters = { id: TEST_AD_IDS.INVALID };

      await expect(
        executeMCPTool("get_ad_user", parameters)
      ).rejects.toThrow();
    });

    it('should reject request without required id parameter', async () => {
      const parameters = {};

      await expect(
        executeMCPTool("get_ad_user", parameters)
      ).rejects.toThrow(/id is required/);
    });
  });

  describe('list_ad_objects', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = { PageSize: 10, Page: 0 };
      const result = await executeMCPTool("list_ad_objects", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
      expect(data.data.length).toBeLessThanOrEqual(10);
    });

    it('should return paginated results with correct page size', async () => {
      const parameters = { PageSize: 5, Page: 0 };
      const result = await executeMCPTool("list_ad_objects", parameters);

      const data = expectJSONResponse(result);
      expect(data.data.length).toBeLessThanOrEqual(5);
      expect(data.totalItems).toBeGreaterThan(0);
    });
  });

  describe('get_ad_object', () => {
    it('should execute tool and return valid MCP response for existing AD object', async () => {
      const parameters = { id: TEST_AD_IDS.USER_VALID };
      const result = await executeMCPTool("get_ad_object", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toBeDefined();
    });

    it('should return 404 error for non-existent AD object', async () => {
      const parameters = { id: TEST_AD_IDS.INVALID };

      await expect(
        executeMCPTool("get_ad_object", parameters)
      ).rejects.toThrow();
    });

    it('should reject request without required id parameter', async () => {
      const parameters = {};

      await expect(
        executeMCPTool("get_ad_object", parameters)
      ).rejects.toThrow();
    });
  });

  describe('list_org_units', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = { PageSize: 10, Page: 0 };
      const result = await executeMCPTool("list_org_units", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
      expect(data.data.length).toBeLessThanOrEqual(10);
    });

    it('should return paginated results with correct page size', async () => {
      const parameters = { PageSize: 5, Page: 0 };
      const result = await executeMCPTool("list_org_units", parameters);

      const data = expectJSONResponse(result);
      expect(data.data.length).toBeLessThanOrEqual(5);
      expect(data.totalItems).toBeGreaterThan(0);
    });
  });

  describe('get_org_unit', () => {
    it('should execute tool and return valid MCP response for existing organizational unit', async () => {
      const parameters = { id: TEST_AD_IDS.OU_VALID };
      const result = await executeMCPTool("get_org_unit", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toBeDefined();
    });

    it('should return 404 error for non-existent organizational unit', async () => {
      const parameters = { id: TEST_AD_IDS.INVALID };

      await expect(
        executeMCPTool("get_org_unit", parameters)
      ).rejects.toThrow();
    });

    it('should reject request without required id parameter', async () => {
      const parameters = {};

      await expect(
        executeMCPTool("get_org_unit", parameters)
      ).rejects.toThrow();
    });
  });

  describe('list_ad_users_by_group', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = { adGroupId: TEST_AD_IDS.GROUP_VALID };
      const result = await executeMCPTool("list_ad_users_by_group", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
    });

    it('should reject request without required adGroupId parameter', async () => {
      const parameters = {};

      await expect(
        executeMCPTool("list_ad_users_by_group", parameters)
      ).rejects.toThrow(/adGroupId is required/);
    });
  });

  describe('list_ad_groups_by_org_unit', () => {
    it('should execute tool and return valid MCP response', async () => {
      const parameters = { orgUnitId: TEST_AD_IDS.OU_VALID };
      const result = await executeMCPTool("list_ad_groups_by_org_unit", parameters);

      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data).toHaveProperty('data');
    });

    it('should reject request without required orgUnitId parameter', async () => {
      const parameters = {};

      await expect(
        executeMCPTool("list_ad_groups_by_org_unit", parameters)
      ).rejects.toThrow(/orgUnitId is required/);
    });
  });
});
