/**
 * Compliance — mock integration tests.
 * See docs/MOCK_INTEGRATION_TESTING.md.
 *
 * This is the domain that exposed P29.2: a wrong URL for
 * `list_detected_vulnerabilities_for_endpoint`. That bug class is
 * exactly what this tier is here to catch.
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
  rawGet,
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
    console.warn(`⚠  bConnectMock not reachable at ${MOCK_BASE_URL} — compliance mock tests skipped`);
    return;
  }
  client = createClient();
});

describe('Compliance — list mobile device rules (/v2.0/Rules)', () => {
  it('returns paged data with totalItems', async () => {
    if (!available) {return;}
    const result = await client.compliance.getAllMobileDeviceRules({ PageSize: 10 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
    expect(result.data!.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Compliance — get MobileDeviceRule by id', () => {
  it('returns the same rule surfaced by the list', async () => {
    if (!available) {return;}
    const list = await client.compliance.getAllMobileDeviceRules({ PageSize: 1 } as never);
    const id = list.data?.[0]?.id;
    if (!id) {throw new Error('mock returned an empty rules list');}
    const item = await client.compliance.getMobileDeviceRule(id);
    expect(item.id).toBe(id);
  });
});

describe('Compliance — list DetectedVulnerabilities for an endpoint (P29.2 regression)', () => {
  it('uses the correct WindowsEndpoints/{id}/DetectedVulnerabilities path', async () => {
    if (!available) {return;}
    const { body: epList } = await rawGet('/endpoints/v2.0/WindowsEndpoints', { PageSize: 1 });
    const endpointId = epList?.data?.[0]?.id;
    if (!endpointId) {throw new Error('mock returned no Windows endpoints');}
    const result = await client.compliance.getDetectedVulnerabilitiesByEndpoint(endpointId);
    expect(Array.isArray(result.data)).toBe(true);
  });
});

describe('Compliance — unknown rule id', () => {
  it('rejects on get with nonexistent GUID', async () => {
    if (!available) {return;}
    await expect(client.compliance.getMobileDeviceRule(NONEXISTENT_GUID)).rejects.toThrow();
  });
});

describe('Compliance — 404 on findings per endpoint (REQ-XC-005 AC 4, #166)', () => {
  it.each(['list_detected_vulnerabilities_for_endpoint', 'list_detected_rule_violations_for_endpoint'])(
    '%s: a nonexistent endpoint is reported as not existing', async (tool) => {
      if (!available) {return;}
      const { text, isError } = await callTool(tool, { endpointId: NONEXISTENT_GUID });
      expect(isError).toBe(true);
      expect(text).toMatch(/^No (Windows )?endpoint with this id exists/);
      expect(text).not.toMatch(/no findings/i);
    });

  it('list_detected_rule_violations_for_endpoint: an existing endpoint without findings gives an empty result with a note', async (ctx) => {
    if (!available) {return;}
    // The mock answers 404 for endpoints without rule violations, as the spec documents.
    const { body: endpoints } = await rawGet('/endpoints/v2.0/Endpoints', { PageSize: 50 });
    const candidate = (endpoints as { data?: Array<{ id: string; type?: string }> })?.data?.find((e) => e.type === 'IOSEndpoint');
    if (!candidate) {throw new Error('mock returned no iOS endpoint');}
    const { status } = await rawGet(`/compliance/v2.0/Endpoints/${candidate.id}/DetectedRuleViolations`);
    if (status !== 404) {ctx.skip(); return;} // fixture has findings for it: reported as skipped, not passed
    const { text, isError } = await callTool('list_detected_rule_violations_for_endpoint', { endpointId: candidate.id });
    expect(isError).toBe(false);
    const result = JSON.parse(text) as { data: unknown[]; note: string };
    expect(result.data).toEqual([]);
    expect(result.note).toMatch(/no findings were reported/i);
  });
});
