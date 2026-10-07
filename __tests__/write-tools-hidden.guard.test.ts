/**
 * With writes off, tools/list shows only read tools (REQ-SRV-026, #156).
 *
 * For both bMS releases, every server is listed with ALLOW_WRITE_OPERATIONS off
 * and on. The classification is derived here from each server's
 * src/operations.ts and the bundled specs (as tool-annotations.guard.test.ts
 * does), and from the traffic, never from a hand list:
 * - writes off: no listed tool calls a non-GET operation in either spec, and
 *   none sends anything but GET even when writes are on;
 * - writes on: every tool is listed, and the reads are listed unchanged;
 * - a hidden tool called by name gets exactly today's answers: the write-gate
 *   refusal (nothing sent), and InvalidParams for an undeclared argument;
 * - the write gate refuses exactly the tools the core's toolEffect calls
 *   writes, and exactly those are hidden, so the list and the gate can't drift.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { toolEffect } from '../packages/mcp-core/src/tool-annotations.js';
import { RELEASES, loadOperations } from './lib/spec.js';
import { ROOT, SERVERS, connect, createRecorder, domainOf, guardEnv, requiredArguments } from './lib/exerciser.js';

/**
 * Tools listed per release: all of them with writes on, the reads with writes off (measured on d208ab0;
 * since #159 without the tools whose routes the release lacks: 26R1 −8 (5 reads), 25R2 −10 (8 reads);
 * since #174 one tool per endpoint operation: 26R1 −29 (15 reads), 25R2 −33 (17 reads); and per groups
 * operation: 26R1 30 → 2, 25R2 33 → 2 (all reads)).
 */
const COUNTS = { '26R1': { on: 211, off: 130 }, '25R2': { on: 166, off: 100 } } as const;

/** Read tools per server on 26R1 (listed with writes off); the 4 servers without write tools are absent. */
const READS_26R1: Record<string, number> = {
  'bconnect-assets-mcp': 15, 'bconnect-defensecontrol-mcp': 10, 'bconnect-endpoints-mcp': 10, 'bconnect-jobs-mcp': 20,
  'bconnect-operatingsystems-mcp': 5, 'bconnect-servermanagement-mcp': 16, 'bconnect-software-mcp': 11,
  'bconnect-updatemanagement-mcp': 2, 'bconnect-variables-mcp': 9,
};

const refusal = (tool: string): string => JSON.stringify([{
  type: 'text', text: `Write operation '${tool}' is disabled. Set ALLOW_WRITE_OPERATIONS=true to enable write operations.`,
}]);

/** A tool's operationIds; a merged tool's are those of all its variants (REQ-SRV-029). */
const idsOf = (operations: Record<string, string[]>, tool: string): string[] =>
  operations[tool] ?? Object.entries(operations).filter(([key]) => key.startsWith(`${tool}[`)).flatMap(([, ids]) => ids);

/** The HTTP methods of a tool's operations in both releases: the server's own spec first, then any. */
function methodsOf(domain: string, ids: readonly string[]): string[] {
  return RELEASES.flatMap((release) => {
    const ops = loadOperations(release);
    return ids.flatMap((id) => {
      const all = ops.filter((o) => o.operationId === id);
      const own = all.filter((o) => o.domain === domain);
      return (own.length > 0 ? own : all).map((o) => o.method);
    });
  });
}

const recorder = createRecorder();
const saved = { ...process.env };
beforeAll(() => recorder.listen());
afterAll(() => { recorder.close(); process.env = saved; });

describe.each(RELEASES)('bMS %s', (release) => {
  interface Listed { name: string; inputSchema: Record<string, unknown> }
  interface Seen {
    server: string;
    on: Listed[];
    off: Listed[];
    /** Per tool listed with writes off: the methods its operations use, and what it sent with writes on. */
    reads: Array<{ tool: string; methods: string[]; sent: string[] }>;
    /** Per tool listed with writes on, called with writes off: refused by the write gate? */
    gated: Array<{ tool: string; gated: boolean; sent: number }>;
    /** Per tool hidden with writes off: today's answers when called by name. */
    hidden: Array<{ tool: string; text: string; sent: number; undeclared: { code?: number; text: string } }>;
    effect: Record<string, string>;
  }
  const seen: Seen[] = [];
  const env = (writes: boolean) => Object.assign(process.env, guardEnv(release, { writes, secretRead: true }));

  beforeAll(async () => {
    for (const server of SERVERS) {
      const { TOOL_OPERATIONS } = await import(pathToFileURL(join(ROOT, server, 'src', 'operations.ts')).href);
      const { TOOL_METHODS } = await import(pathToFileURL(join(ROOT, server, 'src', 'tool-methods.ts')).href);
      env(true);
      const conn = await connect(server);
      const on = await conn.list();
      env(false);
      const off = await conn.list();
      const entry: Seen = { server, on, off, reads: [], gated: [], hidden: [], effect: {} };
      for (const tool of on) {
        entry.effect[tool.name] = toolEffect(tool.name, TOOL_METHODS[tool.name] ?? []);
        const args = requiredArguments(tool.inputSchema);
        env(false);
        recorder.take();
        const { text } = await conn.call(tool.name, args);
        const sentOff = recorder.take().length;
        entry.gated.push({ tool: tool.name, gated: text === refusal(tool.name), sent: sentOff });
        if (off.some((t) => t.name === tool.name)) {
          // The gate reads ALLOW_WRITE_OPERATIONS on each call: with writes on, a listed tool still only reads.
          env(true);
          await conn.call(tool.name, args);
          entry.reads.push({
            tool: tool.name, sent: recorder.take().map((r) => r.method),
            methods: methodsOf(domainOf(server), idsOf(TOOL_OPERATIONS, tool.name)),
          });
        } else {
          env(false);
          const undeclared = await conn.call(tool.name, { ...args, notDeclared: 'x' });
          recorder.take();
          entry.hidden.push({ tool: tool.name, text, sent: sentOff, undeclared });
        }
      }
      await conn.close();
      seen.push(entry);
    }
  }, 300_000);

  it('lists every tool with writes on, and only the read tools with writes off', () => {
    expect(seen.reduce((n, s) => n + s.on.length, 0)).toBe(COUNTS[release].on);
    expect(seen.reduce((n, s) => n + s.off.length, 0)).toBe(COUNTS[release].off);
  });

  it.runIf(release === '26R1')('lists the expected number of read tools per server with writes off', () => {
    const counts = Object.fromEntries(seen.filter((s) => s.off.length !== s.on.length).map((s) => [s.server, s.off.length]));
    expect(counts).toEqual(READS_26R1);
  });

  it('with writes off, lists no tool whose operations use anything but GET, in either spec', () => {
    const wrong = seen.flatMap((s) => s.reads.filter((r) => r.methods.length === 0 || r.methods.some((m) => m !== 'GET'))
      .map((r) => `${s.server} ${r.tool} calls ${r.methods.join(', ') || 'no operation'}`));
    expect(wrong).toEqual([]);
  });

  it('with writes off, lists no tool that sends anything but GET (checked with writes on, so the gate does not hide it)', () => {
    const reads = seen.flatMap((s) => s.reads.map((r) => ({ ...r, server: s.server })));
    // Not vacuous: most listed tools send a request.
    expect(reads.filter((r) => r.sent.length > 0).length).toBeGreaterThan(COUNTS[release].off * 0.8);
    expect(reads.filter((r) => r.sent.some((m) => m !== 'GET')).map((r) => `${r.server} ${r.tool} sent ${r.sent.join(', ')}`)).toEqual([]);
  });

  it('with writes off, lists every read tool exactly as with writes on', () => {
    for (const s of seen) {
      const reads = s.on.filter((t) => s.effect[t.name] === 'read');
      expect(JSON.stringify(s.off), s.server).toBe(JSON.stringify(reads));
    }
  });

  it('servers without write tools list the same tools either way', () => {
    const readOnly = seen.filter((s) => Object.values(s.effect).every((e) => e === 'read'));
    // These four have no write tools at all (they don't wrap their list); on 25R2 software lists none either.
    expect(readOnly.map((s) => s.server)).toEqual(expect.arrayContaining([
      'bconnect-activedirectory-mcp', 'bconnect-compliance-mcp', 'bconnect-groups-mcp', 'bconnect-universaldynamicgroups-mcp',
    ]));
    for (const s of readOnly) expect(JSON.stringify(s.off), s.server).toBe(JSON.stringify(s.on));
  });

  it('the write gate refuses exactly the tools toolEffect calls writes, and exactly those are hidden', () => {
    const wrong = seen.flatMap((s) => s.gated
      .filter((g) => g.gated !== (s.effect[g.tool] !== 'read'))
      .map((g) => `${s.server} ${g.tool} gated=${g.gated} effect=${s.effect[g.tool]}`));
    expect(wrong).toEqual([]);
    const hiddenWrong = seen.flatMap((s) => s.gated
      .filter((g) => g.gated !== s.hidden.some((h) => h.tool === g.tool))
      .map((g) => `${s.server} ${g.tool} gated=${g.gated} hidden=${String(!g.gated)}`));
    expect(hiddenWrong).toEqual([]);
  });

  it('a hidden tool called by name is refused with exactly the write-gate message, and sends nothing', () => {
    const hidden = seen.flatMap((s) => s.hidden.map((h) => ({ ...h, server: s.server })));
    expect(hidden.length).toBe(COUNTS[release].on - COUNTS[release].off);
    expect(hidden.filter((h) => h.text !== refusal(h.tool) || h.sent !== 0).map((h) => `${h.server} ${h.tool}: ${h.text}`)).toEqual([]);
  });

  it('a hidden tool called with an undeclared argument still gets InvalidParams, as today', () => {
    const hidden = seen.flatMap((s) => s.hidden.map((h) => ({ ...h, server: s.server })));
    expect(hidden.filter((h) => h.undeclared.code !== -32602 || !/Unknown argument for .*: notDeclared/.test(h.undeclared.text))
      .map((h) => `${h.server} ${h.tool}: ${String(h.undeclared.code)} ${h.undeclared.text}`)).toEqual([]);
  });
});
