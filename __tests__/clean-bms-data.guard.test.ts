/**
 * Hidden-character guard (REQ-XC-006 AC 2, ADR-0009; #167).
 *
 * Every tool of every server is called, for both bMS releases, against a bMS
 * whose every string (and one key) carries tag characters, a bidi override
 * and a zero-width space. No tool result may contain a character of the class
 * (format characters and the tag block, minus ZWNJ/ZWJ); a result that echoes
 * bMS data shows the marker instead.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { RELEASES, type Release } from './lib/spec.js';
import { ID, SERVERS, connect, guardEnv, requiredArguments } from './lib/exerciser.js';

const MARKER = '[hidden characters removed]';
const HIDDEN = '\u{E0049}\u{E0067}\u{E006E}\u202E\u200B';
const text = (s: string): string => `${s}${HIDDEN}value`;

/** Characters of the class, as the guard defines it independently of the implementation. */
const CLASS = /[\u{E0000}-\u{E007F}]|(?![\u200C\u200D])\p{Cf}/u;

const row = {
  id: ID, displayName: text('d'), name: text('n'), comment: text('c'), hostName: text('h'),
  [`na${HIDDEN}me`]: text('k'), parentId: ID, status: text('s'),
};
const body = {
  data: [row], totalItems: 1, totalPages: 1, currentPage: 0, pageSize: 20,
  hasNextPage: false, hasPreviousPage: false, ...row,
};

const msw = setupServer(http.all('*', () => HttpResponse.json(body)));
const savedEnv = { ...process.env };
beforeAll(() => msw.listen({ onUnhandledRequest: 'error' }));
afterAll(() => {
  msw.close();
  process.env = savedEnv;
});

interface Call { tool: string; text: string; isError: boolean }

async function exerciseAll(release: Release): Promise<Call[]> {
  Object.assign(process.env, guardEnv(release, { writes: true, secretRead: true }));
  const calls: Call[] = [];
  for (const server of SERVERS) {
    const conn = await connect(server);
    for (const tool of conn.tools) {
      const result = await conn.call(tool.name, requiredArguments(tool.inputSchema));
      calls.push({ tool: `${server}:${tool.name}`, text: result.text, isError: result.isError });
    }
    await conn.close();
  }
  return calls;
}

describe.each(RELEASES)('hidden characters, bMS %s', (release) => {
  let calls: Call[];

  beforeAll(async () => {
    calls = await exerciseAll(release);
  }, 180_000);

  it('the guard detects the class (self-check)', () => {
    expect(CLASS.test(HIDDEN)).toBe(true);
    expect(CLASS.test('a\u200Db\u200Cc')).toBe(false);
  });

  it('no tool result contains a hidden character', () => {
    const leaks = calls.filter((c) => CLASS.test(c.text));
    expect(leaks.map((c) => c.tool)).toEqual([]);
  });

  it('results that echo bMS data show the marker (most tools do)', () => {
    const marked = calls.filter((c) => c.text.includes(MARKER));
    expect(marked.length).toBeGreaterThan(calls.length / 2);
  });
});
