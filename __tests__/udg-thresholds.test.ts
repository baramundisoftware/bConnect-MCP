/**
 * Universal dynamic group thresholds, bMS 26R2 (#354, #355).
 *
 * list_thresholds reads all thresholds (GET /Thresholds) or, with dynamicGroupId, one
 * group's (GET /UniversalDynamicGroups/{dynamicGroupId}/Thresholds); get_threshold reads
 * one. On 26R1 the tools aren't listed and are refused by name, sending nothing.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const GROUP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const THRESHOLD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BASE = '/universaldynamicgroups/v2.0';

let sent: Array<{ method: string; path: string; query: string; body: string; type: string }> = [];
const msw = setupServer(http.all('*', async ({ request }) => {
  const url = new URL(request.url);
  sent.push({ method: request.method, path: url.pathname.replace(/^\/bconnect/, ''), query: url.search, body: await request.text(), type: request.headers.get('content-type') ?? '' });
  if (request.method === 'DELETE') {return new HttpResponse(null, { status: 204 });}
  if (url.pathname.endsWith('/Thresholds')) {return HttpResponse.json({ data: [{ id: THRESHOLD }], totalItems: 7 });}
  return HttpResponse.json({ id: THRESHOLD, dynamicGroupId: GROUP, value: 5, type: 'UpperLimit', severity: 'Warning' });
}));

let client: Client;
const saved = { ...process.env };
beforeAll(async () => {
  Object.assign(process.env, {
    BCONNECT_BASE_URL: 'https://bms.udg.test/bconnect', BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p',
    BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', BCONNECT_RELEASE: '26R2', ALLOW_WRITE_OPERATIONS: 'true',
  });
  msw.listen({ onUnhandledRequest: 'error' });
  const { createServer } = await import('../bconnect-universaldynamicgroups-mcp/src/index.ts');
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'udg-thresholds', version: '0' });
  await Promise.all([createServer().server.connect(a), client.connect(b)]);
});
beforeEach(() => { process.env.BCONNECT_RELEASE = '26R2'; process.env.ALLOW_WRITE_OPERATIONS = 'true'; });
afterEach(() => { sent = []; });
afterAll(async () => { await client.close(); msw.close(); process.env = saved; });

const call = async (name: string, args: Record<string, unknown>) => {
  const r = await client.callTool({ name, arguments: args });
  return { isError: r.isError === true, text: (r.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n') };
};
/** A refused call (protocol error) as its message: what the model reads. */
const refusal = async (name: string, args: Record<string, unknown>): Promise<string> => {
  try {
    await client.callTool({ name, arguments: args });
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`${name} was not refused`);
};
const tool = async (name: string) => (await client.listTools()).tools.find((t) => t.name === name);
const routes = () => sent.map((s) => [s.method, s.path]);

describe('list_thresholds (#354)', () => {
  it('without dynamicGroupId reads every threshold from GET /Thresholds, sending its query parameters', async () => {
    const r = await call('list_thresholds', { SearchQuery: 'Lab', OrderBy: 'Value desc', Page: 1, PageSize: 20 });
    expect(r.isError).toBe(false);
    expect(routes()).toEqual([['GET', `${BASE}/Thresholds`]]);
    expect(new URLSearchParams(sent[0].query).get('SearchQuery')).toBe('Lab');
    expect(new URLSearchParams(sent[0].query).get('PageSize')).toBe('20');
  });

  it('with dynamicGroupId reads that group\'s thresholds, the ID in the path and not in the query', async () => {
    expect((await call('list_thresholds', { dynamicGroupId: GROUP, PageSize: 5 })).isError).toBe(false);
    expect(routes()).toEqual([['GET', `${BASE}/UniversalDynamicGroups/${GROUP}/Thresholds`]]);
    expect(new URLSearchParams(sent[0].query).has('dynamicGroupId')).toBe(false);
  });

  it.each([[{}, `${BASE}/Thresholds`], [{ dynamicGroupId: GROUP }, `${BASE}/UniversalDynamicGroups/${GROUP}/Thresholds`]])('countOnly %j counts with one 1-row request', async (args, path) => {
    const r = await call('list_thresholds', { ...args, countOnly: true });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('7');
    expect(routes()).toEqual([['GET', path]]);
    expect(new URLSearchParams(sent[0].query).get('PageSize')).toBe('1');
  });

  it('a dynamicGroupId that is no GUID is refused before anything is sent', async () => {
    expect(await refusal('list_thresholds', { dynamicGroupId: 'nope' })).toContain('dynamicGroupId must be a valid GUID');
    expect(sent).toEqual([]);
  });

  it('is listed with dynamicGroupId as a plain ID (no enum), not required', async () => {
    const t = (await tool('list_thresholds'))!;
    expect(t.inputSchema.properties?.dynamicGroupId).toEqual({ type: 'string', description: expect.stringContaining('GUID of a Universal Dynamic Group') });
    expect(t.inputSchema.required ?? []).toEqual([]);
    expect(Object.keys(t.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(['SearchQuery', 'OrderBy', 'Page', 'PageSize', 'countOnly']));
  });
});

describe('get_threshold (#354)', () => {
  it('reads GET /Thresholds/{id}', async () => {
    const r = await call('get_threshold', { id: THRESHOLD });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('UpperLimit');
    expect(routes()).toEqual([['GET', `${BASE}/Thresholds/${THRESHOLD}`]]);
  });
});

describe('on bMS 26R1 (#354)', () => {
  beforeEach(() => { process.env.BCONNECT_RELEASE = '26R1'; });

  it('the threshold read tools are not listed', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.filter((n) => n.includes('threshold'))).toEqual([]);
  });

  it.each([['get_threshold', { id: THRESHOLD }], ['list_thresholds', {}], ['list_thresholds', { dynamicGroupId: GROUP }]] as const)('%s %j is refused naming 26R2 and sends nothing', async (name, args) => {
    expect(await refusal(name, args)).toMatch(/only available in bMS 26R2; this server uses 26R1/);
    expect(sent).toEqual([]);
  });
});
