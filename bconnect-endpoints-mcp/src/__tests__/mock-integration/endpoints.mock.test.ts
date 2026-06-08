/**
 * Endpoints — mock integration tests.
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
    console.warn(`⚠  bConnectMock not reachable at ${MOCK_BASE_URL} — endpoints mock tests skipped`);
    return;
  }
  client = createClient();
});

describe('Endpoints — list Endpoints', () => {
  it('returns paged data with totalItems', async () => {
    if (!available) return;
    const result = await client.endpoints.getEndpoints({ PageSize: 10 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
    expect(result.data!.length).toBeGreaterThanOrEqual(1);
    expect(result.data![0]).toHaveProperty('id');
    expect(result.data![0]).toHaveProperty('endpointType');
  });
});

describe('Endpoints — get Endpoint by id', () => {
  it('returns the same endpoint surfaced by the list', async () => {
    if (!available) return;
    const list = await client.endpoints.getEndpoints({ PageSize: 1 } as never);
    const id = list.data?.[0]?.id;
    if (!id) throw new Error('mock returned empty Endpoints list');
    const item = await client.endpoints.getEndpoint(id);
    expect(item.id).toBe(id);
  });
});

describe('Endpoints — list WindowsEndpoints', () => {
  it('returns paged data', async () => {
    if (!available) return;
    const result = await client.endpoints.getWindowsEndpoints({ PageSize: 5 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
  });
});

describe('Endpoints — unknown id', () => {
  it('rejects on get with nonexistent GUID', async () => {
    if (!available) return;
    await expect(client.endpoints.getEndpoint(NONEXISTENT_GUID)).rejects.toThrow();
  });
});
