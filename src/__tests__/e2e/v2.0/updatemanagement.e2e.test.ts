import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { BConnectClient } from '../../../bconnect-client.js';
import { TEST_ENDPOINT_IDS } from '../helpers/test-data-fixtures.js';
import { expectValidMCPResponse, expectJSONResponse } from '../helpers/assertions.js';

const BASE_URL = 'https://bms-win22srv:444/bconnect';

const mockUpdateEndpoints = Array.from({ length: 30 }, (_, i) => ({
  id: `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
  endpointName: `endpoint-${i}`,
  updateProfileId: i % 2 === 0 ? "11111111-1111-1111-1111-111111111111" : null,
  updateProfileName: i % 2 === 0 ? "Windows Updates - Critical" : null
}));

const handlers = [
  http.get(`${BASE_URL}/updatemanagement/v2.0/WindowsEndpoints`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');
    const startIndex = page * pageSize;
    const endIndex = startIndex + pageSize;
    return HttpResponse.json({
      totalItems: mockUpdateEndpoints.length,
      data: mockUpdateEndpoints.slice(startIndex, endIndex)
    });
  }),

  http.get(`${BASE_URL}/updatemanagement/v2.0/WindowsEndpoints/:id`, ({ params }) => {
    if (params.id === TEST_ENDPOINT_IDS.WINDOWS_VALID) {
      return HttpResponse.json(mockUpdateEndpoints[0]);
    }
    return HttpResponse.json({ error: 'Endpoint not found' }, { status: 404 });
  })
];

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Update Management MCP Tools - E2E Tests', () => {
  const bconnect = new BConnectClient({
    baseUrl: BASE_URL,
    username: 'Administrator',
    password: 'baramundi-2008',
    rejectUnauthorized: false,
      disableHttpsAgent: true  // Disable HTTPS agent to allow MSW interception
  });

  async function executeMCPTool(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case "list_update_windows_endpoints":
        const endpoints = await bconnect.updatemanagement.getWindowsEndpoints(args || {});
        return { content: [{ type: "text", text: JSON.stringify(endpoints, null, 2) }] };
      case "get_update_windows_endpoint":
        if (!args?.id) throw new Error("id is required");
        const endpoint = await bconnect.updatemanagement.getWindowsEndpoint(args.id);
        return { content: [{ type: "text", text: JSON.stringify(endpoint, null, 2) }] };
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  describe('list_update_windows_endpoints', () => {
    it('should execute tool and return valid MCP response', async () => {
      const result = await executeMCPTool("list_update_windows_endpoints", { PageSize: 10, Page: 0 });
      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('totalItems');
      expect(data.data.length).toBeLessThanOrEqual(10);
    });

    it('should return paginated results with correct page size', async () => {
      const result = await executeMCPTool("list_update_windows_endpoints", { PageSize: 5, Page: 0 });
      const data = expectJSONResponse(result);
      expect(data.data.length).toBeLessThanOrEqual(5);
    });
  });

  describe('get_update_windows_endpoint', () => {
    it('should execute tool and return valid MCP response for existing endpoint', async () => {
      const result = await executeMCPTool("get_update_windows_endpoint", { id: TEST_ENDPOINT_IDS.WINDOWS_VALID });
      expectValidMCPResponse(result);
      const data = expectJSONResponse(result);
      expect(data).toHaveProperty('id');
    });

    it('should return 404 error for non-existent endpoint', async () => {
      await expect(executeMCPTool("get_update_windows_endpoint", { id: TEST_ENDPOINT_IDS.INVALID })).rejects.toThrow();
    });

    it('should reject request without required id parameter', async () => {
      await expect(executeMCPTool("get_update_windows_endpoint", {})).rejects.toThrow("id is required");
    });
  });
});
