/**
 * Variables — mock integration tests.
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
    console.warn(`⚠  bConnectMock not reachable at ${MOCK_BASE_URL} — variables mock tests skipped`);
    return;
  }
  client = createClient();
});

describe('Variables — list VariableDefinitions', () => {
  it('returns paged data with totalItems', async (ctx) => {
    if (!available) {ctx.skip();}
    const result = await client.variables.getVariableDefinitions({ PageSize: 10 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
    expect(result.data!.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Variables — get VariableDefinition by id', () => {
  it('returns the same definition surfaced by the list', async (ctx) => {
    if (!available) {ctx.skip();}
    const list = await client.variables.getVariableDefinitions({ PageSize: 1 } as never);
    const id = list.data?.[0]?.id;
    if (!id) {throw new Error('mock returned empty VariableDefinitions list');}
    const item = await client.variables.getVariableDefinition(id);
    expect(item.id).toBe(id);
  });
});

describe('Variables — list VariableInstances', () => {
  it('returns paged data', async (ctx) => {
    if (!available) {ctx.skip();}
    const result = await client.variables.getVariableInstances({ PageSize: 5 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
  });
});

describe('Variables — unknown VariableDefinition id', () => {
  it('rejects on get with nonexistent GUID', async (ctx) => {
    if (!available) {ctx.skip();}
    await expect(client.variables.getVariableDefinition(NONEXISTENT_GUID)).rejects.toThrow();
  });
});
