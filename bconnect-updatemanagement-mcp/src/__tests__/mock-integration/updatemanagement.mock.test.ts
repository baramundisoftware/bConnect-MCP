/**
 * UpdateManagement — mock integration tests.
 *
 * Exercises the BConnectClient (production HTTP path) against bConnect-Mock.
 * Tests skip gracefully when the mock is unreachable.
 *
 *   docker ps --filter name=bconnect-mock         # ensure mock is up
 *   npm run test:mock                              # run from this server dir
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
    console.warn(`⚠  bConnectMock not reachable at ${MOCK_BASE_URL} — updatemanagement mock tests skipped`);
    return;
  }
  client = createClient();
});

describe('UpdateManagement — list windows endpoints', () => {
  it('returns a paged list with totalItems and at least one entry', async () => {
    if (!available) {return;}
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
  it('returns the same endpoint that the list call surfaced', async () => {
    if (!available) {return;}
    const list = await client.updateManagement.getWindowsEndpoints({ PageSize: 1 } as never);
    const id = list.data?.[0]?.endpointId;
    if (!id) {throw new Error('mock returned empty list — fixture unexpected');}
    const item = await client.updateManagement.getWindowsEndpoint(id);
    expect(item.endpointId).toBe(id);
    expect(item).toHaveProperty('endpointName');
  });
});

describe('UpdateManagement — unknown id', () => {
  it('rejects with an HTTP error for a nonexistent GUID', async () => {
    if (!available) {return;}
    await expect(client.updateManagement.getWindowsEndpoint(NONEXISTENT_GUID)).rejects.toThrow();
  });
});
