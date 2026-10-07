/**
 * Every paged list tool answers "how many?" with countOnly (REQ-SRV-027, #165).
 *
 * For both bMS releases and all 13 servers, through the MCP client the way a
 * model calls them. Which tools must offer `countOnly` is derived here from the
 * bundled specs and each server's src/operations.ts, never from a hand list: a
 * listed tool whose GET operation has Page and PageSize and whose 200 answer has
 * totalItems. Like its other query parameters, a tool whose route only the other
 * release has takes that release's operation (#179).
 * - AC 1: each such tool, called with `countOnly: true`, sends exactly one
 *   request with Page=0 and PageSize=1 and returns only totalItems and the
 *   filters that were applied;
 * - AC 2: the count equals totalItems of a normal call against the same answer;
 * - AC 3: `countOnly` never appears in a request, with true or false;
 *   `countOnly: false` sends exactly the request of a call without it;
 * - AC 5: a tool that doesn't offer countOnly refuses it (InvalidParams), nothing sent.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RELEASES, loadOperations, type Schema } from './lib/spec.js';
import { ID, ROOT, SERVERS, connect, createRecorder, domainOf, guardEnv, requiredArguments, type RecordedRequest } from './lib/exerciser.js';

/**
 * Tools offering countOnly per release: the paged tools with a route in that release (bundled
 * specs). Since #159 a tool whose route only the other release has is not listed (it was, with
 * that release's parameters: +6 on 25R2, +4 on 26R1).
 */
const COUNTABLE = { '25R2': 105, '26R1': 119 } as const;
const TOTAL = 4242;
const INVALID_PARAMS = -32602;
/** Arguments that page or sort; everything else the caller gives is a filter. */
const NOT_FILTERS = new Set(['Page', 'PageSize', 'pageSize', 'OrderBy']);

const deref = (spec: Schema, s: Schema | undefined): Schema => {
  let x = s ?? {};
  if (Array.isArray(x.allOf) && x.allOf.length === 1) {x = x.allOf[0];}
  while (x && x.$ref) {x = x.$ref.replace(/^#\//, '').split('/').reduce((n: Schema, k: string) => n[k], spec);}
  return x;
};

/** The tools of `server` whose GET operation (own domain first) is paged and answers with totalItems. */
function countableTools(server: string, release: (typeof RELEASES)[number], operations: Record<string, string[]>): string[] {
  const getsIn = (r: (typeof RELEASES)[number], ids: string[]) => {
    const all = loadOperations(r).filter((o) => ids.includes(o.operationId) && o.method === 'GET');
    const own = all.filter((o) => o.domain === server.replace(/^bconnect-|-mcp$/g, ''));
    return own.length ? own : all;
  };
  const other = release === '25R2' ? '26R1' : '25R2';
  return Object.entries(operations).filter(([, ids]) => {
    const selected = getsIn(release, ids);
    const gets = selected.length ? selected : getsIn(other, ids);
    const query = new Set(gets.flatMap((o) => o.queryParams));
    return query.has('Page') && query.has('PageSize') && gets.some((o) => {
      const content: Schema = o.spec.paths[o.path].get.responses?.['200']?.content ?? {};
      return Object.values<Schema>(content).some((c) => 'totalItems' in (deref(o.spec, c.schema).properties ?? {}));
    });
  }).map(([tool]) => tool);
}

/** The JSON a tool returned (its first text content), or the raw text when it isn't a result. */
function resultJson(text: string): unknown {
  const content = JSON.parse(text) as Array<{ text: string }>;
  return JSON.parse(content[0].text);
}

const wire = (requests: RecordedRequest[]) => requests.map((r) => ({ method: r.method, path: r.path, query: r.query, body: r.body }));

// Every request gets a one-row page with a known total; paths stay unique per tool.
const recorder = createRecorder(() => ({ data: [{ id: ID }], totalItems: TOTAL, totalPages: TOTAL, hasNextPage: true }));
const saved = { ...process.env };
beforeAll(() => recorder.listen());
afterAll(() => { recorder.close(); process.env = saved; });

describe.each(RELEASES)('bMS %s', (release) => {
  interface Counted {
    server: string;
    tool: string;
    args: Record<string, unknown>;
    count: { text: string; isError: boolean; sent: RecordedRequest[] };
    normal: { text: string; isError: boolean; sent: RecordedRequest[] };
    off: { sent: RecordedRequest[] };
  }
  const expected: Record<string, string[]> = {};
  const offering: Record<string, string[]> = {};
  const counted: Counted[] = [];
  const refused: Array<{ server: string; tool: string; code?: number; text: string; sent: number }> = [];

  beforeAll(async () => {
    // Writes on, so a tool that doesn't offer countOnly is refused for the argument, not by the write gate.
    Object.assign(process.env, guardEnv(release, { writes: true, secretRead: true }));
    for (const server of SERVERS) {
      const { TOOL_OPERATIONS } = await import(pathToFileURL(join(ROOT, server, 'src', 'operations.ts')).href);
      const conn = await connect(server);
      expected[server] = countableTools(server, release, TOOL_OPERATIONS).filter((t) => conn.tools.some((l) => l.name === t)).sort();
      offering[server] = conn.tools.filter((t) => 'countOnly' in (t.inputSchema.properties ?? {})).map((t) => t.name).sort();
      recorder.take();
      for (const tool of conn.tools) {
        const args = requiredArguments(tool.inputSchema);
        if (!offering[server].includes(tool.name)) {
          const r = await conn.call(tool.name, { ...args, countOnly: true });
          refused.push({ server, tool: tool.name, code: r.code, text: r.text, sent: recorder.take().length });
          continue;
        }
        const count = { ...(await conn.call(tool.name, { ...args, countOnly: true })), sent: recorder.take() };
        const normal = { ...(await conn.call(tool.name, args)), sent: recorder.take() };
        await conn.call(tool.name, { ...args, countOnly: false });
        counted.push({ server, tool: tool.name, args, count, normal, off: { sent: recorder.take() } });
      }
      await conn.close();
    }
  }, 300_000);

  it('offers countOnly on exactly the paged list tools whose answer has totalItems, per the specs', () => {
    expect(offering).toEqual(expected);
    expect(Object.values(expected).flat().length).toBe(COUNTABLE[release]);
  });

  it('AC 1: one request with Page=0 and PageSize=1 per countable tool', () => {
    expect(counted.length).toBe(COUNTABLE[release]);
    const wrong = counted.filter((c) => {
      if (c.count.isError || c.count.sent.length !== 1) {return true;}
      const query = new URLSearchParams(c.count.sent[0].query);
      return c.count.sent[0].method !== 'GET' || query.get('PageSize') !== '1' || query.get('Page') !== '0';
    }).map((c) => `${c.server} ${c.tool}: ${c.count.isError ? c.count.text : JSON.stringify(wire(c.count.sent))}`);
    expect(wrong).toEqual([]);
  });

  it('AC 1: the result is only totalItems plus the applied filters', () => {
    const wrong = counted.filter((c) => {
      const filters = Object.fromEntries(Object.entries(c.args).filter(([name]) => !NOT_FILTERS.has(name)));
      const want = { totalItems: TOTAL, ...(Object.keys(filters).length > 0 && { filters }) };
      return c.count.isError || JSON.stringify(resultJson(c.count.text)) !== JSON.stringify(want);
    }).map((c) => `${c.server} ${c.tool}: ${c.count.text}`);
    expect(wrong).toEqual([]);
  });

  it('AC 2: the count equals totalItems of a normal call against the same answer', () => {
    const wrong = counted.filter((c) => {
      if (c.normal.isError || c.count.isError) {return true;}
      const normal = resultJson(c.normal.text) as { totalItems?: unknown };
      const count = resultJson(c.count.text) as { totalItems?: unknown };
      return normal.totalItems !== TOTAL || count.totalItems !== normal.totalItems;
    }).map((c) => `${c.server} ${c.tool}`);
    expect(wrong).toEqual([]);
  });

  it('AC 3: countOnly never reaches bConnect; countOnly: false sends the request of a call without it', () => {
    const all = counted.flatMap((c) => [...c.count.sent, ...c.normal.sent, ...c.off.sent]);
    expect(all.length).toBeGreaterThanOrEqual(COUNTABLE[release] * 3);
    expect(all.filter((r) => /countonly/i.test(r.url.search) || /countonly/i.test(r.body)).map((r) => r.url.href)).toEqual([]);
    expect(counted.filter((c) => JSON.stringify(wire(c.off.sent)) !== JSON.stringify(wire(c.normal.sent))).map((c) => `${c.server} ${c.tool}`)).toEqual([]);
  });

  it('AC 5: a tool that does not offer countOnly refuses it with InvalidParams, before any request', () => {
    expect(refused.length).toBeGreaterThan(100);
    const wrong = refused.filter((r) => r.code !== INVALID_PARAMS || !r.text.includes('countOnly') || r.sent !== 0)
      .map((r) => `${r.server} ${r.tool}: ${r.code} ${r.sent} ${r.text.slice(0, 120)}`);
    expect(wrong).toEqual([]);
  });

  it('every server is covered and the domain segment is kept', () => {
    const servers = new Set(counted.map((c) => c.server));
    // Compliance and universal dynamic groups are 26R1 only: on 25R2 those servers list no tool.
    expect(servers.size).toBe(release === '25R2' ? SERVERS.length - 2 : SERVERS.length);
    const wrong = counted.filter((c) => c.count.sent.length === 1 && !c.count.sent[0].path.startsWith(`/${domainOf(c.server)}/`)).map((c) => `${c.server} ${c.tool} ${c.count.sent[0].path}`);
    expect(wrong).toEqual([]);
  });
});
