/**
 * Groups tools: one tool per operation, the group kind and member type as
 * arguments (REQ-SRV-029 part 2, #174, ADR-0015).
 *
 * AC 1: `fixtures/groups-tool-requests.json` holds the requests every groups
 * tool sent on `main` 2b9323b (both releases; required arguments, all
 * arguments, countOnly), recorded with the exerciser. Each replacement call
 * must send the same requests: method, path (with the domain segment), query
 * (as a set), content type and body. The mapping below is written from the
 * issue, not taken from the server's table, so the two check each other.
 * AC 2: every removed name answers with its replacement and arguments, in
 * both releases, with writes on and off, and is never listed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { callsOf, connect, createRecorder, guardEnv, ROOT, type ConnectedServer } from './lib/exerciser.js';
import type { Release } from './lib/spec.js';
import { routeTakes } from './lib/variants.js';

interface Recorded { method: string; path: string; query: Array<[string, string]>; contentType: string | null; body: string }
interface Entry { release: Release; tool: string; call: string; args: Record<string, unknown>; requests: Recorded[] }
const FIXTURE: Entry[] = JSON.parse(readFileSync(join(ROOT, '__tests__', 'fixtures', 'groups-tool-requests.json'), 'utf8'));

const TYPE: Record<string, string> = {
  windows: 'WindowsEndpoint', mac: 'MacEndpoint', linux: 'LinuxEndpoint', android: 'AndroidEndpoint',
  ios: 'IOSEndpoint', network: 'NetworkEndpoint', industrial: 'IndustrialEndpoint',
};
/** Old name suffix → group kind and the old id argument (now groupId). */
const KIND: Record<string, [string, string]> = {
  logical_group: ['LogicalGroup', 'logicalGroupId'],
  static_group: ['StaticGroup', 'staticGroupId'],
  dynamic_group: ['DynamicGroup', 'dynamicGroupId'],
  universal_dynamic_group: ['UniversalDynamicGroup', 'universalDynamicGroupId'],
};

interface Replacement { tool: string; select: Record<string, string>; rename: Record<string, string> }

/** The replacement of an old groups tool: new tool, selector arguments, renamed arguments. */
function replacement(old: string): Replacement {
  if (old === 'list_logical_groups_by_logical_group') {
    return { tool: 'list_group_members', select: { groupKind: 'LogicalGroup', memberType: 'LogicalGroup' }, rename: { logicalGroupId: 'groupId' } };
  }
  const [head, scope] = old.split('_endpoints_by_');
  const type = head === 'list' ? undefined : TYPE[head.slice('list_'.length)];
  if (scope === 'ad_user') return { tool: 'list_ad_user_endpoints', select: type ? { endpointType: type } : {}, rename: {} };
  const [kind, idArg] = KIND[scope];
  return { tool: 'list_group_members', select: { groupKind: kind, ...(type && { memberType: type }) }, rename: { [idArg]: 'groupId' } };
}

const REMOVED = [...new Set(FIXTURE.map((e) => e.tool))].sort();
const NEW_TOOLS = ['list_ad_user_endpoints', 'list_group_members'];
const G = '00000000-0000-4000-8000-000000000001';

const normalized = (r: Recorded) => ({ method: r.method, path: r.path, query: [...r.query].sort((a, b) => a.join('=').localeCompare(b.join('='))), contentType: r.contentType, body: r.body });

const recorder = createRecorder(() => ({ data: [], totalItems: 0 }));
const saved = { ...process.env };
const conns: Partial<Record<Release, ConnectedServer>> = {};
beforeAll(async () => {
  recorder.listen();
  for (const release of ['25R2', '26R1'] as const) {
    Object.assign(process.env, guardEnv(release, { writes: true, secretRead: true }));
    conns[release] = await connect('bconnect-groups-mcp');
  }
});
afterAll(async () => {
  await Promise.all(Object.values(conns).map((c) => c!.close()));
  recorder.close();
  process.env = saved;
});
const use = (release: Release, writes = true): ConnectedServer => {
  Object.assign(process.env, guardEnv(release, { writes, secretRead: true }));
  return conns[release]!;
};

describe('AC 1: every replaced tool\'s request is sent unchanged by its replacement', () => {
  it('the fixture covers every groups tool in both releases (not vacuous)', () => {
    expect(REMOVED.length).toBe(33);
    expect(new Set(FIXTURE.filter((e) => e.release === '25R2').map((e) => e.tool)).size).toBe(33);
    expect(new Set(FIXTURE.filter((e) => e.release === '26R1').map((e) => e.tool)).size).toBe(30);
    expect(FIXTURE.filter((e) => e.call === 'count').length).toBe(63);
    // 33 distinct routes: no two old tools map to the same call.
    expect(new Set(REMOVED.map((t) => JSON.stringify(replacement(t)))).size).toBe(33);
  });

  it.each(FIXTURE.map((e) => [e.release, e.tool, e.call, e] as const))('%s %s (%s arguments)', async (release, tool, _call, entry) => {
    const { tool: next, select, rename } = replacement(tool);
    const args = { ...Object.fromEntries(Object.entries(entry.args).map(([k, v]) => [rename[k] ?? k, v])), ...select };
    const conn = use(release);
    recorder.take();
    const result = await conn.call(next, args);
    expect(result.isError, result.text).toBe(false);
    expect(recorder.take().map(normalized)).toEqual(entry.requests.map(normalized));
  });

  it.each(['25R2', '26R1'] as const)('on %s, every other group kind × member type listed is refused as unsupported, naming the valid ones', async (release) => {
    const conn = use(release);
    const t = (await conn.list()).find((x) => x.name === 'list_group_members')!;
    const supported = new Set(FIXTURE.filter((e) => e.release === release).map((e) => replacement(e.tool))
      .filter((r) => r.tool === 'list_group_members').map((r) => `${r.select.groupKind}/${r.select.memberType ?? ''}`));
    let refused = 0;
    for (const groupKind of t.inputSchema.properties.groupKind.enum as string[]) {
      for (const memberType of [undefined, ...(t.inputSchema.properties.memberType.enum as string[])]) {
        if (supported.has(`${groupKind}/${memberType ?? ''}`)) continue;
        recorder.take();
        const r = await conn.call('list_group_members', { groupKind, groupId: G, ...(memberType && { memberType }) });
        expect(r.code, `${groupKind}/${memberType}`).toBe(-32602);
        expect(r.text).toContain(`list_group_members has no route for groupKind "${groupKind}" and memberType "${memberType}". Valid on bMS ${release}: groupKind "${groupKind}" without memberType`);
        expect(recorder.take()).toEqual([]);
        refused++;
      }
    }
    // DynamicGroup lacks 6 (25R2: 7) member types; StaticGroup and UniversalDynamicGroup lack LogicalGroup.
    expect(refused).toBe(release === '25R2' ? 9 : 8);
  });
});

describe('AC 2: a removed name answers with its replacement', () => {
  const cases = (['25R2', '26R1'] as const).flatMap((release) => [true, false].flatMap((writes) => REMOVED.map((tool) => [release, writes, tool] as const)));

  it.each(cases)('%s writes=%s %s', async (release, writes, tool) => {
    const conn = use(release, writes);
    const { tool: next, select, rename } = replacement(tool);
    recorder.take();
    const r = await conn.call(tool, { logicalGroupId: G });
    expect(r.code).toBe(-32601);
    const how = next === 'list_group_members'
      ? `with groupKind "${select.groupKind}" and ${select.memberType ? `with memberType "${select.memberType}"` : 'without memberType'}`
      : select.endpointType ? `with endpointType "${select.endpointType}"` : 'without endpointType';
    expect(r.text).toContain(`${tool} was replaced by ${next}: call ${next} ${how}`);
    for (const [from, to] of Object.entries(rename)) expect(r.text).toContain(`with ${to} (was ${from})`);
    if (release === '26R1' && select.memberType === 'IndustrialEndpoint') expect(r.text).toContain('That route is only available in bMS 25R2; this server uses 26R1');
    expect(recorder.take()).toEqual([]);
  });

  it.each(['25R2', '26R1'] as const)('only the two new tools are listed on %s (no aliases)', async (release) => {
    expect((await use(release).list()).map((t) => t.name).sort()).toEqual(NEW_TOOLS);
  });
});

describe('selector values follow the selected release (from the spec)', () => {
  const ENDPOINT_TYPES = ['WindowsEndpoint', 'MacEndpoint', 'LinuxEndpoint', 'AndroidEndpoint', 'IOSEndpoint', 'NetworkEndpoint'];
  it.each([
    ['25R2', 'list_group_members', 'groupKind', ['LogicalGroup', 'StaticGroup', 'DynamicGroup', 'UniversalDynamicGroup']],
    ['26R1', 'list_group_members', 'groupKind', ['LogicalGroup', 'StaticGroup', 'DynamicGroup', 'UniversalDynamicGroup']],
    ['25R2', 'list_group_members', 'memberType', [...ENDPOINT_TYPES, 'IndustrialEndpoint', 'LogicalGroup']],
    ['26R1', 'list_group_members', 'memberType', [...ENDPOINT_TYPES, 'LogicalGroup']],
    ['25R2', 'list_ad_user_endpoints', 'endpointType', ENDPOINT_TYPES.filter((t) => t !== 'NetworkEndpoint')],
    ['26R1', 'list_ad_user_endpoints', 'endpointType', ENDPOINT_TYPES.filter((t) => t !== 'NetworkEndpoint')],
  ] as const)('%s %s %s offers %j', async (release, tool, selector, values) => {
    const t = (await use(release).list()).find((x) => x.name === tool)!;
    expect([...t.inputSchema.properties[selector].enum].sort()).toEqual([...values].sort());
  });

  it.each([
    ['list_group_members', ['groupKind', 'groupId']],
    ['list_ad_user_endpoints', ['adUserId']],
  ] as const)('%s requires %j', async (tool, required) => {
    const t = (await use('26R1').list()).find((x) => x.name === tool)!;
    expect([...(t.inputSchema.required ?? [])].sort()).toEqual([...required].sort());
  });

  it('IndustrialEndpoint on 26R1 is refused, naming 25R2, and sends nothing', async () => {
    const conn = use('26R1');
    recorder.take();
    const r = await conn.call('list_group_members', { groupKind: 'StaticGroup', groupId: G, memberType: 'IndustrialEndpoint' });
    expect(r.code).toBe(-32602);
    expect(r.text).toContain('list_group_members with groupKind "StaticGroup" and memberType "IndustrialEndpoint" is only available in bMS 25R2');
    expect(recorder.take()).toEqual([]);
  });

  it('a missing or unknown group kind is refused with the release\'s kinds', async () => {
    const conn = use('26R1');
    recorder.take();
    const missing = await conn.call('list_group_members', { groupId: G });
    expect(missing.code).toBe(-32602);
    expect(missing.text).toContain('list_group_members needs groupKind: one of LogicalGroup, StaticGroup, DynamicGroup, UniversalDynamicGroup.');
    const unknown = await conn.call('list_group_members', { groupKind: 'OrgUnit', groupId: G });
    expect(unknown.code).toBe(-32602);
    expect(unknown.text).toContain('Unknown groupKind for list_group_members: "OrgUnit". bMS 26R1 offers: LogicalGroup, StaticGroup, DynamicGroup, UniversalDynamicGroup.');
    const network = await conn.call('list_ad_user_endpoints', { adUserId: G, endpointType: 'NetworkEndpoint' });
    expect(network.code).toBe(-32602);
    expect(network.text).toContain('Unknown endpointType for list_ad_user_endpoints: "NetworkEndpoint"');
    expect(recorder.take()).toEqual([]);
  });

  it('the old id arguments are not accepted (groupId replaces them)', async () => {
    const conn = use('26R1');
    recorder.take();
    const r = await conn.call('list_group_members', { groupKind: 'StaticGroup', staticGroupId: G });
    expect(r.code).toBe(-32602);
    expect(recorder.take()).toEqual([]);
  });

  it('a filter only other routes have is refused, naming the routes that have it', async () => {
    const conn = use('26R1');
    recorder.take();
    const sub = await conn.call('list_group_members', { groupKind: 'StaticGroup', groupId: G, includeSubfolders: true });
    expect(sub.code).toBe(-32602);
    expect(sub.text).toContain('includeSubfolders is not available for list_group_members with groupKind "StaticGroup" without memberType (only with groupKind "LogicalGroup"');
    const host = await conn.call('list_group_members', { groupKind: 'LogicalGroup', groupId: G, memberType: 'AndroidEndpoint', HostName: 'pc01' });
    expect(host.code).toBe(-32602);
    expect(host.text).toContain('HostName is not available for list_group_members with groupKind "LogicalGroup" and memberType "AndroidEndpoint"');
    const adHost = await conn.call('list_ad_user_endpoints', { adUserId: G, endpointType: 'IOSEndpoint', HostName: 'pc01' });
    expect(adHost.code).toBe(-32602);
    expect(adHost.text).toContain('HostName is not available for list_ad_user_endpoints with endpointType "IOSEndpoint"');
    expect(recorder.take()).toEqual([]);
  });

  it('includeSubfolders says it is only for logical groups', async () => {
    const t = (await use('26R1').list()).find((x) => x.name === 'list_group_members')!;
    const d = String(t.inputSchema.properties.includeSubfolders.description);
    expect(d).toContain('Only for');
    expect(d).toContain('groupKind "LogicalGroup"');
    expect(d).not.toContain('StaticGroup');
  });
});

describe('calls that name no route', () => {
  it('an unknown tool name is refused, and a call without any arguments is checked like one with none', async () => {
    Object.assign(process.env, guardEnv('26R1', { writes: false, secretRead: false }));
    const { createServer } = await import('../bconnect-groups-mcp/src/index.ts');
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'groups-no-route', version: '0' });
    await Promise.all([createServer().server.connect(a), client.connect(b)]);
    recorder.take();
    await expect(client.callTool({ name: 'no_such_tool' })).rejects.toThrow('Unknown tool: no_such_tool');
    // No arguments object at all: the AD user route without a type is chosen, and the missing id is refused.
    await expect(client.callTool({ name: 'list_ad_user_endpoints' })).rejects.toThrow(/adUserId/);
    await expect(client.callTool({ name: 'list_group_members' })).rejects.toThrow('list_group_members needs groupKind');
    expect(recorder.take()).toEqual([]);
    await client.close();
  });
});

describe('the per-route notes say exactly which arguments each route takes', () => {
  it('the note parser reads the last note, not words of the spec text before it', () => {
    const route = { groupKind: 'StaticGroup', memberType: null };
    expect(routeTakes('Not for production use. Only for groupKind "LogicalGroup".', route)).toBe(false);
    expect(routeTakes('Only for testing. Not for memberType "AndroidEndpoint".', route)).toBe(true);
    expect(routeTakes('Not for memberType "LogicalGroup"; without memberType.', route)).toBe(false);
    expect(routeTakes('No note here.', route)).toBe(true);
  });

  // The exerciser reads "Only for …" / "Not for …" to give each route its arguments; they must be
  // exactly the arguments the old tool for that route declared (its "all" call in the fixture).
  it.each(['25R2', '26R1'] as const)('%s: every route\'s arguments equal its old tool\'s', async (release) => {
    const conn = use(release);
    const calls = await callsOf('bconnect-groups-mcp', await conn.list(), release);
    expect(calls.length).toBe(release === '25R2' ? 33 : 30);
    const wrong = FIXTURE.filter((e) => e.release === release && e.call === 'all').flatMap((e) => {
      const { tool, select, rename } = replacement(e.tool);
      const route = calls.find((c) => c.name === tool && JSON.stringify(c.select) === JSON.stringify(select));
      const want = Object.keys(e.args).map((k) => rename[k] ?? k).sort();
      const got = Object.keys(route?.inputSchema.properties ?? {}).sort();
      return JSON.stringify(got) === JSON.stringify(want) ? [] : [`${e.tool}: ${got.join(',')} ≠ ${want.join(',')}`];
    });
    expect(wrong).toEqual([]);
  });
});

describe('countOnly per route', () => {
  it('a logical group with includeSubfolders counts with one 1-row request on its route', async () => {
    const conn = use('26R1');
    recorder.take();
    const r = await conn.call('list_group_members', { groupKind: 'LogicalGroup', groupId: G, includeSubfolders: true, countOnly: true });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toContain('totalItems');
    expect(recorder.take().map((x) => [x.method, x.path, Object.fromEntries(x.query)]))
      .toEqual([['GET', `/endpoints/v2.0/LogicalGroups/${G}/Endpoints`, { Page: '0', PageSize: '1', includeSubfolders: 'true' }]]);
  });

  it.each([
    [{ groupKind: 'DynamicGroup', memberType: 'WindowsEndpoint' }, `/endpoints/v2.0/DynamicGroups/${G}/WindowsEndpoints`],
    [{ groupKind: 'UniversalDynamicGroup' }, `/endpoints/v2.0/UniversalDynamicGroups/${G}/Endpoints`],
  ])('%j counts on %s', async (select, path) => {
    const conn = use('26R1');
    recorder.take();
    const r = await conn.call('list_group_members', { ...select, groupId: G, countOnly: true });
    expect(r.isError, r.text).toBe(false);
    expect(recorder.take().map((x) => [x.path, Object.fromEntries(x.query)])).toEqual([[path, { Page: '0', PageSize: '1' }]]);
  });

  it('list_ad_user_endpoints counts per endpoint type', async () => {
    const conn = use('25R2');
    recorder.take();
    const r = await conn.call('list_ad_user_endpoints', { adUserId: G, endpointType: 'MacEndpoint', countOnly: true });
    expect(r.isError, r.text).toBe(false);
    expect(recorder.take().map((x) => [x.path, Object.fromEntries(x.query)])).toEqual([[`/endpoints/v2.0/ADUsers/${G}/MacEndpoints`, { Page: '0', PageSize: '1' }]]);
  });
});
