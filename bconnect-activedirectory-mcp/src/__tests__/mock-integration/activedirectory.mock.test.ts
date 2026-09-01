/**
 * ActiveDirectory — mock integration tests.
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
    console.warn(`⚠  bConnectMock not reachable at ${MOCK_BASE_URL} — activedirectory mock tests skipped`);
    return;
  }
  client = createClient();
});

describe('ActiveDirectory — list ADGroups', () => {
  it('returns paged data with totalItems', async (ctx) => {
    if (!available) {ctx.skip();}
    const result = await client.activeDirectory.getADGroups({ PageSize: 10 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
    expect(result.data!.length).toBeGreaterThanOrEqual(1);
    expect(result.data![0]).toHaveProperty('id');
    expect(result.data![0]).toHaveProperty('name');
  });
});

describe('ActiveDirectory — get ADGroup by id', () => {
  it('returns the same group surfaced by the list', async (ctx) => {
    if (!available) {ctx.skip();}
    const list = await client.activeDirectory.getADGroups({ PageSize: 1 } as never);
    const id = list.data?.[0]?.id;
    if (!id) {throw new Error('mock returned empty ADGroups list');}
    const item = await client.activeDirectory.getADGroup(id);
    expect(item.id).toBe(id);
  });
});

describe('ActiveDirectory — list ADUsers', () => {
  it('returns paged data', async (ctx) => {
    if (!available) {ctx.skip();}
    const result = await client.activeDirectory.getADUsers({ PageSize: 5 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
  });
});

describe('ActiveDirectory — unknown id', () => {
  it('rejects on get with nonexistent GUID', async (ctx) => {
    if (!available) {ctx.skip();}
    await expect(client.activeDirectory.getADGroup(NONEXISTENT_GUID)).rejects.toThrow();
  });
});
