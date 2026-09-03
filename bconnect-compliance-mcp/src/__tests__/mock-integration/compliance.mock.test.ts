/**
 * Compliance — mock integration tests.
 * See docs/MOCK_INTEGRATION_TESTING.md.
 *
 * This is the domain that exposed P29.2: a wrong URL for the tool now called
 * `list_detected_vulnerabilities_by_endpoint` (renamed from `..._for_endpoint`
 * by INT-47). That bug class is exactly what this tier is here to catch.
 */

import { describe, it, beforeAll, expect } from 'vitest';
import { BConnectClient } from '../../bconnect-client.js';
import {
  checkMockAvailable,
  createClient,
  MOCK_BASE_URL,
  NONEXISTENT_GUID,
  rawGet,
} from './helpers.js';

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

describe('Compliance — list MobileDeviceRules', () => {
  it('returns paged data with totalItems', async (ctx) => {
    if (!available) {ctx.skip();}
    const result = await client.compliance.getAllMobileDeviceRules({ PageSize: 10 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
    expect(result.data!.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Compliance — get MobileDeviceRule by id', () => {
  it('returns the same rule surfaced by the list', async (ctx) => {
    if (!available) {ctx.skip();}
    const list = await client.compliance.getAllMobileDeviceRules({ PageSize: 1 } as never);
    const id = list.data?.[0]?.id;
    if (!id) {throw new Error('mock returned empty MobileDeviceRules list');}
    const item = await client.compliance.getMobileDeviceRule(id);
    expect(item.id).toBe(id);
  });
});

describe('Compliance — list DetectedVulnerabilities for an endpoint (P29.2 regression)', () => {
  it('uses the correct WindowsEndpoints/{id}/DetectedVulnerabilities path', async (ctx) => {
    if (!available) {ctx.skip();}
    const { body: epList } = await rawGet('/endpoints/v2.0/WindowsEndpoints', { PageSize: 1 });
    const endpointId = epList?.data?.[0]?.id;
    if (!endpointId) {throw new Error('mock returned no Windows endpoints');}
    const result = await client.compliance.getDetectedVulnerabilitiesByEndpoint(endpointId);
    expect(Array.isArray(result.data)).toBe(true);
  });
});

describe('Compliance — unknown rule id', () => {
  it('rejects on get with nonexistent GUID', async (ctx) => {
    if (!available) {ctx.skip();}
    await expect(client.compliance.getMobileDeviceRule(NONEXISTENT_GUID)).rejects.toThrow();
  });
});
