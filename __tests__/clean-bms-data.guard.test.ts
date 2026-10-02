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
const HIDDEN = '\u{E0049}\u{E0067}\u{E006E}\u202E\u200B\u{E0151}\u3164';
/** Marks text that came from bMS, so an echo can be recognised in a result. */
const ECHO = 'Zq7';
const text = (s: string): string => `${ECHO}${s}${HIDDEN}value\r\nline2`;

/** Characters of the class, as the guard defines it independently of the implementation. */
const CLASS = /[\u{E0000}-\u{E0FFF}]|(?![\u200C\u200D\uFE0E\uFE0F])[\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

const row = {
  id: ID, displayName: text('d'), name: text('n'), comment: text('c'), hostName: text('h'),
  [`na${HIDDEN}me`]: text('k'), parentId: ID, status: text('s'),
};
const body = {
  data: [row], totalItems: 1, totalPages: 1, currentPage: 0, pageSize: 20,
  hasNextPage: false, hasPreviousPage: false, ...row,
};

let status = 200;
const msw = setupServer(http.all('*', () => status === 200
  ? HttpResponse.json(body)
  : new HttpResponse(JSON.stringify({ title: text('t'), detail: text('d') }), { status, headers: { 'content-type': 'application/problem+json' } })));
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
    status = 200;
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

  it('every result that echoes bMS data shows the marker where the hidden characters were', () => {
    const echoing = calls.filter((c) => c.text.includes(ECHO));
    expect(echoing.length).toBeGreaterThan(calls.length / 2); // self-check: most tools echo data
    const unmarked = echoing.filter((c) => !c.text.includes(`${MARKER}value`));
    expect(unmarked.map((c) => c.tool)).toEqual([]);
  });
});

describe('hidden characters in bConnect error text', () => {
  let calls: Call[];

  beforeAll(async () => {
    status = 404;
    calls = await exerciseAll('26R1');
    status = 200;
  }, 180_000);

  it('no error result contains a hidden character', () => {
    expect(calls.filter((c) => c.isError).length).toBeGreaterThan(200);
    expect(calls.filter((c) => CLASS.test(c.text)).map((c) => c.tool)).toEqual([]);
  });
});
