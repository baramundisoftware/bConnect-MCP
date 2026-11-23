/**
 * API key management, bMS 26R2 (#357).
 *
 * get_api_key reads one key; create_api_key, update_api_key and delete_api_key write, behind
 * ALLOW_WRITE_OPERATIONS. create_api_key answers with the new key's secret, so it also needs
 * ALLOW_SECRET_READ (and the shared client refuses its route on its own). The secret is in the
 * tool result only: never in the audit log or an error text. On 26R1 the tools are refused by name.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROFILE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SECRET = 'zz-live-api-key-secret-7f3c9e';
const BASE = '/servermanagement/v2.0';

let sent: Array<{ method: string; path: string; body: string; type: string }> = [];
let failCreate = false;
const msw = setupServer(http.all('*', async ({ request }) => {
  const url = new URL(request.url);
  sent.push({ method: request.method, path: url.pathname.replace(/^\/bconnect/, ''), body: await request.text(), type: request.headers.get('content-type') ?? '' });
  if (request.method === 'DELETE') {return new HttpResponse(null, { status: 204 });}
  if (request.method === 'POST') {
    if (failCreate) {return HttpResponse.json({ title: 'Conflict', status: 409, detail: 'An API key with this name exists.' }, { status: 409 });}
    return HttpResponse.json({ id: KEY, name: 'n8n', securityProfiles: [PROFILE], apiKeySecret: SECRET }, { status: 201 });
  }
  return HttpResponse.json({ id: KEY, name: 'n8n', isActive: true, securityProfiles: [PROFILE] });
}));

let client: Client;
const saved = { ...process.env };
const stderr: string[] = [];
beforeAll(async () => {
  Object.assign(process.env, {
    BCONNECT_BASE_URL: 'https://bms.keys.test/bconnect', BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p',
    BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', BCONNECT_RELEASE: '26R2', BCONNECT_AUDIT_LEVEL: 'all',
  });
  msw.listen({ onUnhandledRequest: 'error' });
  const { createServer } = await import('../bconnect-servermanagement-mcp/src/index.ts');
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'api-key-tools', version: '0' });
  await Promise.all([createServer().server.connect(a), client.connect(b)]);
});
beforeEach(() => {
  Object.assign(process.env, { BCONNECT_RELEASE: '26R2', ALLOW_WRITE_OPERATIONS: 'true', ALLOW_SECRET_READ: 'true' });
  failCreate = false;
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => { stderr.push(String(chunk)); return true; });
  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => { stderr.push(parts.map(String).join(' ')); });
});
afterEach(() => { sent = []; stderr.length = 0; vi.restoreAllMocks(); });
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

describe('get_api_key (#357)', () => {
  it('reads GET /ApiKeys/{id}, without any gate', async () => {
    Object.assign(process.env, { ALLOW_WRITE_OPERATIONS: 'false', ALLOW_SECRET_READ: 'false' });
    const r = await call('get_api_key', { id: KEY });
    expect(r.isError).toBe(false);
    expect(routes()).toEqual([['GET', `${BASE}/ApiKeys/${KEY}`]]);
    expect((await tool('get_api_key'))!.annotations).toMatchObject({ readOnlyHint: true });
  });
});

describe('create_api_key (#357)', () => {
  const args = { name: 'n8n', expirationDate: '2027-06-30', comment: 'automation', isActive: true, isAvailableViaGateway: false, securityProfiles: [PROFILE] };

  it('with both gates open, POSTs ApiKeyForCreation and returns the secret once, saying so', async () => {
    const r = await call('create_api_key', args);
    expect(r.isError).toBe(false);
    expect(routes()).toEqual([['POST', `${BASE}/ApiKeys`]]);
    expect(JSON.parse(sent[0].body)).toEqual(args);
    expect(r.text).toContain(SECRET);
    expect(r.text).toContain('shown only this once');
  });

  it('never writes the secret to the audit log or any other log (audit level all)', async () => {
    await call('create_api_key', args);
    expect(stderr.join('')).toMatch(/ApiKeys/); // the audit line is there…
    expect(stderr.join('')).not.toContain(SECRET); // …without the secret
  });

  it('a bMS error answers with its problem text, no secret', async () => {
    failCreate = true;
    const r = await call('create_api_key', args);
    expect(r.isError).toBe(true);
    expect(r.text).toContain('An API key with this name exists.');
    expect(r.text).not.toContain(SECRET);
  });

  it('with writes off it is not listed and refused by the write gate, sending nothing', async () => {
    process.env.ALLOW_WRITE_OPERATIONS = 'false';
    expect(await tool('create_api_key')).toBeUndefined();
    const r = await call('create_api_key', args);
    expect(r.text).toBe("Write operation 'create_api_key' is disabled. Set ALLOW_WRITE_OPERATIONS=true to enable write operations.");
    expect(sent).toEqual([]);
  });

  it('with writes on but ALLOW_SECRET_READ off it is refused by the secret gate, sending nothing', async () => {
    process.env.ALLOW_SECRET_READ = 'false';
    const r = await call('create_api_key', args);
    expect(r.isError).toBe(true);
    expect(r.text).toContain("Secret-returning operation 'create_api_key' is disabled because it returns a live credential (the new API key's secret)");
    expect(r.text).toContain('independent of ALLOW_WRITE_OPERATIONS');
    expect(sent).toEqual([]);
  });

  it('requires name only, and says it needs both gates', async () => {
    const t = (await tool('create_api_key'))!;
    expect(t.inputSchema.required).toEqual(['name']);
    expect(t.description).toContain('Needs ALLOW_SECRET_READ=true as well as ALLOW_WRITE_OPERATIONS=true');
    expect(t.annotations).toMatchObject({ readOnlyHint: false });
  });

  it.each([
    [{ comment: 'x' }, 'name'],
    [{ name: '' }, 'name'],
    [{ name: 'x'.repeat(257) }, 'name'],
    [{ name: 'n', expirationDate: '30.06.2027' }, 'expirationDate must be a date as yyyy-MM-dd'],
    [{ name: 'n', comment: 'x'.repeat(4001) }, 'comment must be at most 4000 characters'],
    [{ name: 'n', securityProfiles: [] }, 'securityProfiles must contain at least 1 items'],
    [{ name: 'n', securityProfiles: ['admin'] }, 'every securityProfiles entry must be a security profile GUID'],
  ])('%j is refused before anything is sent (%s)', async (bad, message) => {
    expect(await refusal('create_api_key', bad)).toContain(message);
    expect(sent).toEqual([]);
  });
});

describe('update_api_key (#357)', () => {
  it('PATCHes application/json-patch+json with only the given fields, under the spec\'s paths', async () => {
    Object.assign(process.env, { ALLOW_SECRET_READ: 'false' }); // the answer has no secret: the write gate is enough
    const r = await call('update_api_key', { id: KEY, isActive: false, expirationDate: '2026-12-31', securityProfiles: [PROFILE] });
    expect(r.isError).toBe(false);
    expect(routes()).toEqual([['PATCH', `${BASE}/ApiKeys/${KEY}`]]);
    expect(sent[0].type).toContain('application/json-patch+json');
    expect(JSON.parse(sent[0].body)).toEqual([
      { op: 'replace', path: '/ExpirationDate', value: '2026-12-31' },
      { op: 'replace', path: '/IsActive', value: false },
      { op: 'replace', path: '/SecurityProfiles', value: [PROFILE] },
    ]);
  });

  it.each([
    [{ id: KEY }, 'update_api_key needs at least one field to change: name, expirationDate, comment, isActive, isAvailableViaGateway, securityProfiles'],
    [{ id: KEY, securityProfiles: ['nope'] }, 'every securityProfiles entry must be a security profile GUID'],
    [{ id: 'nope', name: 'x' }, 'id must be a valid GUID'],
  ])('%j is refused before anything is sent', async (bad, message) => {
    expect(await refusal('update_api_key', bad)).toContain(message);
    expect(sent).toEqual([]);
  });

  it('with writes off it is refused by the write gate, sending nothing', async () => {
    process.env.ALLOW_WRITE_OPERATIONS = 'false';
    expect((await call('update_api_key', { id: KEY, name: 'x' })).text).toContain("Write operation 'update_api_key' is disabled");
    expect(sent).toEqual([]);
  });
});

describe('delete_api_key (#357)', () => {
  it('DELETEs /ApiKeys/{id}, says the key can no longer be used, and is marked destructive', async () => {
    const r = await call('delete_api_key', { id: KEY });
    expect(r.isError).toBe(false);
    expect(r.text).toBe(`API key ${KEY} deleted: it can no longer be used.`);
    expect(routes()).toEqual([['DELETE', `${BASE}/ApiKeys/${KEY}`]]);
    expect((await tool('delete_api_key'))!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});

describe('API key tools on bMS 26R1 (#357)', () => {
  beforeEach(() => { process.env.BCONNECT_RELEASE = '26R1'; });

  it('only list_api_keys is listed', async () => {
    expect((await client.listTools()).tools.map((t) => t.name).filter((n) => n.includes('api_key')).sort()).toEqual(['list_api_keys']);
  });

  it.each(['get_api_key', 'create_api_key', 'update_api_key', 'delete_api_key'])('%s is refused naming 26R2 and sends nothing', async (name) => {
    expect(await refusal(name, { id: KEY, name: 'x' })).toMatch(/only available in bMS 26R2; this server uses 26R1/);
    expect(sent).toEqual([]);
  });
});
