import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { BConnectClient } from '../../../bconnect-client.js';
import { expectValidMCPResponse, expectJSONResponse } from '../helpers/assertions.js';

const BASE_URL = 'https://bms-win22srv:444/bconnect';
const TEST_MICROSERVICE_ID = "0";  // Match mock data IDs (simple numeric strings)
const TEST_SECURITY_GROUP_ID = "0";
const TEST_SECURITY_PROFILE_ID = "0";
const TEST_OBJECT_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const mockManagementServer = { id: "1", name: "bms-win22srv", version: "2024.1.0", status: "Online" };
const mockGateway = { id: "1", name: "Gateway1", status: "Active" };
const mockDips = [{ id: "1", name: "DIP-1", status: "Running" }, { id: "2", name: "DIP-2", status: "Stopped" }];
const mockVpnAppliance = { id: "1", name: "VPN-Appliance", status: "Connected" };
const mockMicroservices = Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, name: `Microservice-${i}`, status: i % 2 === 0 ? "Running" : "Stopped" }));
const mockCloudConnectors = [{ id: "1", name: "Azure-Connector", status: "Active" }];
const mockPxeRelays = [{ id: "1", name: "PXE-Relay-1", ip: "192.168.1.100" }];
const mockSecurityGroups = Array.from({ length: 20 }, (_, i) => ({ id: `${i}`, name: `SecurityGroup-${i}`, description: `Group ${i}` }));
const mockSecurityProfiles = Array.from({ length: 15 }, (_, i) => ({ id: `${i}`, name: `Profile-${i}`, description: `Profile ${i}` }));
const mockObjectPermissions = { objectId: TEST_OBJECT_ID, permissions: [{ securityGroupId: "1", rights: ["Read", "Write"] }] };

const handlers = [
  http.get(`${BASE_URL}/servermanagement/v2.0/ManagementServer`, () => HttpResponse.json(mockManagementServer)),
  http.get(`${BASE_URL}/servermanagement/v2.0/Gateway`, () => HttpResponse.json(mockGateway)),
  http.get(`${BASE_URL}/servermanagement/v2.0/Dips`, () => HttpResponse.json(mockDips)),
  http.get(`${BASE_URL}/servermanagement/v2.0/VpnAppliance`, () => HttpResponse.json(mockVpnAppliance)),
  http.get(`${BASE_URL}/servermanagement/v2.0/Microservices`, () => HttpResponse.json(mockMicroservices)),
  http.get(`${BASE_URL}/servermanagement/v2.0/Microservices/:id`, ({ params }) => {
    const microservice = mockMicroservices.find(m => m.id === params.id);
    return microservice ? HttpResponse.json(microservice) : HttpResponse.json({ error: 'Not found' }, { status: 404 });
  }),
  http.get(`${BASE_URL}/servermanagement/v2.0/CloudConnectors`, () => HttpResponse.json(mockCloudConnectors)),
  http.get(`${BASE_URL}/servermanagement/v2.0/PxeRelays`, () => HttpResponse.json(mockPxeRelays)),
  http.get(`${BASE_URL}/servermanagement/v2.0/SecurityGroups`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');
    const start = page * pageSize;
    return HttpResponse.json({ totalItems: mockSecurityGroups.length, data: mockSecurityGroups.slice(start, start + pageSize) });
  }),
  http.get(`${BASE_URL}/servermanagement/v2.0/SecurityGroups/:id`, ({ params }) => {
    const group = mockSecurityGroups.find(g => g.id === params.id);
    return group ? HttpResponse.json(group) : HttpResponse.json({ error: 'Not found' }, { status: 404 });
  }),
  http.get(`${BASE_URL}/servermanagement/v2.0/SecurityProfiles`, ({ request }) => {
    const url = new URL(request.url);
    const pageSize = parseInt(url.searchParams.get('PageSize') || '20');
    const page = parseInt(url.searchParams.get('Page') || '0');
    const start = page * pageSize;
    return HttpResponse.json({ totalItems: mockSecurityProfiles.length, data: mockSecurityProfiles.slice(start, start + pageSize) });
  }),
  http.get(`${BASE_URL}/servermanagement/v2.0/SecurityProfiles/:id`, ({ params }) => {
    const profile = mockSecurityProfiles.find(p => p.id === params.id);
    return profile ? HttpResponse.json(profile) : HttpResponse.json({ error: 'Not found' }, { status: 404 });
  }),
  http.get(`${BASE_URL}/servermanagement/v2.0/Objects/:objectId/Permissions`, () => HttpResponse.json(mockObjectPermissions))
];

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Server Management MCP Tools - E2E Tests', () => {
  const bconnect = new BConnectClient({
    baseUrl: BASE_URL,
    username: 'Administrator',
    password: 'baramundi-2008',
    rejectUnauthorized: false,
    disableHttpsAgent: true  // Disable HTTPS agent to allow MSW interception
  });

  async function executeMCPTool(toolName: string, args: any): Promise<any> {
    let data;
    switch (toolName) {
      case "get_management_server": data = await bconnect.servermanagement.getManagementServer(); break;
      case "get_gateway": data = await bconnect.servermanagement.getGateway(); break;
      case "get_dip_status": data = await bconnect.servermanagement.getDipStatus(); break;
      case "get_vpn_appliance": data = await bconnect.servermanagement.getVpnAppliance(); break;
      case "list_microservices": data = await bconnect.servermanagement.getMicroservices(); break;
      case "get_microservice":
        if (!args?.id) throw new Error("id is required");
        data = await bconnect.servermanagement.getMicroservice(args.id);
        break;
      case "list_cloud_connectors": data = await bconnect.servermanagement.getCloudConnectors(); break;
      case "list_pxe_relays": data = await bconnect.servermanagement.getPxeRelays(); break;
      case "list_security_groups": data = await bconnect.servermanagement.getSecurityGroups(args || {}); break;
      case "get_security_group":
        if (!args?.id) throw new Error("id is required");
        data = await bconnect.servermanagement.getSecurityGroup(args.id);
        break;
      case "list_security_profiles": data = await bconnect.servermanagement.getSecurityProfiles(args || {}); break;
      case "get_security_profile":
        if (!args?.id) throw new Error("id is required");
        data = await bconnect.servermanagement.getSecurityProfile(args.id);
        break;
      case "get_object_permissions":
        if (!args?.objectId) throw new Error("objectId is required");
        data = await bconnect.servermanagement.getAccessRights(args.objectId);
        break;
      default: throw new Error(`Unknown tool: ${toolName}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }

  it('get_management_server should execute and return valid response', async () => {
    const result = await executeMCPTool("get_management_server", {});
    expectValidMCPResponse(result);
    const data = expectJSONResponse(result);
    expect(data).toHaveProperty('id');
  });

  it('get_gateway should execute and return valid response', async () => {
    const result = await executeMCPTool("get_gateway", {});
    expectValidMCPResponse(result);
    expect(expectJSONResponse(result)).toHaveProperty('id');
  });

  it('get_dip_status should execute and return valid response', async () => {
    const result = await executeMCPTool("get_dip_status", {});
    expectValidMCPResponse(result);
    expect(Array.isArray(expectJSONResponse(result))).toBe(true);
  });

  it('get_vpn_appliance should execute and return valid response', async () => {
    const result = await executeMCPTool("get_vpn_appliance", {});
    expectValidMCPResponse(result);
    expect(expectJSONResponse(result)).toHaveProperty('id');
  });

  it('list_microservices should execute and return valid response', async () => {
    const result = await executeMCPTool("list_microservices", {});
    expectValidMCPResponse(result);
    expect(Array.isArray(expectJSONResponse(result))).toBe(true);
  });

  it('get_microservice should execute and return valid response', async () => {
    const result = await executeMCPTool("get_microservice", { id: TEST_MICROSERVICE_ID });
    expectValidMCPResponse(result);
    expect(expectJSONResponse(result)).toHaveProperty('id');
  });

  it('get_microservice should reject without id', async () => {
    await expect(executeMCPTool("get_microservice", {})).rejects.toThrow("id is required");
  });

  it('list_cloud_connectors should execute and return valid response', async () => {
    const result = await executeMCPTool("list_cloud_connectors", {});
    expectValidMCPResponse(result);
    expect(Array.isArray(expectJSONResponse(result))).toBe(true);
  });

  it('list_pxe_relays should execute and return valid response', async () => {
    const result = await executeMCPTool("list_pxe_relays", {});
    expectValidMCPResponse(result);
    expect(Array.isArray(expectJSONResponse(result))).toBe(true);
  });

  it('list_security_groups should execute and return paginated response', async () => {
    const result = await executeMCPTool("list_security_groups", { PageSize: 10, Page: 0 });
    expectValidMCPResponse(result);
    const data = expectJSONResponse(result);
    expect(data).toHaveProperty('totalItems');
    expect(data.data.length).toBeLessThanOrEqual(10);
  });

  it('get_security_group should execute and return valid response', async () => {
    const result = await executeMCPTool("get_security_group", { id: TEST_SECURITY_GROUP_ID });
    expectValidMCPResponse(result);
    expect(expectJSONResponse(result)).toHaveProperty('id');
  });

  it('get_security_group should reject without id', async () => {
    await expect(executeMCPTool("get_security_group", {})).rejects.toThrow("id is required");
  });

  it('list_security_profiles should execute and return paginated response', async () => {
    const result = await executeMCPTool("list_security_profiles", { PageSize: 10, Page: 0 });
    expectValidMCPResponse(result);
    const data = expectJSONResponse(result);
    expect(data).toHaveProperty('totalItems');
    expect(data.data.length).toBeLessThanOrEqual(10);
  });

  it('get_security_profile should execute and return valid response', async () => {
    const result = await executeMCPTool("get_security_profile", { id: TEST_SECURITY_PROFILE_ID });
    expectValidMCPResponse(result);
    expect(expectJSONResponse(result)).toHaveProperty('id');
  });

  it('get_security_profile should reject without id', async () => {
    await expect(executeMCPTool("get_security_profile", {})).rejects.toThrow("id is required");
  });
});

