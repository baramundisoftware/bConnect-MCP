/**
 * Jobs — mock integration tests.
 * See docs/MOCK_INTEGRATION_TESTING.md.
 */

import { describe, it, beforeAll, expect } from 'vitest';
import { BConnectClient } from '../../bconnect-client.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
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
    console.warn(`⚠  bConnectMock not reachable at ${MOCK_BASE_URL} — jobs mock tests skipped`);
    return;
  }
  client = createClient();
});

describe('Jobs — list JobDefinitions', () => {
  it('returns paged data with totalItems', async () => {
    if (!available) {return;}
    const result = await client.jobs.getJobDefinitions({ PageSize: 10 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
    expect(result.data!.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Jobs — get JobDefinition by id', () => {
  it('returns the same definition surfaced by the list', async () => {
    if (!available) {return;}
    const list = await client.jobs.getJobDefinitions({ PageSize: 1 } as never);
    const id = list.data?.[0]?.id;
    if (!id) {throw new Error('mock returned empty JobDefinitions list');}
    const item = await client.jobs.getJobDefinition(id);
    expect(item.id).toBe(id);
  });
});

describe('Jobs — list JobInstances', () => {
  it('returns paged data', async () => {
    if (!available) {return;}
    const result = await client.jobs.getJobInstances({ PageSize: 5 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
  });
});

describe('Jobs — unknown JobDefinition id', () => {
  it('rejects on get with nonexistent GUID', async () => {
    if (!available) {return;}
    await expect(client.jobs.getJobDefinition(NONEXISTENT_GUID)).rejects.toThrow();
  });
});

describe('Jobs — kiosk releases of a job definition (REQ-XC-005 AC 5, #166)', () => {
  it('a nonexistent job definition is never reported as "no kiosk releases"', async () => {
    if (!available) {return;}
    // The mock answers 404 as the spec documents; a live 26R1 answers 200 + empty list,
    // which the existence check covers (unit test kiosk-releases-existence.test.ts).
    const { text, isError } = await callTool('list_kiosk_releases_by_job_definition', { jobDefinitionId: NONEXISTENT_GUID });
    expect(isError).toBe(true);
    expect(text).not.toMatch(/has no kiosk releases/i);
  });

  it('an existing job definition gives its list; an empty one carries the "no kiosk releases" note', async () => {
    if (!available) {return;}
    const list = await client.jobs.getJobDefinitions({ PageSize: 1 } as never);
    const id = list.data?.[0]?.id;
    if (!id) {throw new Error('mock returned no job definitions');}
    const { text, isError } = await callTool('list_kiosk_releases_by_job_definition', { jobDefinitionId: id });
    expect(isError).toBe(false);
    const result = JSON.parse(text) as { data?: unknown[]; note?: string };
    expect(Array.isArray(result.data)).toBe(true);
    if (result.data!.length === 0) {expect(result.note).toMatch(/has no kiosk releases/i);}
    else {expect(result.note).toBeUndefined();}
  });
});
