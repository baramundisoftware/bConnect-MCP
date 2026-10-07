/**
 * List tools answer "how many?" with countOnly (REQ-SRV-027, #165).
 *
 * `withCountOnly` wraps a server's CallTool handler. For a tool whose table
 * entry (selected release) declares `countOnly`, `countOnly: true` calls the
 * tool once with Page=0 and a page size of 1 and returns only `totalItems` and
 * the filters that were applied; without a numeric `totalItems` it says the
 * count is unavailable instead of guessing. `countOnly` itself never reaches
 * the tool's request: the tables send only what `queryParameters` names.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { withCountOnly } from '../packages/mcp-core/src/count-only.js';
import { COUNT_ONLY_PROPERTY, PAGE_PROPERTY, PAGE_SIZE_PROPERTY } from '../packages/mcp-core/src/paging.js';
import { toolJsonResult, type ToolJsonResult } from '../packages/mcp-core/src/tool-results.js';
import type { QueryParameterTable } from '../packages/mcp-core/src/tool-arguments.js';

const NAME = { type: 'string', description: 'Filters by name.' };
const TABLE: QueryParameterTable = {
  '25R2': {
    list_things: { Page: PAGE_PROPERTY, PageSize: PAGE_SIZE_PROPERTY, Name: NAME },
  },
  '26R1': {
    list_things: { OrderBy: NAME, Name: NAME, Page: PAGE_PROPERTY, PageSize: PAGE_SIZE_PROPERTY, countOnly: COUNT_ONLY_PROPERTY },
    search_things: { Page: PAGE_PROPERTY, PageSize: PAGE_SIZE_PROPERTY, countOnly: COUNT_ONLY_PROPERTY },
    list_unpaged: { Name: NAME },
  },
};

interface Request { params: { name: string; arguments?: Record<string, unknown> } }

/** A handler that records each request and answers with `answer` (a page by default). */
function tool(answer: (request: Request) => ToolJsonResult = () => toolJsonResult({ data: [{ id: 'a' }], totalItems: 7, totalPages: 7 })) {
  const seen: Request[] = [];
  const handler = vi.fn(async (request: Request) => { seen.push(request); return answer(request); });
  return { seen, handler };
}

const request = (name: string, args?: Record<string, unknown>): Request => ({ params: { name, ...(args && { arguments: args }) } });
const textOf = (result: { content: Array<{ text: string }> }): string => result.content[0].text;

afterEach(() => { vi.unstubAllEnvs(); });

describe('withCountOnly, countOnly: true', () => {
  it('calls the tool once with Page=0 and PageSize=1 and returns only totalItems and the filters', async () => {
    const { seen, handler } = tool();
    const result = await withCountOnly(TABLE, () => '26R1', handler)(request('list_things', { countOnly: true, Name: 'x', Page: 5, PageSize: 50 }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(seen[0].params).toEqual({ name: 'list_things', arguments: { Name: 'x', Page: 0, PageSize: 1 } });
    expect(textOf(result)).toBe('{"totalItems":7,"filters":{"Name":"x"}}');
  });

  it('leaves filters out when none were given, and never counts sorting or paging as a filter', async () => {
    const { handler } = tool();
    const result = await withCountOnly(TABLE, () => '26R1', handler)(request('list_things', { countOnly: true, OrderBy: 'Name asc', Page: 2 }));
    expect(textOf(result)).toBe('{"totalItems":7}');
  });

  it('keeps arguments that scope the count, such as a path id, in the filters', async () => {
    const { seen, handler } = tool();
    const result = await withCountOnly(TABLE, () => '26R1', handler)(request('list_things', { countOnly: true, groupId: 'g', Name: '' }));
    expect(seen[0].params.arguments).toEqual({ groupId: 'g', Name: '', Page: 0, PageSize: 1 });
    expect(JSON.parse(textOf(result))).toEqual({ totalItems: 7, filters: { groupId: 'g', Name: '' } });
  });

  it('sets the page size through the argument a tool names instead of PageSize', async () => {
    const { seen, handler } = tool();
    const wrapped = withCountOnly(TABLE, () => '26R1', handler, { pageSizeArgument: { search_things: 'pageSize' } });
    const result = await wrapped(request('search_things', { countOnly: true, query: 'q', pageSize: 30 }));
    expect(seen[0].params.arguments).toEqual({ query: 'q', Page: 0, pageSize: 1 });
    expect(textOf(result)).toBe('{"totalItems":7,"filters":{"query":"q"}}');
  });

  it('reads an indented result and answers in the configured format', async () => {
    vi.stubEnv('BCONNECT_PRETTY_JSON', 'true');
    const { handler } = tool();
    const result = await withCountOnly(TABLE, () => '26R1', handler)(request('list_things', { countOnly: true }));
    expect(textOf(result)).toBe('{\n  "totalItems": 7\n}');
  });

  it('keeps a note the tool adds to its page (e.g. an unconfirmed parent), and only a string one', async () => {
    const note = 'Could not confirm that the job definition exists.';
    const { handler } = tool(() => toolJsonResult({ data: [], totalItems: 0, note }));
    const result = await withCountOnly(TABLE, () => '26R1', handler)(request('list_things', { countOnly: true, Name: 'x' }));
    expect(textOf(result)).toBe(`{"totalItems":0,"note":"${note}","filters":{"Name":"x"}}`);
    const { handler: odd } = tool(() => toolJsonResult({ data: [], totalItems: 0, note: { x: 1 } }));
    expect(textOf(await withCountOnly(TABLE, () => '26R1', odd)(request('list_things', { countOnly: true })))).toBe('{"totalItems":0}');
  });

  it('counts zero items', async () => {
    const { handler } = tool(() => toolJsonResult({ data: [], totalItems: 0 }));
    expect(textOf(await withCountOnly(TABLE, () => '26R1', handler)(request('list_things', { countOnly: true })))).toBe('{"totalItems":0}');
  });
});

describe('withCountOnly, count unavailable (AC 4)', () => {
  const UNAVAILABLE = "Count unavailable: bConnect's answer has no numeric totalItems.";

  it.each([
    ['missing', { data: [{ id: 'a' }], totalPages: 1 }],
    ['a string', { data: [], totalItems: '7' }],
    ['null', { data: [], totalItems: null }],
    ['negative', { data: [], totalItems: -1 }],
    ['a fraction', { data: [], totalItems: 1.5 }],
    ['an array answer', [{ id: 'a' }]],
    ['a JSON scalar', 7],
  ])('totalItems %s → an explicit "count unavailable", no totalItems key', async (_case, page) => {
    const { handler } = tool(() => toolJsonResult(page));
    const result = await withCountOnly(TABLE, () => '26R1', handler)(request('list_things', { countOnly: true, Name: 'x' }));
    const parsed = JSON.parse(textOf(result));
    expect(parsed).toEqual({ countUnavailable: UNAVAILABLE, filters: { Name: 'x' } });
    expect(parsed).not.toHaveProperty('totalItems');
    expect(result).not.toHaveProperty('isError');
  });

  it('text that is not JSON → count unavailable', async () => {
    const { handler } = tool(() => ({ content: [{ type: 'text', text: 'Note:\n{"totalItems":7}' }] }));
    const result = await withCountOnly(TABLE, () => '26R1', handler)(request('list_things', { countOnly: true }));
    expect(JSON.parse(textOf(result))).toEqual({ countUnavailable: UNAVAILABLE });
  });

  it('a result without text content → count unavailable', async () => {
    const { handler } = tool(() => ({ content: [] }));
    const result = await withCountOnly(TABLE, () => '26R1', handler)(request('list_things', { countOnly: true }));
    expect(JSON.parse(textOf(result))).toEqual({ countUnavailable: UNAVAILABLE });
  });

  it('a result without content → count unavailable', async () => {
    const handler = vi.fn(async () => ({}));
    const result = await withCountOnly(TABLE, () => '26R1', handler)(request('list_things', { countOnly: true }));
    expect(JSON.parse(textOf(result as ToolJsonResult))).toEqual({ countUnavailable: UNAVAILABLE });
  });

  it('an error result passes through unchanged', async () => {
    const failed = { content: [{ type: 'text' as const, text: 'bConnect API error (404): not found' }], isError: true };
    const { handler } = tool(() => failed);
    expect(await withCountOnly(TABLE, () => '26R1', handler)(request('list_things', { countOnly: true }))).toBe(failed);
  });

  it('an error the tool throws reaches the caller', async () => {
    const handler = vi.fn(async () => { throw new McpError(ErrorCode.InvalidParams, 'bad'); });
    await expect(withCountOnly(TABLE, () => '26R1', handler)(request('list_things', { countOnly: true }))).rejects.toThrow('bad');
  });
});

describe('withCountOnly, everything else is today\'s call', () => {
  it('countOnly: false is removed; the call is otherwise unchanged', async () => {
    const { seen, handler } = tool();
    const result = await withCountOnly(TABLE, () => '26R1', handler)(request('list_things', { countOnly: false, Name: 'x', Page: 3 }));
    expect(seen[0].params.arguments).toEqual({ Name: 'x', Page: 3 });
    expect(JSON.parse(textOf(result))).toEqual({ data: [{ id: 'a' }], totalItems: 7, totalPages: 7 });
  });

  it('without countOnly the request is passed on as it is', async () => {
    const { seen, handler } = tool();
    const req = request('list_things', { Name: 'x' });
    await withCountOnly(TABLE, () => '26R1', handler)(req);
    expect(seen[0]).toBe(req);
    const bare = request('list_things');
    await withCountOnly(TABLE, () => '26R1', handler)(bare);
    expect(seen[1]).toBe(bare);
  });

  it.each([['"true"', 'true'], ['1', 1], ['null', null]])('countOnly %s is refused with InvalidParams, before any call', async (_label, value) => {
    const { handler } = tool();
    const call = withCountOnly(TABLE, () => '26R1', handler)(request('list_things', { countOnly: value }));
    await expect(call).rejects.toThrow(McpError);
    await expect(withCountOnly(TABLE, () => '26R1', handler)(request('list_things', { countOnly: value }))).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    ['a tool that does not declare countOnly in the selected release', '25R2', 'list_things'],
    ['an unpaged tool', '26R1', 'list_unpaged'],
    ['a tool without a table entry', '26R1', 'get_thing'],
  ])('%s gets the request unchanged, countOnly included (refused later as undeclared)', async (_case, release, name) => {
    const { seen, handler } = tool();
    const req = request(name, { countOnly: true });
    await withCountOnly(TABLE, () => release, handler)(req);
    expect(seen[0]).toBe(req);
  });

  it('reads the release on every call', async () => {
    const { seen, handler } = tool();
    let release = '25R2';
    const wrapped = withCountOnly(TABLE, () => release, handler);
    await wrapped(request('list_things', { countOnly: true }));
    release = '26R1';
    await wrapped(request('list_things', { countOnly: true }));
    expect(seen.map((r) => r.params.arguments)).toEqual([{ countOnly: true }, { Page: 0, PageSize: 1 }]);
  });

  it('an unset release means 26R1, as the servers treat it', async () => {
    const { seen, handler } = tool();
    await withCountOnly(TABLE, () => undefined, handler)(request('list_things', { countOnly: true }));
    expect(seen[0].params.arguments).toEqual({ Page: 0, PageSize: 1 });
  });

  it('passes extra handler arguments through', async () => {
    const handler = vi.fn(async (_request: Request, extra: string) => toolJsonResult({ extra }));
    const wrapped = withCountOnly(TABLE, () => '26R1', handler);
    expect(textOf(await wrapped(request('list_things'), 'x'))).toBe('{"extra":"x"}');
  });
});

describe('COUNT_ONLY_PROPERTY', () => {
  it('is a boolean with one short sentence (it is listed on every paged tool)', () => {
    expect(COUNT_ONLY_PROPERTY.type).toBe('boolean');
    expect(COUNT_ONLY_PROPERTY.description.length).toBeLessThanOrEqual(40);
    expect(COUNT_ONLY_PROPERTY.description).toMatch(/totalItems/);
  });
});
