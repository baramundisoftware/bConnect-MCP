/**
 * Each release lists exactly the tools whose routes it has (REQ-SRV-028 AC 5, #159, ADR-0014).
 *
 * Derived here from the bundled specs and each server's src/operations.ts,
 * never from a hand list: a tool is available in a release when each of its
 * operations exists there with the method and path the tool calls — the
 * newest release's route (26R1's), else 25R2's; the server's own spec first,
 * as the generator does. For both releases and all 13 servers:
 * - the generated src/tool-releases.ts says exactly that;
 * - tools/list (writes on, so every tool could be listed) shows exactly the
 *   available tools;
 * - a tool the release lacks, called by name, is refused with a message naming
 *   the release in use, and sends nothing.
 * Whether a listed tool's requests match the release's spec is checked by
 * spec-conformance.guard.test.ts, whose baseline no longer excuses route drift.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RELEASES, loadOperations, type Release } from './lib/spec.js';
import { ROOT, SERVERS, connect, createRecorder, guardEnv, requiredArguments, type JsonSchema } from './lib/exerciser.js';
import { describeVariant, selectorArguments, variantOf } from './lib/variants.js';

/** Tools a release lacks, all servers (bundled specs): on 25R2 the 36 hidden by hand before #159 plus 10 (compliance 8, maintenance-window updates 2); on 26R1 8 (industrial endpoints). */
const HIDDEN = { '25R2': 46, '26R1': 8 } as const;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const isVariant = (key: string): boolean => variantOf(key).tool !== key;

/**
 * Per tool, and per variant of a merged tool (REQ-SRV-029): the releases in which every
 * operation exists with the route the tool calls. A merged tool is in every release one of
 * its variants is in.
 */
function availability(server: string, operations: Record<string, string[]>): Record<string, Release[]> {
  const domain = server.replace(/^bconnect-|-mcp$/g, '');
  const opsOf = (release: Release, id: string) => {
    const all = loadOperations(release).filter((o) => o.operationId === id);
    const own = all.filter((o) => o.domain === domain);
    return own.length ? own : all;
  };
  const perKey: Record<string, Release[]> = Object.fromEntries(Object.entries(operations).map(([tool, ids]) => {
    const releases = RELEASES.filter((release) => ids.every((id) => {
      const called = opsOf('26R1', id).length ? opsOf('26R1', id) : opsOf('25R2', id);
      return called.length > 0 && opsOf(release, id).some((o) => called.some((c) => c.domain === o.domain && c.method === o.method && c.path === o.path));
    }));
    return [tool, [...releases].sort()];
  }));
  const out: Record<string, Release[]> = { ...perKey };
  for (const [key, releases] of Object.entries(perKey)) {
    const { tool } = variantOf(key);
    if (tool !== key) {out[tool] = [...new Set([...(out[tool] ?? []), ...releases])].sort() as Release[];}
  }
  return out;
}

/** The keys of operations.ts: tools, and variants of merged tools. */
const isMergedTool = (operations: Record<string, string[]>, name: string): boolean => !operations[name] && Object.keys(operations).some((k) => variantOf(k).tool === name);

const recorder = createRecorder(() => ({ data: [], totalItems: 0 }));
const saved = { ...process.env };
beforeAll(() => recorder.listen());
afterAll(() => { recorder.close(); process.env = saved; });

interface Seen {
  server: string;
  expected: Record<string, Release[]>;
  generated: Record<string, readonly string[]> | undefined;
  listed: Record<Release, string[]>;
  operations: Record<string, string[]>;
  refused: Array<{ release: Release; tool: string; code?: number; text: string; sent: number; undeclaredCode?: number }>;
}
const seen: Seen[] = [];

beforeAll(async () => {
  for (const server of SERVERS) {
    const { TOOL_OPERATIONS } = await import(pathToFileURL(join(ROOT, server, 'src', 'operations.ts')).href);
    const generated = await import(pathToFileURL(join(ROOT, server, 'src', 'tool-releases.ts')).href)
      .then((m: { TOOL_RELEASES?: Record<string, readonly string[]> }) => m.TOOL_RELEASES, () => undefined);
    const entry: Seen = { server, expected: availability(server, TOOL_OPERATIONS), generated, listed: { '25R2': [], '26R1': [] }, operations: TOOL_OPERATIONS, refused: [] };
    const schemas: Record<string, JsonSchema> = {};
    const conns = [];
    for (const release of RELEASES) {
      Object.assign(process.env, guardEnv(release, { writes: true, secretRead: true }));
      const conn = await connect(server);
      entry.listed[release] = conn.tools.map((t) => t.name).sort();
      for (const t of conn.tools) {schemas[t.name] ??= t.inputSchema;}
      conns.push({ release, conn });
    }
    for (const { release, conn } of conns) {
      Object.assign(process.env, guardEnv(release, { writes: true, secretRead: true }));
      for (const tool of Object.keys(TOOL_OPERATIONS).filter((t) => !entry.expected[t].includes(release))) {
        // A variant is called through its merged tool, with its selector values.
        const name = variantOf(tool).tool;
        const args = { ...requiredArguments(schemas[name] ?? {}), ...selectorArguments(tool) };
        recorder.take();
        const r = await conn.call(name, args);
        const undeclared = await conn.call(name, { ...args, notDeclared: 'x' });
        entry.refused.push({ release, tool, code: r.code, text: r.text, sent: recorder.take().length, undeclaredCode: undeclared.code });
      }
      await conn.close();
    }
    seen.push(entry);
  }
}, 300_000);

describe('tools per release from the spec', () => {
  it('every server has a generated src/tool-releases.ts that matches the specs', () => {
    const wrong = seen.filter((s) => JSON.stringify(s.generated) !== JSON.stringify(s.expected)).map((s) => s.server);
    expect(wrong).toEqual([]);
  });

  it.each(RELEASES)('bMS %s lists exactly the tools whose routes it has', (release) => {
    const wrong = seen.flatMap((s) => {
      const want = Object.keys(s.expected).filter((t) => variantOf(t).tool === t && s.expected[t].includes(release)).sort();
      return JSON.stringify(s.listed[release]) === JSON.stringify(want) ? [] : [`${s.server}: listed ${s.listed[release].filter((t) => !want.includes(t)).join(',') || '-'} / missing ${want.filter((t) => !s.listed[release].includes(t)).join(',') || '-'}`];
    });
    expect(wrong).toEqual([]);
  });

  // Hand-picked cases, so a wrong rule in both the generator and availability() above can't pass;
  // spec-conformance.guard.test.ts checks the traffic of every listed tool independently.
  it.each([
    ['bconnect-endpoints-mcp', 'update_maintenance_window_for_endpoint', ['26R1']], // PUT in 25R2, the tool sends PATCH
    ['bconnect-endpoints-mcp', 'list_endpoints[type=IndustrialEndpoint]', ['25R2']], // removed in 26R1
    ['bconnect-endpoints-mcp', 'list_endpoints', ['25R2', '26R1']], // merged: in every release one of its variants is in
    ['bconnect-groups-mcp', 'list_industrial_endpoints_by_static_group', ['25R2']],
    ['bconnect-compliance-mcp', 'list_vulnerabilities', ['26R1']], // no 25R2 compliance spec
    ['bconnect-universaldynamicgroups-mcp', 'list_udg_folders', ['26R1']], // GetFolders exists in other 25R2 domains only
    ['bconnect-endpoints-mcp', 'list_endpoints[type=WindowsEndpoint]', ['25R2', '26R1']],
  ])('%s %s is available in %j', (server, tool, releases) => {
    expect(seen.find((s) => s.server === server)?.generated?.[tool]).toEqual(releases);
  });

  it.each(RELEASES)('bMS %s lacks the expected number of tools (not vacuous)', (release) => {
    expect(seen.flatMap((s) => Object.keys(s.expected).filter((t) => !isMergedTool(s.operations, t) && !s.expected[t].includes(release))).length).toBe(HIDDEN[release]);
  });

  it('a tool the release lacks is refused before its arguments are checked (no InvalidParams for a schema it does not list)', () => {
    expect(seen.flatMap((s) => s.refused.filter((r) => r.undeclaredCode !== (isVariant(r.tool) ? INVALID_PARAMS : METHOD_NOT_FOUND)).map((r) => `${s.server} ${r.release} ${r.tool}: ${r.undeclaredCode}`))).toEqual([]);
  });

  it('a tool the release lacks is refused by name, naming the release in use, and sends nothing', () => {
    expect(seen.flatMap((s) => s.refused).length).toBe(HIDDEN['25R2'] + HIDDEN['26R1']);
    // A tool is refused by name (MethodNotFound); a variant by its argument (InvalidParams), e.g.
    // "list_endpoints with type "IndustrialEndpoint" is only available in bMS 25R2; …".
    const named = (tool: string) => (isVariant(tool) ? `${variantOf(tool).tool} with ${describeVariant(variantOf(tool).select)}` : tool);
    const wrong = seen.flatMap((s) => s.refused.filter((r) => r.code !== (isVariant(r.tool) ? INVALID_PARAMS : METHOD_NOT_FOUND) || r.sent !== 0
      || !r.text.includes(`${named(r.tool)} is only available in bMS ${s.expected[r.tool].join(' or ')}; this server uses ${r.release} (from BCONNECT_RELEASE).`))
      .map((r) => `${s.server} ${r.release} ${r.tool}: ${r.code} sent ${r.sent} ${r.text.slice(0, 140)}`));
    expect(wrong).toEqual([]);
  });
});
