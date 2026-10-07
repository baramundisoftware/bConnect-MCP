/**
 * Endpoints — mock integration tests.
 * See docs/MOCK_INTEGRATION_TESTING.md.
 */

import { describe, it, beforeAll, expect } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { BConnectClient } from '../../bconnect-client.js';
import { createServer } from '../../index.js';
import { TOOL_VARIANTS } from '../../tool-variants.js';
import { TOOL_RELEASES } from '../../tool-releases.js';
import {
  checkMockAvailable,
  createClient,
  getMockHealth,
  MOCK_BASE_URL,
  NONEXISTENT_GUID,
} from './helpers.js';

/** Calls a tool of this server against the mock: text and isError of the result. */
async function callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const { server } = createServer({
    baseUrl: process.env.BCONNECT_BASE_URL || MOCK_BASE_URL,
    username: process.env.BCONNECT_USERNAME || 'integration-test',
    password: process.env.BCONNECT_PASSWORD || 'integration-test',
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: 'mock-test', version: '1.0.0' }, { capabilities: {} });
  await mcp.connect(clientTransport);
  const result = await mcp.callTool({ name, arguments: args });
  await mcp.close();
  return { text: (result.content as Array<{ text: string }>).map((c) => c.text).join('\n'), isError: result.isError === true };
}

let available = false;
let client: BConnectClient;

beforeAll(async () => {
  available = await checkMockAvailable();
  if (!available) {
    console.warn(`⚠  bConnectMock not reachable at ${MOCK_BASE_URL} — endpoints mock tests skipped`);
    return;
  }
  client = createClient();
});

describe('Endpoints — list Endpoints', () => {
  it('returns paged data with totalItems', async () => {
    if (!available) {return;}
    const result = await client.endpoints.getEndpoints({ PageSize: 10 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
    expect(result.data!.length).toBeGreaterThanOrEqual(1);
    expect(result.data![0]).toHaveProperty('id');
    // The spec's Endpoint (and a live bMS) names the kind of endpoint `type`
    expect(result.data![0]).toHaveProperty('type');
  });
});

describe('Endpoints — countOnly (#165)', () => {
  it('list_endpoints (WindowsEndpoint) counts what a normal call reports as totalItems', async () => {
    if (!available) {return;}
    const normal = await callTool('list_endpoints', { type: 'WindowsEndpoint' });
    const count = await callTool('list_endpoints', { type: 'WindowsEndpoint', countOnly: true });
    expect(normal.isError, normal.text).toBe(false);
    expect(count.isError, count.text).toBe(false);
    const { totalItems } = JSON.parse(normal.text) as { totalItems: number };
    expect(typeof totalItems).toBe('number');
    // The type is echoed with the other filters (REQ-SRV-029).
    expect(JSON.parse(count.text)).toEqual({ totalItems, filters: { type: 'WindowsEndpoint' } });
  });
});

describe('Endpoints — get Endpoint by id', () => {
  it('returns the same endpoint surfaced by the list', async () => {
    if (!available) {return;}
    const list = await client.endpoints.getEndpoints({ PageSize: 1 } as never);
    const id = list.data?.[0]?.id;
    if (!id) {throw new Error('mock returned empty Endpoints list');}
    const item = await client.endpoints.getEndpoint(id);
    expect(item.id).toBe(id);
  });
});

describe('Endpoints — list WindowsEndpoints', () => {
  it('returns paged data', async () => {
    if (!available) {return;}
    const result = await client.endpoints.getWindowsEndpoints({ PageSize: 5 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
  });
});

describe('Endpoints — unknown id', () => {
  it('rejects on get with nonexistent GUID', async () => {
    if (!available) {return;}
    await expect(client.endpoints.getEndpoint(NONEXISTENT_GUID)).rejects.toThrow();
  });
});

describe('Endpoints — every read route of the merged tools (REQ-SRV-029, #174)', () => {
  /** The release the mock serves, so the server lists and checks the same one. */
  async function useMockRelease(): Promise<'25R2' | '26R1'> {
    const version = (await getMockHealth())?.bmsVersion?.toLowerCase();
    const release = version === '25r2' ? '25R2' : '26R1';
    process.env.BCONNECT_RELEASE = release;
    return release;
  }
  const routes = (tool: string, release: string): Array<Record<string, string>> => Object.entries(TOOL_VARIANTS[tool])
    .filter(([key]) => (TOOL_RELEASES[key] ?? []).some((r) => r === release))
    .map(([, select]) => (select.type ? { type: select.type } : {}));

  it('list_endpoints and get_endpoint answer for every type of the release', async () => {
    if (!available) {return;}
    const release = await useMockRelease();
    const types = routes('list_endpoints', release);
    expect(types.length).toBe(release === '25R2' ? 8 : 7);
    for (const select of types) {
      const list = await callTool('list_endpoints', { ...select, PageSize: 1 });
      expect(list.isError, `${JSON.stringify(select)}: ${list.text}`).toBe(false);
      const id = (JSON.parse(list.text) as { data?: Array<{ id?: string }> }).data?.[0]?.id;
      if (!id) {continue;}
      const got = await callTool('get_endpoint', { ...select, id });
      expect(got.isError, `${JSON.stringify(select)} ${id}: ${got.text}`).toBe(false);
    }
  });

  it('list_endpoints_by_logical_group answers with and without type', async () => {
    if (!available) {return;}
    const release = await useMockRelease();
    const groups = await callTool('list_logical_groups', { PageSize: 1 });
    const logicalGroupId = (JSON.parse(groups.text) as { data?: Array<{ id?: string }> }).data?.[0]?.id;
    expect(logicalGroupId).toBeTruthy();
    for (const select of routes('list_endpoints_by_logical_group', release)) {
      const r = await callTool('list_endpoints_by_logical_group', { ...select, logicalGroupId });
      expect(r.isError, `${JSON.stringify(select)}: ${r.text}`).toBe(false);
    }
  });

  it('a removed per-type name answers with its replacement', async () => {
    if (!available) {return;}
    await useMockRelease();
    await expect(callTool('list_windows_endpoints', {})).rejects.toThrow(/replaced by list_endpoints: call list_endpoints with type "WindowsEndpoint"/);
  });
});
