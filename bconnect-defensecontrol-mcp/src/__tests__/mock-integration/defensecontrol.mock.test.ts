/**
 * DefenseControl — mock integration tests.
 * See docs/MOCK_INTEGRATION_TESTING.md.
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
  available = await mockAvailable('defensecontrol');
  if (!available) {return;}
  client = new BConnectClient(mockClientConfig());
});

describe('DefenseControl — list BitLocker WindowsEndpoints', () => {
  it('returns paged data with totalItems', async (ctx) => {
    if (!available) {ctx.skip();}
    const result = await client.defenseControl.getBitLockerWindowsEndpoints({ PageSize: 10 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
    expect(result.data!.length).toBeGreaterThanOrEqual(1);
  });
});

describe('DefenseControl — get BitLocker endpoint by id', () => {
  it('returns the same endpoint surfaced by the list', async (ctx) => {
    if (!available) {ctx.skip();}
    const list = await client.defenseControl.getBitLockerWindowsEndpoints({ PageSize: 1 } as never);
    // BitLockerWindowsEndpoint has no id field in the spec (or on a live bMS), only endpointId
    const id = list.data?.[0]?.endpointId;
    if (!id) {throw new Error('mock returned empty BitLocker list');}
    const item = await client.defenseControl.getBitLockerWindowsEndpoint(id);
    expect(item.endpointId).toBe(id);
  });
});

describe('DefenseControl — list Microsoft Defender threats', () => {
  it('returns paged data', async (ctx) => {
    if (!available) {ctx.skip();}
    const result = await client.defenseControl.getMicrosoftDefenderThreats({ PageSize: 5 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
  });
});

describe('DefenseControl — unknown BitLocker id', () => {
  it('rejects on get with nonexistent GUID', async (ctx) => {
    if (!available) {ctx.skip();}
    await expect(client.defenseControl.getBitLockerWindowsEndpoint(NONEXISTENT_GUID)).rejects.toThrow();
  });
});
