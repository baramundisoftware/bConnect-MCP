/**
 * Assets — mock integration tests.
 * See docs/MOCK_INTEGRATION_TESTING.md.
 */

import { describe, it, beforeAll, expect } from 'vitest';
import { BConnectClient } from '../../bconnect-client.js';
import {
  mockAvailable,
  mockClientConfig,
  NONEXISTENT_GUID,
} from '../../../../__tests__/lib/mock-integration.js';

let available = false;
let client: BConnectClient;

beforeAll(async () => {
  available = await mockAvailable('assets');
  if (!available) {return;}
  client = new BConnectClient(mockClientConfig());
});

describe('Assets — list Assets', () => {
  it('returns paged data with totalItems', async (ctx) => {
    if (!available) {ctx.skip();}
    const result = await client.assets.getAssets({ PageSize: 10 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
    expect(result.data!.length).toBeGreaterThanOrEqual(1);
    // The spec (and a live bMS) identifies an asset by assetId; Asset has no id field
    expect(result.data![0]).toHaveProperty('assetId');
  });
});

describe('Assets — get Asset by id', () => {
  it('returns the same asset surfaced by the list', async (ctx) => {
    if (!available) {ctx.skip();}
    const list = await client.assets.getAssets({ PageSize: 1 } as never);
    const id = list.data?.[0]?.assetId;
    if (!id) {throw new Error('mock returned empty Assets list');}
    const item = await client.assets.getAsset(id);
    expect(item.assetId).toBe(id);
  });
});

describe('Assets — list AssetStock folders', () => {
  it('returns paged data', async (ctx) => {
    if (!available) {ctx.skip();}
    const result = await client.assets.getAssetStockFolders({ PageSize: 5 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
  });
});

describe('Assets — unknown id', () => {
  it('rejects on get with nonexistent GUID', async (ctx) => {
    if (!available) {ctx.skip();}
    await expect(client.assets.getAsset(NONEXISTENT_GUID)).rejects.toThrow();
  });
});
