/**
 * OperatingSystems — mock integration tests.
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
    console.warn(`⚠  bConnectMock not reachable at ${MOCK_BASE_URL} — operatingsystems mock tests skipped`);
    return;
  }
  client = createClient();
});

describe('OperatingSystems — list Folders', () => {
  it('returns paged data with totalItems', async () => {
    if (!available) return;
    const result = await client.operatingSystems.getFolders({ PageSize: 10 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
    expect(result.data!.length).toBeGreaterThanOrEqual(1);
  });
});

describe('OperatingSystems — get Folder by id', () => {
  it('returns the same folder surfaced by the list', async () => {
    if (!available) return;
    const list = await client.operatingSystems.getFolders({ PageSize: 1 } as never);
    const id = list.data?.[0]?.id;
    if (!id) throw new Error('mock returned empty Folders list');
    const item = await client.operatingSystems.getFolder(id);
    expect(item.id).toBe(id);
  });
});

describe('OperatingSystems — list WindowsEndpoints', () => {
  it('returns paged data', async () => {
    if (!available) return;
    const result = await client.operatingSystems.getWindowsEndpoints({ PageSize: 5 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
  });
});

describe('OperatingSystems — unknown Folder id', () => {
  it('rejects on get with nonexistent GUID', async () => {
    if (!available) return;
    await expect(client.operatingSystems.getFolder(NONEXISTENT_GUID)).rejects.toThrow();
  });
});
