/**
 * Groups — mock integration tests.
 * See docs/MOCK_INTEGRATION_TESTING.md.
 *
 * The groups module is all "<resource>-by-<group-context>" — it has no
 * standalone list of groups itself. Tests fetch a known group id via
 * raw HTTP first, then exercise the by-group accessors.
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
  it('returns paged data', async () => {
    if (!available || !logicalGroupId) return;
    const result = await client.groups.getEndpointsByLogicalGroup(logicalGroupId, { PageSize: 10 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
  });
});

describe('Groups — list WindowsEndpoints by LogicalGroup', () => {
  it('returns paged data', async () => {
    if (!available || !logicalGroupId) return;
    const result = await client.groups.getWindowsEndpointsByLogicalGroup(logicalGroupId, { PageSize: 5 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
  });
});

describe('Groups — list Endpoints by StaticGroup (when available)', () => {
  it('returns paged data', async () => {
    if (!available || !staticGroupId) return;
    const result = await client.groups.getEndpointsByStaticGroup(staticGroupId, { PageSize: 5 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
  });
});

describe('Groups — unknown LogicalGroup id', () => {
  it('rejects with HTTP error for nonexistent GUID', async () => {
    if (!available) return;
    await expect(
      client.groups.getEndpointsByLogicalGroup('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow();
  });
});
