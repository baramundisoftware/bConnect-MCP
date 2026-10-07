/**
 * Software — mock integration tests.
 * See docs/MOCK_INTEGRATION_TESTING.md.
 */

import { describe, it, beforeAll, expect } from 'vitest';
import { BConnectClient } from '../../bconnect-client.js';
import { TOOL_RELEASES } from '../../tool-releases.js';
import {
  checkMockAvailable,
  createClient,
  getMockHealth,
  MOCK_BASE_URL,
  NONEXISTENT_GUID,
} from './helpers.js';

let available = false;
let client: BConnectClient;
// Bundles exist from bMS 26R1 on; against a 25R2 mock their tests are skipped, not failed.
let bundles = false;

beforeAll(async () => {
  available = await checkMockAvailable();
  if (!available) {
    console.warn(`⚠  bConnectMock not reachable at ${MOCK_BASE_URL} — software mock tests skipped`);
    return;
  }
  client = createClient();
  const version = (await getMockHealth())?.bmsVersion?.toLowerCase();
  bundles = TOOL_RELEASES.list_software_bundles.includes(version === '25r2' ? '25R2' : '26R1');
});

describe('Software — list InstalledWindowsSoftware', () => {
  it('returns paged data with totalItems', async () => {
    if (!available) {return;}
    const result = await client.software.getInstalledWindowsSoftware({ PageSize: 10 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
  });
});

describe('Software — list Bundles', () => {
  it('returns paged data with at least one entry', async (ctx) => {
    if (!available) {return;}
    if (!bundles) {ctx.skip(); return;}
    const result = await client.software.getSoftwareBundles({ PageSize: 10 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
    expect(result.data!.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Software — get Bundle by id', () => {
  it('returns the same bundle surfaced by the list', async (ctx) => {
    if (!available) {return;}
    if (!bundles) {ctx.skip(); return;}
    const list = await client.software.getSoftwareBundles({ PageSize: 1 } as never);
    const id = list.data?.[0]?.id;
    if (!id) {throw new Error('mock returned empty Bundles list');}
    const item = await client.software.getSoftwareBundle(id);
    expect(item.id).toBe(id);
  });
});

describe('Software — unknown Bundle id', () => {
  it('rejects on get with nonexistent GUID', async (ctx) => {
    if (!available) {return;}
    if (!bundles) {ctx.skip(); return;}
    await expect(client.software.getSoftwareBundle(NONEXISTENT_GUID)).rejects.toThrow();
  });
});
