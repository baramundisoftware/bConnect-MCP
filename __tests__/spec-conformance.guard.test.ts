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
  ID, ROOT, SERVERS, connect, createRecorder, domainOf, guardEnv, requiredArguments,
} from './lib/exerciser.js';
import {
  type Baseline, type Violation, checkCoverage, checkStaleBindings, checkTools, compareWithBaseline, keyOf,
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
    for (const tool of conn.tools) {
      recorder.take();
      await conn.call(tool.name, requiredArguments(tool.inputSchema));
      // The sample GUID becomes {id}, so baseline keys read like routes.
      exercised.push({ tool: tool.name, requests: recorder.take().map((r) => ({ method: r.method, path: r.path.split(ID).join('{id}') })) });
    }
    await conn.close();
    registered.set(server, new Set(conn.tools.map((t) => t.name)));
    const covered = coveredByDomain.get(domain) ?? new Set<string>();
    coveredByDomain.set(domain, covered);
    violations.push(...checkTools({ release, server, domain, table, exercised, covered }));
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
  const op = (method: string, path: string, operationId: string): ApiOperation => {
    const pattern = new RegExp('^' + path.replace(/\{[^}]+\}/g, '[^/]+') + '/?$');
    return {
      release: '26R1', domain: 'demo', method, path, operationId, summary: '', secretFields: [], queryParams: [],
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

  it('ratchets: new, stale and untriaged baseline entries are reported', () => {
    const observed: Violation[] = [{ check: 'route', release: '26R1', server: 's', tool: 't', detail: 'GET /x' }];
    expect(compareWithBaseline(observed, { 'route 26R1 s t GET /old': 12, 'coverage 26R1 d - X': 0 })).toEqual({
      new: ['route 26R1 s t GET /x'],
      stale: ['coverage 26R1 d - X', 'route 26R1 s t GET /old'],
      untriaged: ['coverage 26R1 d - X'],
    });
  });
});
