/**
 * An empty, unfiltered list says that missing rights can be the cause (#402, AC 2).
 *
 * bMS answers a list the account has no rights on with 200 and an empty page,
 * not 403. The wrapper (packages/mcp-core/src/empty-list-hint.ts) adds
 * EMPTY_LIST_HINT as a second text content; the JSON stays the first, unchanged.
 * Unit cases for the wrapper, then every list tool of every server and release
 * through the MCP client: the hint on an empty unfiltered page (and a count of
 * 0), none on a non-empty page, none when the caller filtered.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMPTY_LIST_HINT, toolJsonResult, toolErrorResult, withEmptyListHint } from '../packages/mcp-core/src/index.js';
import { RELEASES } from './lib/spec.js';
import { SERVERS, callsOf, connect, createRecorder, guardEnv, requiredArguments } from './lib/exerciser.js';

const call = (name: string, args?: Record<string, unknown>) => ({ params: { name, ...(args && { arguments: args }) } });
const answering = (value: unknown) => withEmptyListHint(async () => toolJsonResult(value));
const texts = (result: unknown): string[] => (result as { content: Array<{ text: string }> }).content.map((c) => c.text);

describe('withEmptyListHint', () => {
  it.for([
    ['an empty page', { data: [], totalItems: 0, totalPages: 0 }],
    ['a count of 0', { totalItems: 0 }],
    ['an empty data array without totalItems', { data: [] }],
    ['an empty array', []],
  ] as const)('adds the hint after the unchanged JSON for %s', async ([, value]) => {
    const result = await answering(value)(call('list_x', { PageSize: 50, OrderBy: 'name', countOnly: true }));
    expect(texts(result)).toEqual([JSON.stringify(value), EMPTY_LIST_HINT]);
  });

  it.for([
    ['a non-empty page', 'list_x', undefined, { data: [{ id: 'a' }], totalItems: 1 }],
    ['a count above 0', 'list_x', undefined, { totalItems: 3 }],
    ['a page with its own note', 'list_x', undefined, { data: [], totalItems: 0, note: 'no findings' }],
    ['a filter', 'list_x', { SearchQuery: 'x' }, { data: [], totalItems: 0 }],
    ['a parent id', 'list_x_by_y', { yId: 'id' }, { data: [], totalItems: 0 }],
    ['a later page', 'list_x', { Page: 2 }, { data: [], totalItems: 0 }],
    ['a tool that is no list', 'get_x', undefined, { data: [], totalItems: 0 }],
    ['an object that is no page', 'list_x', undefined, { name: 'x' }],
  ] as const)('adds nothing for %s', async ([, name, args, value]) => {
    const result = await answering(value)(call(name, args));
    expect(texts(result)).toEqual([JSON.stringify(value)]);
  });

  it('adds nothing to an error result or a text that is no JSON', async () => {
    const error = toolErrorResult(new Error('boom'), '26R2');
    expect(await withEmptyListHint(async () => error)(call('list_x'))).toBe(error);
    const lead = toolJsonResult([], { lead: 'Done:' });
    expect(await withEmptyListHint(async () => lead)(call('list_x'))).toBe(lead);
  });
});

const EMPTY_PAGE = { currentPage: 0, pageSize: 20, totalPages: 0, totalItems: 0, hasPreviousPage: false, hasNextPage: false, data: [] };
const FULL_PAGE = { ...EMPTY_PAGE, totalPages: 1, totalItems: 1, data: [{ id: '00000000-0000-4000-8000-000000000001' }] };
let answer: unknown = EMPTY_PAGE;
const recorder = createRecorder(() => answer as never);
const savedEnv = { ...process.env };
beforeAll(() => recorder.listen());
afterAll(() => { recorder.close(); process.env = savedEnv; });

describe.each(RELEASES)('list tools in %s', (release) => {
  it.for(SERVERS)('%s: hint on an empty unfiltered list only', async (server, { expect }) => {
    Object.assign(process.env, guardEnv(release, { writes: false, secretRead: true }));
    const conn = await connect(server);
    const lists = (await callsOf(server, conn.tools, release)).filter((c) => c.name.startsWith('list_'));
    const unfiltered = lists.filter((c) => Object.keys(c.select).length === 0 && Object.keys(requiredArguments(c.inputSchema)).length === 0);
    const filtered = lists.filter((c) => Object.keys(requiredArguments(c.inputSchema)).length > 0);
    // compliance and universaldynamicgroups have no tools on 25R2.
    if (conn.tools.length > 0) {expect(unfiltered.length + filtered.length, 'list tools checked').toBeGreaterThan(0);}
    for (const c of unfiltered) {
      answer = EMPTY_PAGE;
      const empty = await conn.call(c.name, {});
      expect(empty.isError, `${c.key}: ${empty.text}`).toBe(false);
      expect(empty.text, c.key).toContain(JSON.stringify(EMPTY_LIST_HINT));
      answer = FULL_PAGE;
      expect((await conn.call(c.name, {})).text, c.key).not.toContain('No entries.');
    }
    answer = EMPTY_PAGE;
    for (const c of filtered) {
      const result = await conn.call(c.name, { ...requiredArguments(c.inputSchema), ...c.select });
      expect(result.text, c.key).not.toContain('No entries.');
    }
    recorder.take();
    await conn.close();
  });
});
