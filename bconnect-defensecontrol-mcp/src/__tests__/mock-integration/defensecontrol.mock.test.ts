/**
 * DefenseControl — mock integration tests.
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
    console.warn(`⚠  bConnectMock not reachable at ${MOCK_BASE_URL} — defensecontrol mock tests skipped`);
    return;
  }
  client = createClient();
});

describe('DefenseControl — list BitLocker WindowsEndpoints', () => {
  it('returns paged data with totalItems', async () => {
    if (!available) return;
    const result = await client.defenseControl.getBitLockerWindowsEndpoints({ PageSize: 10 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
    expect(result.data!.length).toBeGreaterThanOrEqual(1);
  });
});

describe('DefenseControl — get BitLocker endpoint by id', () => {
  it('returns the same endpoint surfaced by the list', async () => {
    if (!available) return;
    const list = await client.defenseControl.getBitLockerWindowsEndpoints({ PageSize: 1 } as never);
    const id = list.data?.[0]?.id;
    if (!id) throw new Error('mock returned empty BitLocker list');
    const item = await client.defenseControl.getBitLockerWindowsEndpoint(id);
    expect(item.id).toBe(id);
  });
});

describe('DefenseControl — list Microsoft Defender threats', () => {
  it('returns paged data', async () => {
    if (!available) return;
    const result = await client.defenseControl.getMicrosoftDefenderThreats({ PageSize: 5 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
  });
});

describe('DefenseControl — unknown BitLocker id', () => {
  it('rejects on get with nonexistent GUID', async () => {
    if (!available) return;
    await expect(client.defenseControl.getBitLockerWindowsEndpoint(NONEXISTENT_GUID)).rejects.toThrow();
  });
});
