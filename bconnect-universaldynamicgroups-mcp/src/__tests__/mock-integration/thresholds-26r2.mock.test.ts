/**
 * Threshold tools against bConnect-Mock, bMS 26R2 (#354, #355; follow-up to #407).
 *
 * Calls the tools through the MCP server, as a client would, so the gates, the request bodies,
 * the JSON Patch and the answers are those of the real server code. The mock (read-write profile)
 * keeps state: a threshold created here is read, changed and deleted again, then the mock is reset.
 * Skipped unless the mock serves 26r2 in that profile (the tier counts the skips on 26r1).
 * See docs/MOCK_INTEGRATION_TESTING.md.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../../index.js';
import {
  connectMockServer, mockAvailable, mockServes, rawGet, reset, resultJson, NONEXISTENT_GUID, type MockServer,
} from '../../../../__tests__/lib/mock-integration.js';

let available = false;
let mcp: MockServer;
/** A group and a security profile without a threshold between them: the mock allows one per pair. */
let free: { dynamicGroupId: string; securityProfileId: string } | undefined;

interface Paged { data?: Array<Record<string, string>> }
const ids = (body: unknown): string[] => (((body as Paged)?.data ?? (body as Array<Record<string, string>>)) ?? []).map((x) => x.id);

beforeAll(async () => {
  available = await mockAvailable('universaldynamicgroups');
  if (!available) {return;}
  // The 26R2 tools: only a 26r2 mock in the read-write profile has them (other releases skip).
  available = await mockServes('26r2');
  if (available) {
    await reset();
    mcp = await connectMockServer(createServer, '26r2');
    process.env.ALLOW_WRITE_OPERATIONS = 'true';
    const groups = ids((await rawGet('/universaldynamicgroups/v2.0/UniversalDynamicGroups', { PageSize: 100 })).body);
    const profiles = ids((await rawGet('/servermanagement/v2.0/SecurityProfiles')).body);
    const taken = ((await rawGet('/universaldynamicgroups/v2.0/Thresholds', { PageSize: 1000 })).body as { data: Array<Record<string, string>> }).data
      .map((t) => `${t.dynamicGroupId}/${t.securityProfileId}`);
    for (const dynamicGroupId of groups) {
      const securityProfileId = profiles.find((p) => !taken.includes(`${dynamicGroupId}/${p}`));
      if (securityProfileId) {free = { dynamicGroupId, securityProfileId }; break;}
    }
  }
});
afterAll(async () => {
  if (available) {
    await mcp.close();
    await reset();
  }
});

describe('thresholds on the 26R2 mock: read', () => {
  it('list_thresholds lists all, and one group\'s with dynamicGroupId', async (ctx) => {
    if (!available) {ctx.skip();}
    const all = resultJson((await mcp.call('list_thresholds', { PageSize: 100 })).text) as { data: Array<{ id: string; dynamicGroupId: string }>; totalItems: number };
    expect(all.data.length).toBeGreaterThanOrEqual(1);
    const group = all.data[0].dynamicGroupId;
    const one = resultJson((await mcp.call('list_thresholds', { dynamicGroupId: group })).text) as { data: Array<{ dynamicGroupId: string }> };
    expect(one.data.length).toBeGreaterThanOrEqual(1);
    expect(one.data.every((t) => t.dynamicGroupId === group)).toBe(true);
    const count = await mcp.call('list_thresholds', { countOnly: true });
    expect(count.isError).toBe(false);
    expect(count.text).toContain(String(all.totalItems));
  });

  it('get_threshold reads one; an unknown ID is an error result naming 404', async (ctx) => {
    if (!available) {ctx.skip();}
    const all = resultJson((await mcp.call('list_thresholds', {})).text) as { data: Array<{ id: string }> };
    const got = resultJson((await mcp.call('get_threshold', { id: all.data[0].id })).text) as { id: string };
    expect(got.id).toBe(all.data[0].id);
    const missing = await mcp.call('get_threshold', { id: NONEXISTENT_GUID });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/404/);
  });
});

describe('thresholds on the 26R2 mock: create → update → delete', () => {
  it('creates, reads back, changes only the given fields, deletes', async (ctx) => {
    if (!available) {ctx.skip();}
    if (!free) {throw new Error('the mock fixtures have no group/security-profile pair without a threshold');}
    const created = await mcp.call('create_threshold', { ...free, value: 5, type: 'UpperLimit', severity: 'Warning', isActive: true, comment: 'mock-tier' });
    expect(created.isError, created.text).toBe(false);
    const { id } = resultJson(created.text) as { id: string };
    expect(resultJson((await mcp.call('get_threshold', { id })).text)).toMatchObject({ ...free, value: 5, type: 'UpperLimit', severity: 'Warning', comment: 'mock-tier' });

    const updated = await mcp.call('update_threshold', { id, value: 9, severity: 'Error' });
    expect(updated.isError, updated.text).toBe(false);
    expect(resultJson((await mcp.call('get_threshold', { id })).text)).toMatchObject({ value: 9, severity: 'Error', type: 'UpperLimit', comment: 'mock-tier' });

    const deleted = await mcp.call('delete_threshold', { id });
    expect(deleted.text).toBe(`Threshold ${id} deleted.`);
    expect((await mcp.call('get_threshold', { id })).isError).toBe(true);
  });

  it('a second threshold for the same group and profile is an error result naming the conflict', async (ctx) => {
    if (!available) {ctx.skip();}
    if (!free) {throw new Error('the mock fixtures have no group/security-profile pair without a threshold');}
    const first = resultJson((await mcp.call('create_threshold', { ...free, value: 1 })).text) as { id: string };
    const second = await mcp.call('create_threshold', { ...free, value: 2 });
    expect(second.isError).toBe(true);
    expect(second.text).toMatch(/409|already exists/i);
    await mcp.call('delete_threshold', { id: first.id });
  });

  it('with writes off nothing is created', async (ctx) => {
    if (!available) {ctx.skip();}
    process.env.ALLOW_WRITE_OPERATIONS = 'false';
    try {
      const before = (resultJson((await mcp.call('list_thresholds', {})).text) as { totalItems: number }).totalItems;
      const r = await mcp.call('create_threshold', { ...free!, value: 3 });
      expect(r.text).toContain("Write operation 'create_threshold' is disabled");
      expect((resultJson((await mcp.call('list_thresholds', {})).text) as { totalItems: number }).totalItems).toBe(before);
    } finally {
      process.env.ALLOW_WRITE_OPERATIONS = 'true';
    }
  });
});
