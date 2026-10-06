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
let logicalGroupId: string;

/**
 * A static group in the mock's fixtures (fixtures/standard-readonly/staticGroups.json in
 * bConnect-Mock). The specification has no route that lists static groups, only
 * StaticGroups/{id}/… sub-resources, so the id can't come from a list call.
 */
const STATIC_GROUP_ID = 'e1000001-0001-0001-0001-000000000001';

beforeAll(async () => {
  available = await checkMockAvailable();
  if (!available) {
    console.warn(`⚠  bConnectMock not reachable at ${MOCK_BASE_URL} — groups mock tests skipped`);
    return;
  }
  client = createClient();
  // With the domain segment, as a real bMS requires: since bConnect-Mock 0.4.0 the mock
  // answers /v2.0/LogicalGroups with 404. Fail here rather than let every test return early.
  const lg = await rawGet('/endpoints/v2.0/LogicalGroups', { PageSize: 1 });
  expect(lg.status, 'GET /endpoints/v2.0/LogicalGroups').toBe(200);
  const id = (lg.body as { data?: { id?: unknown }[] } | null)?.data?.[0]?.id;
  expect(typeof id, 'id of the first logical group').toBe('string');
  logicalGroupId = id as string;
});

describe('Groups — list Endpoints by LogicalGroup', () => {
  it('returns paged data', async () => {
    if (!available) {return;}
    const result = await client.groups.getEndpointsByLogicalGroup(logicalGroupId, { PageSize: 10 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
  });
});

describe('Groups — list WindowsEndpoints by LogicalGroup', () => {
  it('returns paged data', async () => {
    if (!available) {return;}
    const result = await client.groups.getWindowsEndpointsByLogicalGroup(logicalGroupId, { PageSize: 5 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
  });
});

describe('Groups — list Endpoints by StaticGroup', () => {
  it('returns paged data', async () => {
    if (!available) {return;}
    const result = await client.groups.getEndpointsByStaticGroup(STATIC_GROUP_ID, { PageSize: 5 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
  });
});

describe('Groups — unknown LogicalGroup id', () => {
  it('rejects with HTTP error for nonexistent GUID', async () => {
    if (!available) {return;}
    await expect(
      client.groups.getEndpointsByLogicalGroup('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow();
  });
});
