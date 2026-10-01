/**
 * Spec-conformance guard (REQ-QA-001, ADR-0006).
 *
 * Every server declares, in src/operations.ts, the OpenAPI operation each tool
 * calls. This guard calls every tool of every server, for both bMS releases,
 * with all gates open and valid arguments, records the requests, and checks
 * them against the declared operation in that release's spec. It also checks
 * that every spec operation is reached by some tool's request.
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
import { RELEASES, type Release, type ApiOperation } from './lib/spec.js';
import {
  ID, ROOT, SERVERS, UNKNOWN_NAME, UNKNOWN_VALUE, allArguments, connect, createRecorder, domainOf, guardEnv, requiredArguments,
} from './lib/exerciser.js';
import {
  type Baseline, type ParamCall, type Violation,
  checkCoverage, checkParams, checkStaleBindings, checkTools, compareWithBaseline, keyOf,
} from './lib/conformance.js';

const BASELINE_PATH = join(ROOT, '__tests__', 'spec-conformance.baseline.json');
const baseline: Baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const mode = process.env.SPEC_BASELINE ?? '';
if (!['', 'prune', 'add-new'].includes(mode)) throw new Error(`SPEC_BASELINE must be prune or add-new, not '${mode}'`);

const recorder = createRecorder();
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
  for (const server of SERVERS) {
    const domain = domainOf(server);
    const table = await tableOf(server);
    const conn = await connect(server);
    const exercised = [];
    const paramCalls: ParamCall[] = [];
    for (const tool of conn.tools) {
      // Pass 1, required arguments: route checks.
      recorder.take();
      await conn.call(tool.name, requiredArguments(tool.inputSchema));
      // The sample GUID becomes {id}, so baseline keys read like routes.
      exercised.push({ tool: tool.name, requests: recorder.take().map((r) => ({ method: r.method, path: r.path.split(ID).join('{id}') })) });
      // Pass 2, every documented argument plus an undeclared one: parameter checks.
      const { args, idsByArg } = allArguments(tool.inputSchema);
      const { isError } = await conn.call(tool.name, args);
      paramCalls.push({
        tool: tool.name, inputSchema: tool.inputSchema, idsByArg,
        unknownName: UNKNOWN_NAME, unknownValue: UNKNOWN_VALUE, failed: isError,
        requests: recorder.take().map((r) => ({ method: r.method, path: r.path, query: r.query, body: r.body })),
      });
    }
    await conn.close();
    registered.set(server, new Set(conn.tools.map((t) => t.name)));
    const covered = coveredByDomain.get(domain) ?? new Set<string>();
    coveredByDomain.set(domain, covered);
    violations.push(...checkTools({ release, server, domain, table, exercised, covered }));
    violations.push(...checkParams({ release, server, domain, table, calls: paramCalls }));
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
      requestBodies: {}, returnsBody: true, spec: {},
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
    const call = (over: Partial<ParamCall>): ParamCall => ({
      tool: 'list_things_by_group', inputSchema: good, idsByArg: { groupId: G }, unknownName: 'zzUnknown', unknownValue: 'UNK', failed: false,
      requests: [{ method: 'GET', path: `/demo/v2.0/Groups/${G}/Things`, query: [['Page', '1'], ['Name', 'x']], body: '' }],
      ...over,
    });
    const run = (c: ParamCall, table: Record<string, string[]> = { list_things_by_group: ['GetThingsByGroup'], create_thing: ['CreateThing'] }) =>
      checkParams({ release: '26R1', server: 'demo-server', domain: 'demo', table, calls: [c], operations: paramOps })
        .map((x) => `${x.check} ${x.tool} ${x.detail}`);

    it('accepts a tool that offers and sends exactly what its operation declares', () => {
      expect(run(call({}))).toEqual([]);
    });

    it('reports an undeclared argument that reaches the query or the body', () => {
      expect(run(call({ requests: [{ method: 'GET', path: `/demo/v2.0/Groups/${G}/Things`, query: [['zz', 'UNK']], body: '' }] })))
        .toEqual(['arg-leak list_things_by_group -']);
      expect(run(call({ tool: 'create_thing', inputSchema: { properties: {} }, idsByArg: {}, requests: [{ method: 'POST', path: '/demo/v2.0/Things', query: [], body: '{"zz":"UNK"}' }] })))
        .toEqual(['arg-leak create_thing -']);
    });

    it('reports a query parameter the operation does not declare (e.g. a path ID repeated in the query)', () => {
      expect(run(call({ requests: [{ method: 'GET', path: `/demo/v2.0/Groups/${G}/Things`, query: [['groupId', G], ['includeSubGroups', 'true']], body: '' }] })))
        .toEqual(['query-undeclared list_things_by_group groupId', 'query-undeclared list_things_by_group includeSubGroups']);
    });

    it('reports a declared query parameter the tool does not offer', () => {
      const { Name: _dropped, ...props } = good.properties;
      const sendsPageOnly = [{ method: 'GET', path: `/demo/v2.0/Groups/${G}/Things`, query: [['Page', '1']] as Array<[string, string]>, body: '' }];
      expect(run(call({ inputSchema: { properties: props }, requests: sendsPageOnly }))).toEqual(['query-not-offered list_things_by_group Name']);
      // Offered under the tool's own argument name: sent, so not reported.
      expect(run(call({ inputSchema: { properties: { ...props, name: { type: 'string' } } } }))).toEqual([]);
    });

    it('reports a path slot filled by an argument whose name does not fit it', () => {
      expect(run(call({ inputSchema: { properties: { ...good.properties, endpointId: { type: 'string' } } }, idsByArg: { endpointId: G } })))
        .toEqual(['path-slot list_things_by_group {groupId} ← endpointId']);
    });

    it('reports an undeclared argument whose key reaches the wire with another value', () => {
      expect(run(call({ requests: [{ method: 'GET', path: `/demo/v2.0/Groups/${G}/Things`, query: [['zzUnknown', 'other']], body: '' }] })))
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

  it('ratchets: new, stale and untriaged baseline entries are reported', () => {
    const observed: Violation[] = [{ check: 'route', release: '26R1', server: 's', tool: 't', detail: 'GET /x' }];
    expect(compareWithBaseline(observed, { 'route 26R1 s t GET /old': 12, 'coverage 26R1 d - X': 0 })).toEqual({
      new: ['route 26R1 s t GET /x'],
      stale: ['coverage 26R1 d - X', 'route 26R1 s t GET /old'],
      untriaged: ['coverage 26R1 d - X'],
    });
  });
});
