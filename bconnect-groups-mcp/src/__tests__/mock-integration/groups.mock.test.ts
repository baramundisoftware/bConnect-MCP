/**
 * Groups — mock integration tests.
 * See docs/MOCK_INTEGRATION_TESTING.md.
 *
 * The groups module is all "<resource>-by-<group-context>" — it has no
 * standalone list of groups itself. Tests fetch a known group id via
 * raw HTTP first, then exercise the by-group accessors.
 */

import { describe, it, beforeAll, expect } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { BConnectClient } from '../../bconnect-client.js';
import { createServer } from '../../index.js';
import { TOOL_VARIANTS } from '../../tool-variants.js';
import { TOOL_RELEASES } from '../../tool-releases.js';
import {
  checkMockAvailable,
  createClient,
  getMockHealth,
  MOCK_BASE_URL,
  rawGet,
} from './helpers.js';

/** Calls a tool of this server against the mock: text and isError of the result. */
async function callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const { server } = createServer({
    baseUrl: process.env.BCONNECT_BASE_URL || MOCK_BASE_URL,
    username: process.env.BCONNECT_USERNAME || 'integration-test',
    password: process.env.BCONNECT_PASSWORD || 'integration-test',
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: 'mock-test', version: '1.0.0' }, { capabilities: {} });
  await mcp.connect(clientTransport);
  const result = await mcp.callTool({ name, arguments: args });
  await mcp.close();
  const content = Array.isArray(result.content) ? result.content : [];
  return { text: content.map((c) => (typeof c.text === 'string' ? c.text : '')).join('\n'), isError: result.isError === true };
}

let available = false;
let client: BConnectClient;
let logicalGroupId: string;

/**
 * A static group in the mock's fixtures (fixtures/standard-readonly/staticGroups.json in
 * bConnect-Mock). The specification has no route that lists static groups, only
 * StaticGroups/{id}/… sub-resources, so the id can't come from a list call.
 */
const STATIC_GROUP_ID = 'e1000001-0001-0001-0001-000000000001';
/** A dynamic group in the mock's fixtures (fixtures/standard-readonly/dynamicGroups.json); no route lists them either. */
const DYNAMIC_GROUP_ID = 'e2000001-0001-0001-0001-000000000001';

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

describe('Groups — every route of the merged tools (REQ-SRV-029, #174)', () => {
  /** The release the mock serves, so the server lists and checks the same one. */
  async function useMockRelease(): Promise<'25R2' | '26R1'> {
    const version = (await getMockHealth())?.bmsVersion?.toLowerCase();
    const release = version === '25r2' ? '25R2' : '26R1';
    process.env.BCONNECT_RELEASE = release;
    return release;
  }
  const routes = (tool: string, release: string): Array<Record<string, string>> => Object.entries(TOOL_VARIANTS[tool])
    .filter(([key]) => (TOOL_RELEASES[key] ?? []).some((r) => r === release))
    .map(([, select]) => Object.fromEntries(Object.entries(select).filter((e): e is [string, string] => e[1] !== null)));
  const firstId = async (path: string): Promise<string | undefined> => {
    const r = await rawGet(path, { PageSize: 1 });
    const data = r.body !== null && typeof r.body === 'object' && 'data' in r.body && Array.isArray(r.body.data) ? r.body.data : [];
    const id: unknown = data[0]?.id;
    return typeof id === 'string' ? id : undefined;
  };

  it('list_group_members answers for every group kind and member type of the release', async () => {
    if (!available) {return;}
    const release = await useMockRelease();
    // The mock has universal dynamic groups in its 26R1 data only.
    const udg = release === '26R1' ? await firstId('/universaldynamicgroups/v2.0/UniversalDynamicGroups') : undefined;
    const ids: Record<string, string | undefined> = { LogicalGroup: logicalGroupId, StaticGroup: STATIC_GROUP_ID, DynamicGroup: DYNAMIC_GROUP_ID, UniversalDynamicGroup: udg };
    const all = routes('list_group_members', release);
    expect(all.length).toBe(release === '25R2' ? 27 : 24);
    let called = 0;
    for (const select of all) {
      const groupId = ids[select.groupKind];
      if (!groupId) {continue;}
      const r = await callTool('list_group_members', { ...select, groupId, PageSize: 1 });
      expect(r.isError, `${JSON.stringify(select)}: ${r.text}`).toBe(false);
      called++;
    }
    expect(called).toBe(release === '25R2' ? 19 : 24);
  });

  it('list_ad_user_endpoints answers with and without endpointType', async () => {
    if (!available) {return;}
    const release = await useMockRelease();
    const adUserId = await firstId('/activedirectory/v2.0/ADUsers');
    expect(adUserId).toBeTruthy();
    const all = routes('list_ad_user_endpoints', release);
    expect(all.length).toBe(6);
    for (const select of all) {
      const r = await callTool('list_ad_user_endpoints', { ...select, adUserId, PageSize: 1 });
      expect(r.isError, `${JSON.stringify(select)}: ${r.text}`).toBe(false);
    }
  });

  it('countOnly counts a logical group with its sub-groups', async () => {
    if (!available) {return;}
    await useMockRelease();
    const normal = await callTool('list_group_members', { groupKind: 'LogicalGroup', groupId: logicalGroupId, includeSubfolders: true });
    const count = await callTool('list_group_members', { groupKind: 'LogicalGroup', groupId: logicalGroupId, includeSubfolders: true, countOnly: true });
    expect(normal.isError, normal.text).toBe(false);
    expect(count.isError, count.text).toBe(false);
    const { totalItems }: { totalItems?: unknown } = JSON.parse(normal.text);
    expect(typeof totalItems).toBe('number');
    expect(JSON.parse(count.text)).toMatchObject({ totalItems });
  });

  it('a removed per-kind name answers with its replacement', async () => {
    if (!available) {return;}
    await useMockRelease();
    await expect(callTool('list_mac_endpoints_by_static_group', {})).rejects.toThrow(/replaced by list_group_members: call list_group_members with groupKind "StaticGroup" and with memberType "MacEndpoint", with groupId \(was staticGroupId\)/);
  });
});
