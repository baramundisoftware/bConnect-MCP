/**
 * LAPS and job-folder tools say what their operation does (#177, REQ-XC-003 AC 4).
 *
 * - patch_local_admin_user_credentials can only set the requested expiration
 *   date, so it takes that one field and builds the JSON Patch itself.
 * - trigger_update_on_client is renamed refresh_local_admin_account_expiry; the
 *   old name answers with the new one. Its timeout is 0–60 seconds.
 * - list_job_folders returns folders at every level.
 * Descriptions follow the spec summaries (identical in 25R2 and 26R1).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DATE = '2026-01-01T00:00:00Z';

let sent: Array<{ method: string; path: string; query: Record<string, string>; contentType: string | null; body: string }> = [];
const msw = setupServer(http.all('*', async ({ request }) => {
  const url = new URL(request.url);
  sent.push({ method: request.method, path: url.pathname.replace(/^\/bconnect/, ''), query: Object.fromEntries(url.searchParams), contentType: request.headers.get('content-type'), body: await request.text() });
  return HttpResponse.json(true);
}));

const clients: Record<string, Client> = {};
const saved = { ...process.env };
beforeAll(async () => {
  Object.assign(process.env, {
    BCONNECT_BASE_URL: 'https://bms.laps.test/bconnect', BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p',
    BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', BCONNECT_RELEASE: '26R1', ALLOW_WRITE_OPERATIONS: 'true', ALLOW_SECRET_READ: 'true',
  });
  msw.listen({ onUnhandledRequest: 'error' });
  for (const server of ['defensecontrol', 'jobs']) {
    const { createServer } = await import(`../bconnect-${server}-mcp/src/index.ts`);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const c = new Client({ name: 'laps-tools', version: '0' });
    await Promise.all([createServer().server.connect(a), c.connect(b)]);
    clients[server] = c;
  }
});
afterEach(() => { sent = []; });
afterAll(async () => { await Promise.all(Object.values(clients).map((c) => c.close())); msw.close(); process.env = saved; });

async function call(name: string, args: Record<string, unknown>, server = 'defensecontrol') {
  try {
    const r = await clients[server].callTool({ name, arguments: args });
    return { isError: r.isError === true, text: (r.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n') };
  } catch (e) {
    return { isError: true, text: String((e as Error).message) };
  }
}
const tool = async (name: string, server = 'defensecontrol') => (await clients[server].listTools()).tools.find((t) => t.name === name);

describe('patch_local_admin_user_credentials', () => {
  it('sets the requested expiration date with the JSON Patch the spec shows', async () => {
    const r = await call('patch_local_admin_user_credentials', { endpointId: ID, requestedExpirationDate: DATE });
    expect(r.isError, r.text).toBe(false);
    expect(sent.map((s) => ({ method: s.method, path: s.path, contentType: s.contentType, body: JSON.parse(s.body) }))).toEqual([{
      method: 'PATCH', path: `/defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/${ID}`,
      contentType: 'application/json-patch+json',
      body: [{ op: 'replace', path: '/LocalAdminAccount/RequestedExpirationDate', value: DATE }],
    }]);
  });

  it('takes the date, not a raw patch', async () => {
    const t = await tool('patch_local_admin_user_credentials');
    const props = t?.inputSchema.properties as Record<string, { format?: string }>;
    expect(Object.keys(props)).not.toContain('patchOperations');
    expect(props.requestedExpirationDate.format).toBe('date-time');
    expect(t?.inputSchema.required?.slice().sort()).toEqual(['endpointId', 'requestedExpirationDate']);
  });

  it('refuses a value that is not a date-time, before any request', async () => {
    const r = await call('patch_local_admin_user_credentials', { endpointId: ID, requestedExpirationDate: 'tomorrow' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/requestedExpirationDate must be/);
    expect(sent).toEqual([]);
  });

  it('says only the expiration date can change and a past date rotates the credentials', async () => {
    const d = (await tool('patch_local_admin_user_credentials'))?.description ?? '';
    expect(d).toMatch(/only/i);
    expect(d).toMatch(/requested expiration date/i);
    expect(d).toMatch(/past.*new credentials/i);
    expect(d).toMatch(/refresh_local_admin_account_expiry/);
    expect(d).not.toMatch(/password or username/i);
  });
});

describe('refresh_local_admin_account_expiry', () => {
  it.each([0, 60])('sends timeout %i', async (timeout) => {
    const r = await call('refresh_local_admin_account_expiry', { endpointId: ID, timeout });
    expect(r.isError, r.text).toBe(false);
    expect(sent.map((s) => [s.method, s.path, s.query])).toEqual([
      ['POST', `/defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/${ID}/TriggerUpdateOnClient`, { timeout: String(timeout) }],
    ]);
  });

  it.each([61, -1, 3600, 1.5])('refuses timeout %s before any request', async (timeout) => {
    const r = await call('refresh_local_admin_account_expiry', { endpointId: ID, timeout });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/timeout must be/);
    expect(sent).toEqual([]);
  });

  it('declares timeout as an integer from 0 to 60', async () => {
    const p = (await tool('refresh_local_admin_account_expiry'))?.inputSchema.properties as Record<string, Record<string, unknown>>;
    expect(p.timeout).toMatchObject({ type: 'integer', minimum: 0, maximum: 60 });
  });

  it('says it updates the local admin account expiration, needs the client online, and what it returns', async () => {
    const d = (await tool('refresh_local_admin_account_expiry'))?.description ?? '';
    expect(d).toMatch(/expiration date/i);
    expect(d).toMatch(/local administrator account/i);
    expect(d).toMatch(/online/i);
    expect(d).toMatch(/false/);
    expect(d).not.toMatch(/managed data/i);
  });
});

describe('trigger_update_on_client (old name)', () => {
  it('is no longer listed', async () => {
    expect(await tool('trigger_update_on_client')).toBeUndefined();
  });

  it('answers with the new name and sends nothing', async () => {
    const r = await call('trigger_update_on_client', { endpointId: ID });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('trigger_update_on_client was renamed to refresh_local_admin_account_expiry');
    expect(sent).toEqual([]);
  });
});

describe('list_job_folders', () => {
  it('says it returns folders at every level, with parentId for the hierarchy', async () => {
    const d = (await tool('list_job_folders', 'jobs'))?.description ?? '';
    expect(d).toMatch(/every level/i);
    expect(d).toMatch(/parentId/);
    expect(d).not.toMatch(/root-level/i);
  });
});
