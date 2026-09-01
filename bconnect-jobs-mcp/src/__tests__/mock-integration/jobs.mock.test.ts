/**
 * Jobs — mock integration tests.
 * See docs/MOCK_INTEGRATION_TESTING.md.
 *
 * LOCAL FIX (QA-57 / X4). Every it() below used to open with
 * `if (!available) {return;}`, so a run with no mock reachable reported
 * "4 tests passed" having executed zero assertions. The availability probe
 * happens in beforeAll — after collection — so `it.skipIf(!available)` would
 * read the still-false initial value and skip unconditionally. The runtime
 * `ctx.skip(condition, note)` form is the one that reports honestly: skipped
 * runs show as skipped, executed runs really ran.
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

const MOCK_UNREACHABLE = `bConnectMock not reachable at ${MOCK_BASE_URL}`;

beforeAll(async () => {
  available = await checkMockAvailable();
  if (!available) {
    console.warn(`⚠  bConnectMock not reachable at ${MOCK_BASE_URL} — jobs mock tests skipped`);
    return;
  }
  client = createClient();
});

describe('Jobs — list JobDefinitions', () => {
  it('returns paged data with totalItems', async (ctx) => {
    ctx.skip(!available, MOCK_UNREACHABLE);
    const result = await client.jobs.getJobDefinitions({ PageSize: 10 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
    expect(result.data!.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Jobs — get JobDefinition by id', () => {
  it('returns the same definition surfaced by the list', async (ctx) => {
    ctx.skip(!available, MOCK_UNREACHABLE);
    const list = await client.jobs.getJobDefinitions({ PageSize: 1 } as never);
    const id = list.data?.[0]?.id;
    if (!id) {throw new Error('mock returned empty JobDefinitions list');}
    const item = await client.jobs.getJobDefinition(id);
    expect(item.id).toBe(id);
  });
});

describe('Jobs — list JobInstances', () => {
  it('returns paged data', async (ctx) => {
    ctx.skip(!available, MOCK_UNREACHABLE);
    const result = await client.jobs.getJobInstances({ PageSize: 5 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
  });
});

describe('Jobs — unknown JobDefinition id', () => {
  it('rejects on get with nonexistent GUID', async (ctx) => {
    ctx.skip(!available, MOCK_UNREACHABLE);
    await expect(client.jobs.getJobDefinition(NONEXISTENT_GUID)).rejects.toThrow();
  });
});
