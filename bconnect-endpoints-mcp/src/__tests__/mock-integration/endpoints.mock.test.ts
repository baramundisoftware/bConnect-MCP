/**
 * Endpoints — mock integration tests.
 * See docs/MOCK_INTEGRATION_TESTING.md.
 */

import { describe, it, beforeAll, expect } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { BConnectClient } from '../../bconnect-client.js';
import { createServer } from '../../index.js';
import {
  checkMockAvailable,
  createClient,
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
    expect(result.data![0]).toHaveProperty('endpointType');
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
    expect(JSON.parse(count.text)).toEqual({ totalItems });
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
