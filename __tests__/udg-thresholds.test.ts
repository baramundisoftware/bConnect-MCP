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
  if (request.method === 'GET' && url.pathname.endsWith('/Thresholds')) {return HttpResponse.json({ data: [{ id: THRESHOLD }], totalItems: 7 });}
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

describe('create_threshold (#355)', () => {
  const PROFILE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const base = { dynamicGroupId: GROUP, securityProfileId: PROFILE };

  it('POSTs ThresholdForCreation with only the given fields and returns what bMS answered', async () => {
    const r = await call('create_threshold', { ...base, value: 0, type: 'LowerLimit', severity: 'Error', isActive: true, comment: 'Lab' });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('Threshold created:');
    expect(routes()).toEqual([['POST', `${BASE}/Thresholds`]]);
    expect(JSON.parse(sent[0].body)).toEqual({ ...base, value: 0, type: 'LowerLimit', severity: 'Error', isActive: true, comment: 'Lab' });
    expect((await call('create_threshold', base)).text).toContain(THRESHOLD);
    expect(JSON.parse(sent[1].body)).toEqual(base);
  });

  it('requires dynamicGroupId and securityProfileId, and offers the spec\'s types and severities', async () => {
    const t = (await tool('create_threshold'))!;
    expect(t.inputSchema.required).toEqual(['dynamicGroupId', 'securityProfileId']);
    expect(t.inputSchema.properties?.type).toMatchObject({ enum: ['UpperLimit', 'LowerLimit'] });
    expect(t.inputSchema.properties?.severity).toMatchObject({ enum: ['Info', 'Warning', 'Error'] });
    expect(t.inputSchema.properties?.value).toMatchObject({ type: 'integer', minimum: 0 });
    expect(t.inputSchema.properties?.comment).toMatchObject({ maxLength: 4000 });
    expect(t.annotations).toMatchObject({ readOnlyHint: false });
  });

  it.each([
    [{ securityProfileId: PROFILE }, 'dynamicGroupId'],
    [{ ...base, dynamicGroupId: 'nope' }, 'dynamicGroupId must be a valid GUID'],
    [{ ...base, value: -1 }, 'value must be at least 0'],
    [{ ...base, value: 1.5 }, 'value must be a whole number'],
    [{ ...base, type: 'Unknown' }, 'type'],
    [{ ...base, severity: 'Critical' }, 'severity'],
    [{ ...base, comment: 'x'.repeat(4001) }, 'comment must be at most 4000 characters'],
  ])('%j is refused before anything is sent (%s)', async (args, message) => {
    expect(await refusal('create_threshold', args)).toContain(message);
    expect(sent).toEqual([]);
  });

  it('a comment of exactly 4000 characters is sent', async () => {
    expect((await call('create_threshold', { ...base, comment: 'x'.repeat(4000) })).isError).toBe(false);
    expect(JSON.parse(sent[0].body).comment).toHaveLength(4000);
  });
});

describe('update_threshold (#355)', () => {
  it('PATCHes application/json-patch+json with only the given fields, under the spec\'s paths', async () => {
    const r = await call('update_threshold', { id: THRESHOLD, value: 50, severity: 'Info', isActive: false });
    expect(r.isError).toBe(false);
    expect(routes()).toEqual([['PATCH', `${BASE}/Thresholds/${THRESHOLD}`]]);
    expect(sent[0].type).toContain('application/json-patch+json');
    expect(JSON.parse(sent[0].body)).toEqual([
      { op: 'replace', path: '/Value', value: 50 },
      { op: 'replace', path: '/Severity', value: 'Info' },
      { op: 'replace', path: '/IsActive', value: false },
    ]);
  });

  it('offers only the modifiable fields: not the group or the security profile', async () => {
    const t = (await tool('update_threshold'))!;
    expect(Object.keys(t.inputSchema.properties ?? {}).sort()).toEqual(['comment', 'id', 'isActive', 'severity', 'type', 'value']);
  });

  it.each([
    [{ id: THRESHOLD }, 'update_threshold needs at least one field to change: value, type, severity, isActive, comment'],
    [{ id: THRESHOLD, dynamicGroupId: GROUP }, 'dynamicGroupId'],
    [{ id: THRESHOLD, type: 'Unknown' }, 'type'],
  ])('%j is refused before anything is sent', async (args, message) => {
    expect(await refusal('update_threshold', args)).toContain(message);
    expect(sent).toEqual([]);
  });
});

describe('delete_threshold (#355)', () => {
  it('DELETEs /Thresholds/{id} and says so', async () => {
    const r = await call('delete_threshold', { id: THRESHOLD });
    expect(r.isError).toBe(false);
    expect(r.text).toBe(`Threshold ${THRESHOLD} deleted.`);
    expect(routes()).toEqual([['DELETE', `${BASE}/Thresholds/${THRESHOLD}`]]);
  });

  it('is marked destructive', async () => {
    expect((await tool('delete_threshold'))!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});

describe('threshold write tools with writes off (#355)', () => {
  beforeEach(() => { process.env.ALLOW_WRITE_OPERATIONS = 'false'; });

  it('are not listed; the read tools are', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).filter((n) => n.includes('threshold'));
    expect(names.sort()).toEqual(['get_threshold', 'list_thresholds']);
  });

  it.each([
    ['create_threshold', { dynamicGroupId: GROUP, securityProfileId: GROUP }],
    ['update_threshold', { id: THRESHOLD, value: 1 }],
    ['delete_threshold', { id: THRESHOLD }],
  ] as const)('%s is refused by the write gate and sends nothing', async (name, args) => {
    const r = await call(name, args);
    expect(r.isError).toBe(true);
    expect(r.text).toBe(`Write operation '${name}' is disabled. Set ALLOW_WRITE_OPERATIONS=true to enable write operations.`);
    expect(sent).toEqual([]);
  });
});

describe('threshold write tools on bMS 26R1 (#355)', () => {
  beforeEach(() => { process.env.BCONNECT_RELEASE = '26R1'; });

  it.each(['create_threshold', 'update_threshold', 'delete_threshold'])('%s is refused naming 26R2 and sends nothing', async (name) => {
    expect(await refusal(name, { id: THRESHOLD })).toMatch(/only available in bMS 26R2; this server uses 26R1/);
    expect(sent).toEqual([]);
  });
});
