/**
 * UpdateManagement — mock integration tests.
 *
 * Exercises the BConnectClient (production HTTP path) against bConnect-Mock.
 * Without the mock the tests are reported skipped (see __tests__/lib/mock-integration.ts).
 *
 *   docker ps --filter name=bconnect-mock         # ensure mock is up
 *   npm run test:mock                              # run from this server dir
 */

import { describe, it, beforeAll, expect } from 'vitest';
import { BConnectClient } from '../../bconnect-client.js';
import {
  MOCK_BASE_URL,
  mockAvailable,
  mockClientConfig,
  NONEXISTENT_GUID,
} from '../../../../__tests__/lib/mock-integration.js';

let available = false;
let client: BConnectClient;

beforeAll(async () => {
  available = await mockAvailable('updatemanagement');
  if (!available) {return;}
  client = new BConnectClient(mockClientConfig());
});

describe('UpdateManagement — list windows endpoints', () => {
  it('returns a paged list with totalItems and at least one entry', async (ctx) => {
    if (!available) {ctx.skip();}
    const result = await client.updateManagement.getWindowsEndpoints({ PageSize: 10 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
    expect(result.data!.length).toBeGreaterThanOrEqual(1);
    const first = result.data![0]!;
    expect(first).toHaveProperty('endpointId');
    expect(first).toHaveProperty('endpointName');
  });
});

describe('UpdateManagement — get windows endpoint by id', () => {
  it('returns the same endpoint that the list call surfaced', async (ctx) => {
    if (!available) {ctx.skip();}
    const list = await client.updateManagement.getWindowsEndpoints({ PageSize: 1 } as never);
    const id = list.data?.[0]?.endpointId;
    if (!id) {throw new Error('mock returned empty list — fixture unexpected');}
    const item = await client.updateManagement.getWindowsEndpoint(id);
    expect(item.endpointId).toBe(id);
    expect(item).toHaveProperty('endpointName');
  });
});

describe('UpdateManagement — unknown id', () => {
  it('rejects with an HTTP error for a nonexistent GUID', async (ctx) => {
    if (!available) {ctx.skip();}
    await expect(client.updateManagement.getWindowsEndpoint(NONEXISTENT_GUID)).rejects.toThrow();
  });
});
