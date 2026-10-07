/**
 * Endpoint tools: one tool per operation, the endpoint type as an argument
 * (REQ-SRV-029, #174, ADR-0015).
 *
 * AC 1: `fixtures/endpoints-tool-requests.json` holds the requests every
 * replaced tool sent on `main` b587c6b (both releases; required arguments, all
 * arguments, countOnly), recorded with the exerciser. Each replacement call
 * must send the same requests: method, path (with the domain segment), query
 * (as a set: search_endpoints appended its own two at the end), content type
 * and body. The mapping below is written from the issue, not taken from the
 * server's table, so the two check each other.
 * AC 2: every removed name answers with its replacement and argument, in both
 * releases, with writes on and off, and is never listed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, createRecorder, guardEnv, ROOT, type ConnectedServer } from './lib/exerciser.js';
import type { Release } from './lib/spec.js';
import { UPDATE_FIELDS } from '../bconnect-endpoints-mcp/src/update-fields.js';
import { CREATE_FIELDS, fieldsOf } from '../bconnect-endpoints-mcp/src/create-fields.js';

interface Recorded { method: string; path: string; query: Array<[string, string]>; contentType: string | null; body: string }
interface Entry { release: Release; tool: string; call: string; args: Record<string, unknown>; requests: Recorded[] }
const FIXTURE: Entry[] = JSON.parse(readFileSync(join(ROOT, '__tests__', 'fixtures', 'endpoints-tool-requests.json'), 'utf8'));

const TYPE: Record<string, string> = {
  windows: 'WindowsEndpoint', mac: 'MacEndpoint', linux: 'LinuxEndpoint', android: 'AndroidEndpoint',
  ios: 'IOSEndpoint', network: 'NetworkEndpoint', industrial: 'IndustrialEndpoint',
};

/** The replacement of an old tool: new tool, selector arguments, renamed arguments. Kept tools map to themselves. */
function replacement(old: string): { tool: string; select: Record<string, string>; rename?: Record<string, string>; defaults?: Record<string, unknown> } {
  let m: RegExpMatchArray | null;
  // search_endpoints sent PageSize 50 when no pageSize was given: the equivalent call passes it.
  if (old === 'search_endpoints') return { tool: 'list_endpoints', select: {}, rename: { query: 'SearchQuery', pageSize: 'PageSize' }, defaults: { PageSize: 50 } };
  if (old === 'list_group_endpoints') return { tool: 'list_endpoints_by_logical_group', select: {} };
  if (old === 'list_windows_endpoints_by_logical_group') return { tool: 'list_endpoints_by_logical_group', select: { type: 'WindowsEndpoint' } };
  if ((m = old.match(/^list_(\w+)_endpoints$/)) && TYPE[m[1]]) return { tool: 'list_endpoints', select: { type: TYPE[m[1]] } };
  if ((m = old.match(/^(get|delete|update)_(\w+)_endpoint$/)) && TYPE[m[2]]) return { tool: `${m[1]}_endpoint`, select: { type: TYPE[m[2]] } };
  if ((m = old.match(/^start_(\w+)_enrollment$/)) && TYPE[m[1]]) return { tool: 'start_enrollment', select: { type: TYPE[m[1]] } };
  return { tool: old, select: {} };
}

const KEPT = new Set(['list_endpoints', 'get_endpoint', 'delete_endpoint', 'list_endpoints_by_logical_group']);
const REMOVED = [...new Set(FIXTURE.map((e) => e.tool))].filter((t) => !KEPT.has(t)).sort();
const NEW_TOOLS = ['list_endpoints', 'get_endpoint', 'delete_endpoint', 'update_endpoint', 'start_enrollment', 'list_endpoints_by_logical_group'];

const normalized = (r: Recorded) => ({ method: r.method, path: r.path, query: [...r.query].sort((a, b) => a.join('=').localeCompare(b.join('='))), contentType: r.contentType, body: r.body });

const recorder = createRecorder(() => ({ data: [], totalItems: 0 }));
const saved = { ...process.env };
const conns: Partial<Record<Release, ConnectedServer>> = {};
beforeAll(async () => {
  recorder.listen();
  for (const release of ['25R2', '26R1'] as const) {
    Object.assign(process.env, guardEnv(release, { writes: true, secretRead: true }));
    conns[release] = await connect('bconnect-endpoints-mcp');
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
  it('the fixture covers every replaced tool in both releases (not vacuous)', () => {
    expect(REMOVED.length).toBe(35);
    expect(new Set(FIXTURE.filter((e) => e.release === '25R2').map((e) => e.tool)).size).toBe(39);
    expect(new Set(FIXTURE.filter((e) => e.release === '26R1').map((e) => e.tool)).size).toBe(35);
  });

  /**
   * The one deliberate change: update_android_endpoint and update_ios_endpoint sent an empty
   * patch when no field was given; update_endpoint refuses that for every type, as the other
   * types' update tools already did (#171), and sends nothing.
   */
  const emptyUpdate = (entry: Entry) => /^update_(android|ios)_endpoint$/.test(entry.tool) && entry.requests[0]?.body === '[]';

  it.each(FIXTURE.map((e) => [e.release, e.tool, e.call, e] as const))('%s %s (%s arguments)', async (release, tool, _call, entry) => {
    const { tool: next, select, rename = {}, defaults = {} } = replacement(tool);
    const args = { ...defaults, ...Object.fromEntries(Object.entries(entry.args).map(([k, v]) => [rename[k] ?? k, v])), ...select };
    const conn = use(release);
    recorder.take();
    const result = await conn.call(next, args);
    if (emptyUpdate(entry)) {
      expect(result.code).toBe(-32602);
      expect(result.text).toContain('needs at least one field to change');
      expect(recorder.take()).toEqual([]);
      return;
    }
    expect(result.isError, result.text).toBe(false);
    expect(recorder.take().map(normalized)).toEqual(entry.requests.map(normalized));
  });

  it('the empty-patch exception covers only the 4 Android/iOS calls without a field (not vacuous, not wider)', () => {
    expect(FIXTURE.filter(emptyUpdate).map((e) => `${e.release} ${e.tool} ${e.call}`).sort()).toEqual([
      '25R2 update_android_endpoint required', '25R2 update_ios_endpoint required',
      '26R1 update_android_endpoint required', '26R1 update_ios_endpoint required',
    ]);
  });
});

describe('AC 2: a removed name answers with its replacement', () => {
  const cases = (['25R2', '26R1'] as const).flatMap((release) => [true, false].flatMap((writes) => REMOVED.map((tool) => [release, writes, tool] as const)));

  it.each(cases)('%s writes=%s %s', async (release, writes, tool) => {
    const conn = use(release, writes);
    const { tool: next, select, rename } = replacement(tool);
    recorder.take();
    const r = await conn.call(tool, { id: '00000000-0000-4000-8000-000000000001' });
    expect(r.code).toBe(-32601);
    const how = select.type ? `with type "${select.type}"` : 'without type';
    expect(r.text).toContain(`${tool} was replaced by ${next}: call ${next} ${how}`);
    if (rename) expect(r.text).toContain('with SearchQuery (was query) and PageSize (was pageSize)');
    if (release === '26R1' && select.type === 'IndustrialEndpoint') expect(r.text).toContain('That route is only available in bMS 25R2; this server uses 26R1');
    expect(recorder.take()).toEqual([]);
  });

  it.each(['25R2', '26R1'] as const)('no removed name is listed on %s (no aliases)', async (release) => {
    const names = (await use(release).list()).map((t) => t.name);
    expect(names.filter((n) => REMOVED.includes(n))).toEqual([]);
    expect(names).toEqual(expect.arrayContaining(NEW_TOOLS));
  });
});

describe('type values follow the selected release (from the spec)', () => {
  const ALL = ['WindowsEndpoint', 'AndroidEndpoint', 'IOSEndpoint', 'MacEndpoint', 'LinuxEndpoint', 'NetworkEndpoint'];
  it.each([
    ['25R2', 'list_endpoints', [...ALL, 'IndustrialEndpoint']],
    ['26R1', 'list_endpoints', ALL],
    ['25R2', 'get_endpoint', [...ALL, 'IndustrialEndpoint']],
    ['26R1', 'delete_endpoint', ALL],
    ['25R2', 'update_endpoint', [...ALL, 'IndustrialEndpoint']],
    ['26R1', 'update_endpoint', ALL],
    ['26R1', 'start_enrollment', ['WindowsEndpoint', 'AndroidEndpoint', 'IOSEndpoint', 'MacEndpoint']],
    ['25R2', 'list_endpoints_by_logical_group', ['WindowsEndpoint']],
  ] as const)('%s %s offers %j', async (release, tool, values) => {
    const t = (await use(release).list()).find((x) => x.name === tool)!;
    expect([...t.inputSchema.properties.type.enum].sort()).toEqual([...values].sort());
  });

  it.each([
    ['update_endpoint', true], ['start_enrollment', true],
    ['list_endpoints', false], ['get_endpoint', false], ['delete_endpoint', false], ['list_endpoints_by_logical_group', false],
  ] as const)('%s: type required = %s', async (tool, required) => {
    const t = (await use('26R1').list()).find((x) => x.name === tool)!;
    expect((t.inputSchema.required ?? []).includes('type')).toBe(required);
  });

  it('IndustrialEndpoint on 26R1 is refused, naming 25R2, and sends nothing', async () => {
    const conn = use('26R1');
    recorder.take();
    const r = await conn.call('list_endpoints', { type: 'IndustrialEndpoint' });
    expect(r.code).toBe(-32602);
    expect(r.text).toContain('list_endpoints with type "IndustrialEndpoint" is only available in bMS 25R2');
    expect(recorder.take()).toEqual([]);
  });

  it('a filter only another type has is refused, naming the types that have it', async () => {
    const conn = use('26R1');
    recorder.take();
    const r = await conn.call('list_endpoints', { type: 'AndroidEndpoint', Domain: 'corp' });
    expect(r.code).toBe(-32602);
    expect(r.text).toContain('Domain is not available for list_endpoints with type "AndroidEndpoint" (only with type "WindowsEndpoint")');
    const u = await conn.call('update_endpoint', { type: 'IOSEndpoint', id: '00000000-0000-4000-8000-000000000001', hostName: 'x' });
    expect(u.code).toBe(-32602);
    expect(u.text).toContain('hostName is not available for update_endpoint with type "IOSEndpoint"');
    expect(recorder.take()).toEqual([]);
  });

  it('countOnly works per type with one 1-row request on the type\'s route', async () => {
    const conn = use('26R1');
    recorder.take();
    const r = await conn.call('list_endpoints', { type: 'MacEndpoint', countOnly: true });
    expect(r.isError, r.text).toBe(false);
    expect(recorder.take().map((x) => [x.method, x.path, Object.fromEntries(x.query)])).toEqual([['GET', '/endpoints/v2.0/MacEndpoints', { Page: '0', PageSize: '1' }]]);
  });
});

describe('write gate and live-check notes', () => {
  it('with writes off, update_endpoint and start_enrollment are hidden, delete_endpoint too, and refused by the gate', async () => {
    const conn = use('26R1', false);
    const names = (await conn.list()).map((t) => t.name);
    expect(names).not.toContain('update_endpoint');
    expect(names).not.toContain('start_enrollment');
    expect(names).not.toContain('delete_endpoint');
    recorder.take();
    const r = await conn.call('update_endpoint', { type: 'WindowsEndpoint', id: '00000000-0000-4000-8000-000000000001', comment: 'x' });
    expect(r.text).toContain("Write operation 'update_endpoint' is disabled");
    expect(recorder.take()).toEqual([]);
  });

  it('a merged write tool names the types without a live check', async () => {
    const tools = await use('26R1').list();
    const description = (name: string) => tools.find((t) => t.name === name)!.description as string;
    expect(description('update_endpoint')).toMatch(/Not yet verified against a live bMS for: type "AndroidEndpoint"; type "IOSEndpoint"; type "LinuxEndpoint"; type "NetworkEndpoint"\.$/);
    expect(description('delete_endpoint')).toMatch(/Not yet verified against a live bMS for: without type; type "AndroidEndpoint"; type "IOSEndpoint"; type "LinuxEndpoint"; type "NetworkEndpoint"\.$/);
  });
});

describe('merged schemas', () => {
  // A merged tool lists each field once (the first type's definition), so a field shared by
  // several types must be defined alike for all of them; only the patch path may differ (Mac).
  it.each([
    ['update_endpoint', UPDATE_FIELDS as Record<string, Record<string, Record<string, unknown>>>],
    ['start_enrollment', Object.fromEntries(Object.entries(CREATE_FIELDS).map(([k, v]) => [k, fieldsOf(v)])) as Record<string, Record<string, Record<string, unknown>>>],
  ])('%s: a field shared by several types has one definition', (tool, table) => {
    const seen = new Map<string, string>();
    const differ: string[] = [];
    for (const [key, fields] of Object.entries(table).filter(([k]) => k.startsWith(`${tool}[`))) {
      for (const [name, { path: _path, ...definition }] of Object.entries(fields)) {
        const text = JSON.stringify(definition);
        if (seen.has(name) && seen.get(name) !== text) differ.push(`${key} ${name}`);
        seen.set(name, seen.get(name) ?? text);
      }
    }
    expect(seen.size).toBeGreaterThan(3);
    expect(differ).toEqual([]);
  });
});
