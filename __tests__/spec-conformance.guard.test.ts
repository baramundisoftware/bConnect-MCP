/**
 * Spec-conformance guard (REQ-QA-001, ADR-0006).
 *
 * Every server declares, in src/operations.ts, the OpenAPI operation each tool
 * calls. This guard calls every tool of every server, for both bMS releases,
 * and checks the recorded requests against the declared operation in that
 * release's spec:
 * - pass 1 (all gates open, required arguments): route, request body and
 *   content type, and that the tool returns what the API answered;
 * - pass 2 (every documented argument plus an undeclared one): parameters, and
 *   request bodies built from optional arguments;
 * - pass 3 (writes off): no request other than GET.
 * It also checks that every spec operation is reached by some tool's request.
 *
 * Known violations are in spec-conformance.baseline.json, each with the GitHub
 * issue that fixes it. A new violation fails; so does a baseline entry that no
 * longer occurs (the fix is proven: remove the entry), and an entry without an
 * issue number. The baseline is the only exemption list: every exception is a
 * known defect with an issue.
 *
 *   npm run check:spec                                  # run
 *   SPEC_BASELINE=prune npm run check:spec              # drop entries that no longer occur
 *   SPEC_BASELINE=add-new npm run check:spec            # add new violations with issue 0, to triage
 *
 * The checks themselves are proven on known-bad fixtures below.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RELEASES, type Release, type ApiOperation, loadOperations } from './lib/spec.js';
import {
  ID, ROOT, SERVERS, UNKNOWN_NAME, UNKNOWN_VALUE, allArguments, callsOf, connect, createRecorder, domainOf, guardEnv, requiredArguments,
} from './lib/exerciser.js';
import {
  type Baseline, type ParamCall, type Violation, type WriteCall,
  checkBodies, checkCoverage, checkParams, checkStaleBindings, checkTools, checkUnsupported, checkWritesOff, compareWithBaseline, keyOf,
} from './lib/conformance.js';
import { bodyValidator, jsonPatchProblems } from './lib/bodies.js';

const BASELINE_PATH = join(ROOT, '__tests__', 'spec-conformance.baseline.json');
const baseline: Baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const mode = process.env.SPEC_BASELINE ?? '';
if (!['', 'prune', 'add-new'].includes(mode)) throw new Error(`SPEC_BASELINE must be prune or add-new, not '${mode}'`);

/** Every API answer carries this; a tool that returns what the API sent shows it in its result. */
const MARKER = 'zz-guard-response-marker';
const recorder = createRecorder(() => ({ id: MARKER, name: MARKER, guardMarker: MARKER }));
const savedEnv = { ...process.env };
beforeAll(() => recorder.listen());
afterAll(() => {
  recorder.close();
  process.env = savedEnv;
});

async function tableOf(server: string): Promise<Readonly<Record<string, readonly string[]>>> {
  const mod = await import(pathToFileURL(join(ROOT, server, 'src', 'operations.ts')).href);
  return mod.TOOL_OPERATIONS;
}

/** All violations for one release, plus the tools each server registers. */
async function examine(release: Release): Promise<{ violations: Violation[]; registered: Map<string, Set<string>> }> {
  Object.assign(process.env, guardEnv(release, { writes: true, secretRead: true }));
  const violations: Violation[] = [];
  const registered = new Map<string, Set<string>>();
  const coveredByDomain = new Map<string, Set<string>>();
  const validate = bodyValidator(release);
  for (const server of SERVERS) {
    const domain = domainOf(server);
    const table = await tableOf(server);
    const conn = await connect(server);
    const exercised = [];
    const paramCalls: ParamCall[] = [];
    const writeCalls: WriteCall[] = [];
    // A merged tool is called once per route of the release, as `tool[selector=value]` (REQ-SRV-029).
    const calls = await callsOf(server, conn.tools, release);
    for (const tool of calls.map((c) => ({ ...c, name: c.key, call: c.name }))) {
      // Pass 1, required arguments: route, body and response checks.
      recorder.take();
      const { text } = await conn.call(tool.call, { ...requiredArguments(tool.inputSchema), ...tool.select });
      const pass1 = recorder.take();
      // The sample GUID becomes {id}, so baseline keys read like routes.
      exercised.push({ tool: tool.name, requests: pass1.map((r) => ({ method: r.method, path: r.path.split(ID).join('{id}') })) });
      writeCalls.push({ tool: tool.name, result: text, requests: pass1.map((r) => ({ method: r.method, path: r.path, contentType: r.contentType, body: r.body })) });
      // Pass 2, every documented argument: parameter checks.
      const { args, idsByArg } = allArguments(tool.inputSchema);
      const { isError } = await conn.call(tool.call, { ...args, ...tool.select });
      const pass2 = recorder.take();
      // Pass 3, required arguments plus an undeclared one: it is refused (#163), so nothing may
      // reach the wire; anything that does is checked by arg-leak with the pass-2 requests.
      await conn.call(tool.call, { ...requiredArguments(tool.inputSchema), ...tool.select, [UNKNOWN_NAME]: UNKNOWN_VALUE });
      const pass3 = recorder.take();
      paramCalls.push({
        tool: tool.name, inputSchema: tool.inputSchema, idsByArg, select: tool.select,
        unknownName: UNKNOWN_NAME, unknownValue: UNKNOWN_VALUE, failed: isError,
        requests: [...pass2, ...pass3].map((r) => ({ method: r.method, path: r.path, query: r.query, body: r.body })),
      });
      // Bodies built from optional arguments too.
      writeCalls.push({
        tool: tool.name, sampleValues: true,
        requests: pass2.map((r) => ({ method: r.method, path: r.path, contentType: r.contentType, body: r.body })),
      });
    }
    await conn.close();
    registered.set(server, new Set(calls.map((c) => c.key)));
    const covered = coveredByDomain.get(domain) ?? new Set<string>();
    coveredByDomain.set(domain, covered);
    violations.push(...checkTools({ release, server, domain, table, exercised, covered }));
    violations.push(...checkParams({ release, server, domain, table, calls: paramCalls }));
    violations.push(...checkBodies({ release, server, domain, table, calls: writeCalls, marker: MARKER, validate }));
  }

  // Pass 3, writes off: no tool may send anything but GET. Every tool is called: listed with
  // writes on (tools/list hides write tools while writes are off, REQ-SRV-026), then called with
  // writes off (the gate reads the setting on each call).
  for (const server of SERVERS) {
    Object.assign(process.env, guardEnv(release, { writes: true, secretRead: true }));
    const conn = await connect(server);
    Object.assign(process.env, guardEnv(release, { writes: false, secretRead: true }));
    const listedKeys = new Set((await callsOf(server, conn.tools, release)).map((c) => c.key));
    for (const tool of registered.get(server) ?? []) {
      if (!listedKeys.has(tool)) {
        violations.push({ check: 'writes-off-not-called', release, server, tool, detail: 'not listed with writes on' });
      }
    }
    const calls = [];
    for (const tool of await callsOf(server, conn.tools, release)) {
      recorder.take();
      await conn.call(tool.name, { ...requiredArguments(tool.inputSchema), ...tool.select });
      calls.push({ tool: tool.key, requests: recorder.take() });
    }
    await conn.close();
    violations.push(...checkWritesOff(release, server, calls));
  }
  for (const [domain, covered] of coveredByDomain) violations.push(...checkCoverage(release, domain, covered));
  return { violations, registered };
}

describe('spec conformance (REQ-QA-001)', () => {
  const observed: Violation[] = [];

  beforeAll(async () => {
    const registeredAny = new Map<string, Set<string>>();
    for (const release of RELEASES) {
      const { violations, registered } = await examine(release);
      observed.push(...violations);
      for (const [server, tools] of registered) {
        const all = registeredAny.get(server) ?? new Set<string>();
        tools.forEach((t) => all.add(t));
        registeredAny.set(server, all);
      }
    }
    for (const server of SERVERS) {
      observed.push(...checkStaleBindings(server, await tableOf(server), registeredAny.get(server)!));
    }
    if (mode === 'prune' || mode === 'add-new') {
      const keys = new Set(observed.map(keyOf));
      const next: Baseline = {};
      for (const [k, issue] of Object.entries(baseline)) if (keys.has(k)) next[k] = issue;
      if (mode === 'add-new') for (const k of keys) if (!(k in next)) next[k] = 0;
      const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
      writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + '\n');
    }
  }, 300_000);

  it('exercises all 13 servers', () => {
    expect(SERVERS).toHaveLength(13);
  });

  it('has no violation that is not in the baseline', () => {
    expect(compareWithBaseline(observed, baseline).new).toEqual([]);
  });

  it('has no baseline entry that no longer occurs (remove it: the fix is proven)', () => {
    expect(compareWithBaseline(observed, baseline).stale).toEqual([]);
  });

  it('has an issue number for every baseline entry', () => {
    expect(compareWithBaseline(observed, baseline).untriaged).toEqual([]);
  });
});

/** Known-bad fixtures: each check must report its case (REQ-QA-001 AC 11). */
describe('the checks report known-bad cases (self-test)', () => {
  const op = (method: string, path: string, operationId: string, queryParams: string[] = []): ApiOperation => {
    const pattern = new RegExp('^' + path.replace(/\{[^}]+\}/g, '[^/]+') + '/?$');
    return {
      release: '26R1', domain: 'demo', method, path, operationId, summary: '', secretFields: [], queryParams,
      requestBodies: {}, bodyRequired: true, returnsBody: true, spec: {},
      matches: (m, p) => m.toUpperCase() === method && pattern.test(p),
    };
  };
  const operations = [op('GET', '/v2.0/Things', 'GetThings'), op('GET', '/v2.0/Things/{id}', 'GetThing'), op('DELETE', '/v2.0/Things/{id}', 'DeleteThing')];
  const run = (table: Record<string, string[]>, exercised: Array<{ tool: string; requests: Array<{ method: string; path: string }> }>) =>
    checkTools({ release: '26R1', server: 'demo-server', domain: 'demo', table, exercised, operations }).map((x) => `${x.check} ${x.tool} ${x.detail}`);

  it('accepts a tool that calls its declared operation', () => {
    expect(run({ get_thing: ['GetThing'] }, [{ tool: 'get_thing', requests: [{ method: 'GET', path: '/demo/v2.0/Things/abc' }] }])).toEqual([]);
  });

  it('reports a wrong route, a wrong method and a wrong domain', () => {
    expect(run({ get_thing: ['GetThing'] }, [{
      tool: 'get_thing',
      requests: [
        { method: 'GET', path: '/demo/v2.0/Thingz/abc' },
        { method: 'DELETE', path: '/demo/v2.0/Things/abc' },
        { method: 'GET', path: '/other/v2.0/Things/abc' },
      ],
    }])).toEqual([
      'route get_thing GET /demo/v2.0/Thingz/abc',
      'route get_thing DELETE /demo/v2.0/Things/abc',
      'route get_thing GET /other/v2.0/Things/abc',
    ]);
  });

  it('reports a route that exists but belongs to another operation', () => {
    expect(run({ get_thing: ['GetThing'] }, [{ tool: 'get_thing', requests: [{ method: 'GET', path: '/demo/v2.0/Things' }] }]))
      .toEqual(['route get_thing GET /demo/v2.0/Things']);
  });

  it('reports a missing binding, an unknown operationId and a tool that sends nothing', () => {
    expect(run({ b: ['NoSuchOp'], c: ['GetThings'] }, [
      { tool: 'a', requests: [{ method: 'GET', path: '/demo/v2.0/Things' }] },
      { tool: 'b', requests: [{ method: 'GET', path: '/demo/v2.0/Things' }] },
      { tool: 'c', requests: [] },
    ])).toEqual(['binding-missing a -', 'binding-unknown-op b NoSuchOp', 'route b GET /demo/v2.0/Things', 'no-request c -']);
  });

  it('counts an operation as covered only when a request reached it', () => {
    const covered = new Set<string>();
    checkTools({
      release: '26R1', server: 'demo-server', domain: 'demo', operations, covered,
      table: { get_thing: ['GetThing'], list_things: ['GetThings'] },
      exercised: [
        { tool: 'get_thing', requests: [{ method: 'GET', path: '/demo/v2.0/Thingz/abc' }] },
        { tool: 'list_things', requests: [{ method: 'GET', path: '/demo/v2.0/Things' }] },
      ],
    });
    expect([...covered]).toEqual(['GetThings']);
    expect(checkCoverage('26R1', 'demo', covered, operations).map((x) => x.detail)).toEqual(['GetThing', 'DeleteThing']);
  });

  it('matches against the real 26R1 spec (route templates, domain prefix)', () => {
    const real = (path: string) => checkTools({
      release: '26R1', server: 'bconnect-assets-mcp', domain: 'assets',
      table: { get_asset: ['GetAsset'] },
      exercised: [{ tool: 'get_asset', requests: [{ method: 'GET', path }] }],
    }).map((x) => x.check);
    expect(real('/assets/v2.0/Assets/00000000-0000-4000-8000-000000000001')).toEqual([]);
    expect(real('/assets/v2.0/Asset/00000000-0000-4000-8000-000000000001')).toEqual(['route']);
    expect(real('/v2.0/Assets/00000000-0000-4000-8000-000000000001')).toEqual(['route']);
  });

  it('skips an operation the server declares unsupported, in that release only (REQ-SRV-031)', () => {
    const unsupported = { DeleteThing: { '25R2': 'Not offered: the specification describes this request in two ways.' } };
    const covered = new Set(['GetThings', 'GetThing']);
    expect(checkCoverage('26R1', 'demo', covered, operations, unsupported).map(keyOf)).toEqual(['coverage 26R1 demo - DeleteThing']);
    expect(checkCoverage('25R2', 'demo', covered, operations, unsupported)).toEqual([]);
  });

  it('reports a declaration that no longer holds: unknown operation, no tool, tool listed, no reason', () => {
    const table = { get_thing: ['GetThing'], delete_thing: ['DeleteThing'] };
    const reason = 'Not offered: the specification describes this request in two ways.';
    const run = (unsupported: Record<string, Record<string, string>>, listed: string[] = []) =>
      checkUnsupported({ release: '26R1', server: 'demo-server', domain: 'demo', unsupported, table, listed: new Set(listed), operations })
        .map((x) => `${x.check} ${x.detail}`);
    expect(run({ DeleteThing: { '26R1': reason } })).toEqual([]);
    expect(run({ GoneThing: { '26R1': reason } })).toEqual(['unsupported-unknown GoneThing']);
    expect(run({ GetThings: { '26R1': reason } })).toEqual(['unsupported-no-tool GetThings']);
    expect(run({ DeleteThing: { '26R1': reason } }, ['delete_thing'])).toEqual(['unsupported-listed DeleteThing']);
    expect(run({ DeleteThing: { '26R1': 'short' } })).toEqual(['unsupported-reason DeleteThing']);
    // Another release's declaration is checked in that release's pass.
    expect(run({ DeleteThing: { '25R2': 'short' } })).toEqual([]);
  });

  it('reports a dead table entry and an operation no tool declares', () => {
    expect(checkStaleBindings('demo-server', { gone: ['GetThing'] }, new Set(['other'])).map(keyOf))
      .toEqual(['binding-stale - demo-server gone -']);
    expect(checkCoverage('26R1', 'demo', new Set(['GetThings', 'GetThing']), operations).map(keyOf))
      .toEqual(['coverage 26R1 demo - DeleteThing']);
  });

  describe('parameters', () => {
    const paramOps = [
      op('GET', '/v2.0/Groups/{groupId}/Things', 'GetThingsByGroup', ['Page', 'PageSize', 'Name']),
      op('POST', '/v2.0/Things', 'CreateThing'),
    ];
    const good = {
      type: 'object',
      properties: {
        groupId: { type: 'string' },
        Page: { type: 'number', description: 'Zero-indexed page number (default: 0).' },
        PageSize: { type: 'number', description: 'Items per page (max: 1000).' },
        Name: { type: 'string' },
      },
    };
    const G = '00000000-0000-4000-8000-000000000001';
    /** Every query parameter `good` offers, as a tool that applies them sends them. */
    const OFFERED: Array<[string, string]> = [['Page', '1'], ['PageSize', '20'], ['Name', 'x']];
    const call = (over: Partial<ParamCall>): ParamCall => ({
      tool: 'list_things_by_group', inputSchema: good, idsByArg: { groupId: G }, unknownName: 'zzUnknown', unknownValue: 'UNK', failed: false,
      requests: [{ method: 'GET', path: `/demo/v2.0/Groups/${G}/Things`, query: OFFERED, body: '' }],
      ...over,
    });
    const run = (c: ParamCall, table: Record<string, string[]> = { list_things_by_group: ['GetThingsByGroup'], create_thing: ['CreateThing'] }) =>
      checkParams({ release: '26R1', server: 'demo-server', domain: 'demo', table, calls: [c], operations: paramOps })
        .map((x) => `${x.check} ${x.tool} ${x.detail}`);

    it('accepts a tool that offers and sends exactly what its operation declares', () => {
      expect(run(call({}))).toEqual([]);
    });

    it('reports an undeclared argument that reaches the query or the body', () => {
      expect(run(call({ requests: [{ method: 'GET', path: `/demo/v2.0/Groups/${G}/Things`, query: [...OFFERED, ['zz', 'UNK']], body: '' }] })))
        .toEqual(['arg-leak list_things_by_group -']);
      expect(run(call({ tool: 'create_thing', inputSchema: { properties: {} }, idsByArg: {}, requests: [{ method: 'POST', path: '/demo/v2.0/Things', query: [], body: '{"zz":"UNK"}' }] })))
        .toEqual(['arg-leak create_thing -']);
    });

    it('reports a query parameter the operation does not declare (e.g. a path ID repeated in the query)', () => {
      expect(run(call({ requests: [{ method: 'GET', path: `/demo/v2.0/Groups/${G}/Things`, query: [...OFFERED, ['groupId', G], ['includeSubGroups', 'true']], body: '' }] })))
        .toEqual(['query-undeclared list_things_by_group groupId', 'query-undeclared list_things_by_group includeSubGroups']);
    });

    it('reports a declared query parameter the tool does not offer', () => {
      const { Name: _dropped, ...props } = good.properties;
      const sendsPageOnly = [{ method: 'GET', path: `/demo/v2.0/Groups/${G}/Things`, query: [['Page', '1'], ['PageSize', '20']] as Array<[string, string]>, body: '' }];
      expect(run(call({ inputSchema: { properties: props }, requests: sendsPageOnly }))).toEqual(['query-not-offered list_things_by_group Name']);
      // Offered under the tool's own argument name: sent, so not reported.
      expect(run(call({ inputSchema: { properties: { ...props, name: { type: 'string' } } } }))).toEqual([]);
    });

    it('reports a declared query parameter the tool offers but does not send (#179)', () => {
      const dropsName = [{ method: 'GET', path: `/demo/v2.0/Groups/${G}/Things`, query: [['Page', '1'], ['PageSize', '20']] as Array<[string, string]>, body: '' }];
      expect(run(call({ requests: dropsName }))).toEqual(['query-dropped list_things_by_group Name']);
    });

    it('reports a path slot filled by an argument whose name does not fit it', () => {
      expect(run(call({ inputSchema: { properties: { ...good.properties, endpointId: { type: 'string' } } }, idsByArg: { endpointId: G } })))
        .toEqual(['path-slot list_things_by_group {groupId} ← endpointId']);
    });

    it('reports an undeclared argument whose key reaches the wire with another value', () => {
      expect(run(call({ requests: [{ method: 'GET', path: `/demo/v2.0/Groups/${G}/Things`, query: [...OFFERED, ['zzUnknown', 'other']], body: '' }] })))
        .toEqual(['arg-leak list_things_by_group -', 'query-undeclared list_things_by_group zzUnknown']);
    });

    it('compares argument names exactly: includeSubGroups is not includeSubfolders', () => {
      const ops = [op('GET', '/v2.0/Groups/{groupId}/Things', 'GetThingsByGroup', ['includeSubfolders'])];
      const c = call({
        inputSchema: { properties: { groupId: { type: 'string' }, includeSubGroups: { type: 'boolean' } } },
        requests: [{ method: 'GET', path: `/demo/v2.0/Groups/${G}/Things`, query: [['includeSubGroups', 'false']], body: '' }],
      });
      expect(checkParams({ release: '26R1', server: 'demo-server', domain: 'demo', table: { list_things_by_group: ['GetThingsByGroup'] }, calls: [c], operations: ops })
        .map((x) => `${x.check} ${x.detail}`)).toEqual(['query-undeclared includeSubGroups', 'query-not-offered includeSubfolders']);
      // Case only: the spelling split between routes (includeSubFolders vs includeSubfolders).
      const caseOnly = call({
        inputSchema: { properties: { groupId: { type: 'string' }, includeSubFolders: { type: 'boolean' } } },
        requests: [{ method: 'GET', path: `/demo/v2.0/Groups/${G}/Things`, query: [], body: '' }],
      });
      expect(checkParams({ release: '26R1', server: 'demo-server', domain: 'demo', table: { list_things_by_group: ['GetThingsByGroup'] }, calls: [caseOnly], operations: ops })
        .map((x) => `${x.check} ${x.detail}`)).toEqual(['query-not-offered includeSubfolders']);
    });

    it('reports a call that failed or sent nothing', () => {
      expect(run(call({ failed: true, requests: [] }))).toEqual(['params-not-exercised list_things_by_group -']);
    });

    it('does not let a related but different argument fill a slot', () => {
      const ops = [op('GET', '/v2.0/UniversalDynamicGroups/{universalDynamicGroupId}/Things', 'GetThingsByUdg')];
      const c = call({
        inputSchema: { properties: { dynamicGroupId: { type: 'string' } } }, idsByArg: { dynamicGroupId: G },
        requests: [{ method: 'GET', path: `/demo/v2.0/UniversalDynamicGroups/${G}/Things`, query: [], body: '' }],
      });
      expect(checkParams({ release: '26R1', server: 'demo-server', domain: 'demo', table: { list_things_by_group: ['GetThingsByUdg'] }, calls: [c], operations: ops })
        .map((x) => `${x.check} ${x.detail}`)).toEqual(['path-slot {universalDynamicGroupId} ← dynamicGroupId']);
    });

    it('lets a merged tool\'s groupId fill only the slot of the group kind its call selects (REQ-SRV-029)', () => {
      const ops = [op('GET', '/v2.0/LogicalGroups/{logicalGroupId}/Things', 'GetThingsByLogicalGroup')];
      const via = (groupKind: string) => call({
        inputSchema: { properties: { groupId: { type: 'string' } } }, idsByArg: { groupId: G }, select: { groupKind },
        requests: [{ method: 'GET', path: `/demo/v2.0/LogicalGroups/${G}/Things`, query: [], body: '' }],
      });
      const check = (c: ParamCall) => checkParams({ release: '26R1', server: 'demo-server', domain: 'demo', table: { list_things_by_group: ['GetThingsByLogicalGroup'] }, calls: [c], operations: ops })
        .map((x) => `${x.check} ${x.detail}`);
      expect(check(via('LogicalGroup'))).toEqual([]);
      expect(check(via('StaticGroup'))).toEqual(['path-slot {logicalGroupId} ← groupId']);
      const noSelect = via('LogicalGroup');
      delete noSelect.select;
      expect(check(noSelect)).toEqual(['path-slot {logicalGroupId} ← groupId']);
      // A member type is not the parent, and a mere suffix is not a word.
      expect(check({ ...via('LogicalGroup'), select: { memberType: 'LogicalGroup' } })).toEqual(['path-slot {logicalGroupId} ← groupId']);
      const up = { ...via('LogicalGroup'), inputSchema: { properties: { upId: { type: 'string' } } }, idsByArg: { upId: G } };
      expect(check(up)).toEqual(['path-slot {logicalGroupId} ← upId']);
    });

    it('reports a 1-based or missing Page description and a PageSize without the 1000 limit', () => {
      const props = (page?: string, size?: string) => ({ properties: { ...good.properties, Page: { type: 'number', description: page }, PageSize: { type: 'number', description: size } } });
      expect(run(call({ inputSchema: props('Page number (1-based)', 'Items per page (max: 1000).') }))).toEqual(['page-description list_things_by_group Page']);
      expect(run(call({ inputSchema: props(undefined, 'Items per page.') })))
        .toEqual(['page-description list_things_by_group Page', 'page-description list_things_by_group PageSize']);
      // Says nothing about where pages start; a default of 0 isn't enough.
      expect(run(call({ inputSchema: props('Page number (default: 0).', 'Items per page (default 1000).') })))
        .toEqual(['page-description list_things_by_group Page', 'page-description list_things_by_group PageSize']);
      // A range states the maximum as well.
      expect(run(call({ inputSchema: props('Zero-indexed page number.', 'Results per page (1–1000, default 20)') }))).toEqual([]);
      // Lower-case argument names are checked too.
      expect(run(call({ inputSchema: { properties: { ...good.properties, pageSize: { type: 'number', description: 'default: 50' } } } })))
        .toEqual(['page-description list_things_by_group pageSize']);
    });
  });

  describe('bodies, responses and writes off', () => {
    const bodyOps = [
      { ...op('POST', '/v2.0/Things', 'CreateThing'), requestBodies: { 'application/json': { type: 'object', required: ['name'], properties: { name: { type: 'string' } }, additionalProperties: false } } },
      { ...op('PATCH', '/v2.0/Things/{id}', 'UpdateThing'), requestBodies: { 'application/json-patch+json': {} } },
      { ...op('DELETE', '/v2.0/Things/{id}', 'DeleteThing'), returnsBody: false },
      { ...op('POST', '/v2.0/Things/{id}/Reset', 'ResetThing'), returnsBody: false, bodyRequired: false, requestBodies: { 'application/json-patch+json': {} } },
    ];
    // A stand-in validator: object schema → required + additionalProperties; patch → RFC 6902 shape.
    const validate = (o: ApiOperation, contentType: string, body: string): string[] => {
      if (body === '' && !o.bodyRequired) return [];
      const type = o.requestBodies[contentType] ? contentType : Object.keys(o.requestBodies)[0];
      const data = body ? JSON.parse(body) : undefined;
      if (type === 'application/json-patch+json') return jsonPatchProblems(data);
      return data && typeof data.name === 'string' && Object.keys(data).length === 1 ? [] : ['invalid'];
    };
    const table = { create_thing: ['CreateThing'], update_thing: ['UpdateThing'], delete_thing: ['DeleteThing'], reset_thing: ['ResetThing'] };
    const run = (calls: WriteCall[]) => checkBodies({ release: '26R1', server: 'demo-server', domain: 'demo', table, calls, marker: 'MARK', validate, operations: bodyOps })
      .map((x) => `${x.check} ${x.tool} ${x.detail}`);
    const req = (method: string, path: string, contentType: string | null, body: string) => ({ method, path, contentType, body });

    it('accepts a valid body with the declared content type, and a returned answer', () => {
      expect(run([
        { tool: 'create_thing', result: '{"guardMarker":"MARK"}', requests: [req('POST', '/demo/v2.0/Things', 'application/json; charset=utf-8', '{"name":"x"}')] },
        { tool: 'update_thing', result: 'MARK', requests: [req('PATCH', '/demo/v2.0/Things/1', 'application/json-patch+json', '[{"op":"replace","path":"/name","value":"y"}]')] },
        { tool: 'delete_thing', result: 'Deleted.', requests: [req('DELETE', '/demo/v2.0/Things/1', null, '')] },
      ])).toEqual([]);
    });

    it('reports a wrong content type, an invalid body, a body where none is declared, and a dropped answer', () => {
      expect(run([
        { tool: 'update_thing', result: 'MARK', requests: [req('PATCH', '/demo/v2.0/Things/1', 'application/json', '{"name":"y"}')] },
        { tool: 'create_thing', result: 'Created.', requests: [req('POST', '/demo/v2.0/Things', 'application/json', '{"Name":"x","extra":1}')] },
        { tool: 'delete_thing', result: 'Deleted.', requests: [req('DELETE', '/demo/v2.0/Things/1', 'application/json', '{"id":"1"}')] },
      ])).toEqual([
        'body-content-type update_thing application/json',
        'body-invalid update_thing -',
        'body-invalid create_thing -',
        'response-dropped create_thing -',
        'body-undeclared delete_thing -',
      ]);
    });

    it('reports a request other than GET with writes off', () => {
      expect(checkWritesOff('26R1', 'demo-server', [
        { tool: 'list_things', requests: [{ method: 'GET' }] },
        { tool: 'delete_thing', requests: [{ method: 'DELETE' }, { method: 'DELETE' }] },
      ]).map(keyOf)).toEqual(['write-with-writes-off 26R1 demo-server delete_thing DELETE']);
    });

    it('JSON Patch: accepts any value type, rejects a non-array and unknown operations', () => {
      expect(jsonPatchProblems([{ op: 'replace', path: '/comment', value: 'text' }, { op: 'Remove', path: '/x' }])).toEqual([]);
      expect(jsonPatchProblems({ comment: 'text' })).toEqual(['not a JSON Patch array']);
      expect(jsonPatchProblems([{ op: 'merge', path: 'x' }])).toEqual(['/0/op is not a JSON Patch operation', '/0/path must start with "/"']);
    });

    it('validates against the real 26R1 spec, including OpenAPI nullable', () => {
      const real = bodyValidator('26R1');
      const createFolder = loadOperations('26R1').find((o) => o.domain === 'assets' && o.operationId === 'CreateAssetStockFolder');
      expect(createFolder, 'CreateAssetStockFolder not in the 26R1 assets spec').toBeDefined();
      const schemaName = Object.keys(createFolder!.requestBodies)[0];
      expect(schemaName).toBe('application/json');
      expect(real(createFolder!, 'application/json', '{"name":"Folder","parentId":null}')).toEqual([]);
      expect(real(createFolder!, 'application/json', '{"name":42}').length).toBeGreaterThan(0);
      expect(real(createFolder!, 'application/json', 'not json')).toEqual(['body is not JSON']);
    });

    it('validates JSON Patch routes with the real 26R1 spec, also when sent as application/json', () => {
      const real = bodyValidator('26R1');
      const find = (domain: string, id: string) => loadOperations('26R1').find((o) => o.domain === domain && o.operationId === id)!;
      const updateAsset = find('assets', 'UpdateAsset');
      expect(real(updateAsset, 'application/json-patch+json', '[{"op":"replace","path":"/name","value":"text"}]')).toEqual([]);
      // Wrong content type: still checked as the declared JSON Patch, not skipped.
      expect(real(updateAsset, 'application/json', '{"name":"text"}')).toEqual(['not a JSON Patch array']);
      // Empty body: an error where the body is required, fine where it is optional.
      expect(real(updateAsset, 'application/json-patch+json', '')).toEqual(['not a JSON Patch array']);
      const updatePin = find('defensecontrol', 'UpdateBitLockerPinByWindowsEndpointId');
      expect(updatePin.bodyRequired).toBe(false);
      expect(real(updatePin, 'application/json-patch+json', '')).toEqual([]);
      // guid is a real format; sample values may skip format checks.
      const createFolder = find('assets', 'CreateAssetStockFolder');
      expect(real(createFolder, 'application/json', '{"name":"F","parentId":"not-a-guid"}').length).toBeGreaterThan(0);
      expect(real(createFolder, 'application/json', '{"name":"F","parentId":"not-a-guid"}', { ignoreFormats: true })).toEqual([]);
    });

    it('reports no content type problem when no body is sent, and a PATCH with writes off', () => {
      expect(run([{ tool: 'delete_thing', result: 'Deleted.', requests: [req('DELETE', '/demo/v2.0/Things/1', 'application/json', '')] }])).toEqual([]);
      // Optional body declared, none sent: a default content type header is not a finding.
      expect(run([{ tool: 'reset_thing', result: 'Reset.', requests: [req('POST', '/demo/v2.0/Things/1/Reset', 'application/json', '')] }])).toEqual([]);
      expect(checkWritesOff('26R1', 'demo-server', [{ tool: 'update_thing', requests: [{ method: 'PATCH' }] }]).map((x) => x.detail)).toEqual(['PATCH']);
    });

    it('skips the response check for calls without a result, and accepts a returned field', () => {
      const create = (result?: string): WriteCall => ({ tool: 'create_thing', result, requests: [req('POST', '/demo/v2.0/Things', 'application/json', '{"name":"x"}')] });
      expect(run([create(undefined)])).toEqual([]);
      expect(run([create('Created thing MARK.')])).toEqual([]);
    });
  });

  it('ratchets: new, stale and untriaged baseline entries are reported', () => {
    const observed: Violation[] = [{ check: 'route', release: '26R1', server: 's', tool: 't', detail: 'GET /x' }];
    expect(compareWithBaseline(observed, { 'route 26R1 s t GET /old': 12, 'coverage 26R1 d - X': 0 })).toEqual({
      new: ['route 26R1 s t GET /x'],
      stale: ['coverage 26R1 d - X', 'route 26R1 s t GET /old'],
      untriaged: ['coverage 26R1 d - X'],
    });
  });
});
