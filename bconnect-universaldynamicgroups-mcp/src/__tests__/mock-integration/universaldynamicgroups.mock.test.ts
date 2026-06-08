/**
 * UniversalDynamicGroups — mock integration tests.
 * See docs/MOCK_INTEGRATION_TESTING.md.
 */

import { describe, it, beforeAll, expect } from 'vitest';
import { BConnectClient } from '../../bconnect-client.js';
import {
  checkMockAvailable,
  createClient,
  MOCK_BASE_URL,
  NONEXISTENT_GUID,
} from './helpers.js';

let available = false;
let client: BConnectClient;

beforeAll(async () => {
  available = await checkMockAvailable();
  if (!available) {
    console.warn(`⚠  bConnectMock not reachable at ${MOCK_BASE_URL} — universaldynamicgroups mock tests skipped`);
    return;
  }
  client = createClient();
});

describe('UniversalDynamicGroups — list UDGs', () => {
  it('returns paged data with totalItems', async () => {
    if (!available) return;
    const result = await client.udg.getUniversalDynamicGroups({ PageSize: 10 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
    expect(result.data!.length).toBeGreaterThanOrEqual(1);
  });
});

describe('UniversalDynamicGroups — get UDG by id', () => {
  it('returns the same UDG surfaced by the list', async () => {
    if (!available) return;
    const list = await client.udg.getUniversalDynamicGroups({ PageSize: 1 } as never);
    const id = list.data?.[0]?.id;
    if (!id) throw new Error('mock returned empty UDGs list');
    const item = await client.udg.getUniversalDynamicGroup(id);
    expect(item.id).toBe(id);
  });
});

describe('UniversalDynamicGroups — list folders', () => {
  it('returns paged data', async () => {
    if (!available) return;
    const result = await client.udg.getFolders({ PageSize: 5 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
  });
});

describe('UniversalDynamicGroups — unknown id', () => {
  it('rejects on get with nonexistent GUID', async () => {
    if (!available) return;
    await expect(client.udg.getUniversalDynamicGroup(NONEXISTENT_GUID)).rejects.toThrow();
  });
});
