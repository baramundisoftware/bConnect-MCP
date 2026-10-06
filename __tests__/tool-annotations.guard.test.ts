/**
 * Every tool declares its MCP tool annotations (REQ-SRV-024, #296).
 *
 * The expected hints are derived here, for both bMS releases, from each
 * server's src/operations.ts and the bundled spec, never from a hand list:
 * - only GET → readOnlyHint true, no destructiveHint (the spec ignores it there);
 * - anything else → readOnlyHint false, and destructiveHint true for any DELETE
 *   or a tool in DESTRUCTIVE_WRITE_TOOLS (each with its reason), false otherwise.
 * A tool whose operation only the other release's spec has uses that spec, as
 * the query-parameter tables do. Two more checks need no spec: the traffic
 * (a tool that sends anything but GET is not read-only, one that sends DELETE is
 * destructive) and the write gate (with writes off, exactly the tools that
 * aren't read-only are refused), so the hint and the gate can't drift apart.
 *
 * The derivation is proven on known-bad fixtures below.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DESTRUCTIVE_WRITE_TOOLS, toolTitle } from '../packages/mcp-core/src/tool-annotations.js';
import { RELEASES, type Release, loadOperations } from './lib/spec.js';
import { ROOT, SERVERS, connect, createRecorder, domainOf, guardEnv, requiredArguments } from './lib/exerciser.js';

const ALLOWED_KEYS = ['title', 'readOnlyHint', 'destructiveHint'];
const WRITE_GATE = /is disabled\. Set ALLOW_WRITE_OPERATIONS=true/;

/** The HTTP methods of a tool's operations in one release: the server's own spec first, then any. */
function methodsIn(release: Release, domain: string, ids: readonly string[]): string[] {
  const ops = loadOperations(release);
  return ids.flatMap((id) => {
    const all = ops.filter((o) => o.operationId === id);
    const own = all.filter((o) => o.domain === domain);
    return (own.length > 0 ? own : all).map((o) => o.method);
  });
}

/** The tool's methods for `release`, or the other release's when this one's spec lacks the operations. */
function methodsOf(release: Release, domain: string, ids: readonly string[]): string[] {
  const here = methodsIn(release, domain, ids);
  return here.length > 0 ? here : methodsIn(release === '25R2' ? '26R1' : '25R2', domain, ids);
}

/** What is wrong with a tool's annotations, given the methods it calls; empty when nothing is. */
function annotationProblems(name: string, annotations: Record<string, unknown> | undefined, methods: readonly string[]): string[] {
  if (methods.length === 0) return [`${name}: no operation in either spec`];
  if (!annotations) return [`${name}: no annotations`];
  const problems: string[] = [];
  const readOnly = methods.every((m) => m === 'GET');
  const destructive = methods.includes('DELETE') || DESTRUCTIVE_WRITE_TOOLS.has(name);
  const extra = Object.keys(annotations).filter((k) => !ALLOWED_KEYS.includes(k));
  if (extra.length > 0) problems.push(`${name}: unexpected ${extra.join(', ')}`);
  if (typeof annotations.title !== 'string' || annotations.title.trim() === '') problems.push(`${name}: no title`);
  if (annotations.readOnlyHint !== readOnly) problems.push(`${name}: readOnlyHint ${String(annotations.readOnlyHint)}, calls ${methods.join(', ')}`);
  if (readOnly && 'destructiveHint' in annotations) problems.push(`${name}: destructiveHint on a read-only tool`);
  if (!readOnly && annotations.destructiveHint !== destructive) problems.push(`${name}: destructiveHint ${String(annotations.destructiveHint)}, expected ${String(destructive)}`);
  return problems;
}

describe('annotationProblems (known-bad fixtures)', () => {
  const read = { title: 'List things', readOnlyHint: true };
  const write = { title: 'Create thing', readOnlyHint: false, destructiveHint: false };
  const del = { title: 'Delete thing', readOnlyHint: false, destructiveHint: true };

  it('accepts correct annotations', () => {
    expect(annotationProblems('list_things', read, ['GET'])).toEqual([]);
    expect(annotationProblems('create_thing', write, ['POST'])).toEqual([]);
    expect(annotationProblems('delete_thing', del, ['DELETE'])).toEqual([]);
    expect(annotationProblems('msw_cleanup', { ...del, title: 'MSW cleanup' }, ['POST'])).toEqual([]);
  });

  it('flags a read-only tool that sends a non-GET request', () => {
    expect(annotationProblems('create_thing', read, ['POST'])).toContainEqual(expect.stringContaining('readOnlyHint true, calls POST'));
    expect(annotationProblems('create_thing', read, ['GET', 'POST'])).toContainEqual(expect.stringContaining('readOnlyHint true, calls GET, POST'));
  });

  it('flags a DELETE tool not marked destructive, and a listed destructive write marked harmless', () => {
    expect(annotationProblems('delete_thing', write, ['DELETE'])).toHaveLength(1);
    expect(annotationProblems('msw_cleanup', write, ['POST'])).toHaveLength(1);
  });

  it('flags a write marked destructive without a DELETE or a reason', () => {
    expect(annotationProblems('create_thing', del, ['POST'])).toHaveLength(1);
  });

  it('flags a read tool marked as a write, a destructive hint on a read, and a missing hint', () => {
    expect(annotationProblems('list_things', write, ['GET'])).toHaveLength(2);
    expect(annotationProblems('list_things', { ...read, destructiveHint: false }, ['GET'])).toHaveLength(1);
    expect(annotationProblems('create_thing', { title: 'Create thing', readOnlyHint: false }, ['POST'])).toHaveLength(1);
  });

  it('flags missing annotations, a missing title, extra hints and a tool without operations', () => {
    expect(annotationProblems('list_things', undefined, ['GET'])).toHaveLength(1);
    expect(annotationProblems('list_things', { readOnlyHint: true }, ['GET'])).toHaveLength(1);
    expect(annotationProblems('list_things', { ...read, openWorldHint: true }, ['GET'])).toHaveLength(1);
    expect(annotationProblems('list_things', read, [])).toHaveLength(1);
  });
});

describe('DESTRUCTIVE_WRITE_TOOLS', () => {
  it('lists only tools that exist and are not read-only (in either release)', async () => {
    const writes = new Set<string>();
    for (const server of SERVERS) {
      const { TOOL_OPERATIONS } = await import(pathToFileURL(join(ROOT, server, 'src', 'operations.ts')).href);
      for (const [tool, ids] of Object.entries<readonly string[]>(TOOL_OPERATIONS)) {
        if (RELEASES.some((r) => methodsOf(r, domainOf(server), ids).some((m) => m !== 'GET'))) writes.add(tool);
      }
    }
    expect([...DESTRUCTIVE_WRITE_TOOLS.keys()].filter((t) => !writes.has(t))).toEqual([]);
  });
});

describe('generated method tables', () => {
  it.each(SERVERS)('%s has src/tool-methods.ts with every tool of src/operations.ts', async (server) => {
    const file = join(ROOT, server, 'src', 'tool-methods.ts');
    expect(existsSync(file), `${file} missing; run node scripts/generate-query-parameters.mjs`).toBe(true);
    expect(readFileSync(file, 'utf8')).toMatch(/GENERATED by scripts\/generate-query-parameters\.mjs/);
    const { TOOL_METHODS } = await import(pathToFileURL(file).href);
    const { TOOL_OPERATIONS } = await import(pathToFileURL(join(ROOT, server, 'src', 'operations.ts')).href);
    expect(Object.keys(TOOL_METHODS).sort()).toEqual(Object.keys(TOOL_OPERATIONS).sort());
  });
});

const recorder = createRecorder();
const saved = { ...process.env };
beforeAll(() => recorder.listen());
afterAll(() => { recorder.close(); process.env = saved; });

describe.each(RELEASES)('bMS %s', (release) => {
  interface Seen { server: string; tool: string; annotations?: Record<string, unknown>; methods: string[]; sent: string[]; gated: boolean }
  const seen: Seen[] = [];

  beforeAll(async () => {
    for (const server of SERVERS) {
      const { TOOL_OPERATIONS } = await import(pathToFileURL(join(ROOT, server, 'src', 'operations.ts')).href);
      Object.assign(process.env, guardEnv(release, { writes: true, secretRead: true }));
      const conn = await connect(server);
      for (const tool of conn.tools) {
        const args = requiredArguments(tool.inputSchema);
        // The gate reads ALLOW_WRITE_OPERATIONS on each call.
        Object.assign(process.env, guardEnv(release, { writes: true, secretRead: true }));
        recorder.take();
        await conn.call(tool.name, args);
        const sent = recorder.take().map((r) => r.method);
        Object.assign(process.env, guardEnv(release, { writes: false, secretRead: true }));
        const { text } = await conn.call(tool.name, args);
        recorder.take();
        seen.push({
          server, tool: tool.name, sent, gated: WRITE_GATE.test(text),
          annotations: (tool as { annotations?: Record<string, unknown> }).annotations,
          methods: methodsOf(release, domainOf(server), TOOL_OPERATIONS[tool.name] ?? []),
        });
      }
      await conn.close();
    }
  }, 300_000);

  it('lists every tool of every server', () => {
    expect(seen.length).toBeGreaterThan(200);
  });

  it('annotates every tool as its operations say (title, readOnlyHint, destructiveHint on writes)', () => {
    expect(seen.flatMap((s) => annotationProblems(s.tool, s.annotations, s.methods).map((p) => `${s.server} ${p}`))).toEqual([]);
  });

  it('agrees with the traffic: a tool that sends anything but GET is not read-only, one that sends DELETE is destructive', () => {
    const wrong = seen.filter((s) => (s.sent.some((m) => m !== 'GET') && s.annotations?.readOnlyHint !== false)
      || (s.sent.includes('DELETE') && s.annotations?.destructiveHint !== true));
    expect(wrong.map((s) => `${s.server} ${s.tool} sent ${s.sent.join(', ')}`)).toEqual([]);
  });

  it('agrees with the write gate: with writes off, exactly the tools that are not read-only are refused', () => {
    const wrong = seen.filter((s) => s.gated !== (s.annotations?.readOnlyHint === false));
    expect(wrong.map((s) => `${s.server} ${s.tool} gated=${s.gated} readOnlyHint=${String(s.annotations?.readOnlyHint)}`)).toEqual([]);
  });

  it('gives every tool a title unique within its server, the one derived from its name', () => {
    for (const server of SERVERS) {
      const titles = seen.filter((s) => s.server === server).map((s) => s.annotations?.title);
      expect(new Set(titles).size, server).toBe(titles.length);
    }
    expect(seen.filter((s) => s.annotations?.title !== toolTitle(s.tool)).map((s) => s.tool)).toEqual([]);
  });

});
