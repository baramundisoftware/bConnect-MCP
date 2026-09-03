/**
 * Groups — mock integration tests.
 * See docs/MOCK_INTEGRATION_TESTING.md.
 *
 * The groups module is all "<resource>-by-<group-context>" — it has no
 * standalone list of groups itself. Tests fetch a known group id via
 * raw HTTP first, then exercise the by-group accessors.
 *
 * LOCAL FIX (QA-57 / X4). Every it() below used to open with
 * `if (!available || !logicalGroupId) {return;}`, so a run with no mock
 * reachable reported "4 tests passed" having executed zero assertions. Both
 * conditions are only known after beforeAll — i.e. after collection — so
 * `it.skipIf(...)` would read the still-false initial values and skip
 * unconditionally. The runtime `ctx.skip(condition, note)` form is the one
 * that reports honestly, and it names WHICH precondition was missing.
 */

import { describe, it, beforeAll, expect } from 'vitest';
import { BConnectClient } from '../../bconnect-client.js';
import {
  checkMockAvailable,
  createClient,
  MOCK_BASE_URL,
  rawGet,
} from './helpers.js';

let available = false;
let client: BConnectClient;
let logicalGroupId: string | undefined;
let staticGroupId: string | undefined;

const MOCK_UNREACHABLE = `bConnectMock not reachable at ${MOCK_BASE_URL}`;

beforeAll(async () => {
  available = await checkMockAvailable();
  if (!available) {
    console.warn(`⚠  bConnectMock not reachable at ${MOCK_BASE_URL} — groups mock tests skipped`);
    return;
  }
  client = createClient();
  const lg = await rawGet('/v2.0/LogicalGroups', { PageSize: 1 });
  logicalGroupId = lg.body?.data?.[0]?.id;
  const sg = await rawGet('/v2.0/StaticGroups', { PageSize: 1 });
  staticGroupId = sg.body?.data?.[0]?.id;
});

describe('Groups — list Endpoints by LogicalGroup', () => {
  it('returns paged data', async (ctx) => {
    ctx.skip(!available, MOCK_UNREACHABLE);
    ctx.skip(!logicalGroupId, 'mock exposes no LogicalGroups');
    const result = await client.groups.getEndpointsByLogicalGroup(logicalGroupId!, { PageSize: 10 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
  });
});

describe('Groups — list WindowsEndpoints by LogicalGroup', () => {
  it('returns paged data', async (ctx) => {
    ctx.skip(!available, MOCK_UNREACHABLE);
    ctx.skip(!logicalGroupId, 'mock exposes no LogicalGroups');
    const result = await client.groups.getWindowsEndpointsByLogicalGroup(logicalGroupId!, { PageSize: 5 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
  });
});

describe('Groups — list Endpoints by StaticGroup (when available)', () => {
  it('returns paged data', async (ctx) => {
    ctx.skip(!available, MOCK_UNREACHABLE);
    ctx.skip(!staticGroupId, 'mock exposes no StaticGroups');
    const result = await client.groups.getEndpointsByStaticGroup(staticGroupId!, { PageSize: 5 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
  });
});

describe('Groups — unknown LogicalGroup id', () => {
  it('rejects with HTTP error for nonexistent GUID', async (ctx) => {
    ctx.skip(!available, MOCK_UNREACHABLE);
    await expect(
      client.groups.getEndpointsByLogicalGroup('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow();
  });
});
