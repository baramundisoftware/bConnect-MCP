/**
 * ServerManagement — mock integration tests.
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
    console.warn(`⚠  bConnectMock not reachable at ${MOCK_BASE_URL} — servermanagement mock tests skipped`);
    return;
  }
  client = createClient();
});

describe('ServerManagement — list SecurityGroups', () => {
  it('returns paged data with totalItems', async (ctx) => {
    if (!available) {ctx.skip();}
    const result = await client.serverManagement.getSecurityGroups({ PageSize: 10 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
    expect(result.data!.length).toBeGreaterThanOrEqual(1);
  });
});

describe('ServerManagement — get SecurityGroup by id', () => {
  it('returns the same group surfaced by the list', async (ctx) => {
    if (!available) {ctx.skip();}
    const list = await client.serverManagement.getSecurityGroups({ PageSize: 1 } as never);
    const id = list.data?.[0]?.id;
    if (!id) {throw new Error('mock returned empty SecurityGroups list');}
    const item = await client.serverManagement.getSecurityGroup(id);
    expect(item.id).toBe(id);
  });
});

describe('ServerManagement — get ManagementServer (singleton)', () => {
  it('returns the management-server payload', async (ctx) => {
    if (!available) {ctx.skip();}
    const ms = await client.serverManagement.getManagementServer();
    expect(ms).toBeDefined();
  });
});

describe('ServerManagement — unknown SecurityGroup id', () => {
  it('rejects on get with nonexistent GUID', async (ctx) => {
    if (!available) {ctx.skip();}
    await expect(client.serverManagement.getSecurityGroup(NONEXISTENT_GUID)).rejects.toThrow();
  });
});
