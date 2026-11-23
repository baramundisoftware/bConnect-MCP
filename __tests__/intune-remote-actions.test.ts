/**
 * Intune remote actions on Windows endpoints, bMS 26R2 (#356).
 *
 * One tool, trigger_intune_remote_action, with the action as argument: each action calls its
 * own operation (POST /WindowsEndpoints/{id}/IntuneRemoteAction…). FreshStart and Wipe send
 * their options as the spec's request bodies, the others no body. Decided with the maintainer:
 * the write gate only (no extra setting, no confirmation argument), logged as a write; the
 * description names the four actions that can't be undone, and the tool is annotated destructive.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const ENDPOINT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BASE = `/endpoints/v2.0/WindowsEndpoints/${ENDPOINT}`;

let sent: Array<{ method: string; path: string; body: string }> = [];
let answer: boolean | string = true;
const msw = setupServer(http.all('*', async ({ request }) => {
  sent.push({ method: request.method, path: new URL(request.url).pathname.replace(/^\/bconnect/, ''), body: await request.text() });
  return HttpResponse.json(answer);
}));

let client: Client;
const saved = { ...process.env };
beforeAll(async () => {
  Object.assign(process.env, {
    BCONNECT_BASE_URL: 'https://bms.intune.test/bconnect', BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p',
    BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', BCONNECT_RELEASE: '26R2', ALLOW_WRITE_OPERATIONS: 'true',
  });
  msw.listen({ onUnhandledRequest: 'error' });
  const { createServer } = await import('../bconnect-endpoints-mcp/src/index.ts');
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'intune-remote-actions', version: '0' });
  await Promise.all([createServer().server.connect(a), client.connect(b)]);
});
beforeEach(() => { Object.assign(process.env, { BCONNECT_RELEASE: '26R2', ALLOW_WRITE_OPERATIONS: 'true' }); answer = true; });
afterEach(() => { sent = []; });
afterAll(async () => { await client.close(); msw.close(); process.env = saved; });

const call = async (args: Record<string, unknown>) => {
  const r = await client.callTool({ name: 'trigger_intune_remote_action', arguments: args });
  return { isError: r.isError === true, text: (r.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n') };
};
const refusal = async (args: Record<string, unknown>): Promise<string> => {
  try {
    await client.callTool({ name: 'trigger_intune_remote_action', arguments: args });
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('not refused');
};
const tool = async () => (await client.listTools()).tools.find((t) => t.name === 'trigger_intune_remote_action');

describe('each action calls its own operation (AC 2)', () => {
  it.each([
    ['Sync', 'IntuneRemoteActionSync', {}, ''],
    ['Reboot', 'IntuneRemoteActionReboot', {}, ''],
    ['Retire', 'IntuneRemoteActionRetire', {}, ''],
    ['AutopilotReset', 'IntuneRemoteActionWindowsAutopilotReset', {}, ''],
    ['FreshStart', 'IntuneRemoteActionFreshRestart', { keepUserData: true }, '{"keepUserData":true}'],
    ['FreshStart', 'IntuneRemoteActionFreshRestart', {}, '{}'],
    ['Wipe', 'IntuneRemoteActionWipe', { keepUserData: false, keepEnrollmentData: true }, '{"keepUserData":false,"keepEnrollmentData":true}'],
  ])('%s → POST …/%s %j', async (action, operation, options, body) => {
    const r = await call({ id: ENDPOINT, action, ...options });
    expect(r.isError).toBe(false);
    expect(r.text).toBe(`Intune remote action ${action} triggered for endpoint ${ENDPOINT}.`);
    expect(sent.map((s) => [s.method, s.path, s.body])).toEqual([['POST', `${BASE}/${operation}`, body]]);
  });

  it('says so when bMS answers false', async () => {
    answer = false;
    expect((await call({ id: ENDPOINT, action: 'Sync' })).text).toBe(`Intune remote action Sync was not triggered for endpoint ${ENDPOINT} (bMS answered false).`);
  });

  it.each([['Sync', 'keepUserData'], ['Reboot', 'keepEnrollmentData'], ['FreshStart', 'keepEnrollmentData']])('%s with %s is refused, naming the actions that take it, and sends nothing', async (action, option) => {
    expect(await refusal({ id: ENDPOINT, action, [option]: true })).toContain(`${option} is not available for trigger_intune_remote_action with action "${action}"`);
    expect(sent).toEqual([]);
  });

  it.each([[{ id: ENDPOINT }, 'needs action'], [{ id: ENDPOINT, action: 'Delete' }, 'Unknown action'], [{ id: 'nope', action: 'Sync' }, 'id must be a valid GUID']])('%j is refused before anything is sent', async (args, message) => {
    expect(await refusal(args)).toContain(message);
    expect(sent).toEqual([]);
  });
});

describe('the listing (AC 1, AC 4)', () => {
  it('offers the six actions, and the options only for the actions that take them', async () => {
    const t = (await tool())!;
    const props = t.inputSchema.properties as Record<string, { enum?: string[]; description?: string }>;
    expect(props.action.enum).toEqual(['Sync', 'Reboot', 'Retire', 'AutopilotReset', 'FreshStart', 'Wipe']);
    expect(props.keepUserData.description).toContain('Only for action "FreshStart"; action "Wipe".');
    expect(props.keepEnrollmentData.description).toContain('Only for action "Wipe".');
    expect(t.inputSchema.required).toEqual(['id', 'action']);
  });

  it('names the actions that can\'t be undone, and is annotated destructive', async () => {
    const t = (await tool())!;
    expect(t.description).toContain("four that CAN'T BE UNDONE: Retire");
    expect(t.description).toMatch(/AutopilotReset.*FreshStart.*Wipe/);
    expect(t.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});

describe('the write gate (AC 1, AC 3)', () => {
  beforeEach(() => { process.env.ALLOW_WRITE_OPERATIONS = 'false'; });

  it('with writes off it is not listed', async () => {
    expect(await tool()).toBeUndefined();
  });

  it.each(['Sync', 'Wipe'])('with writes off, %s is refused by the write gate and sends nothing', async (action) => {
    const r = await call({ id: ENDPOINT, action });
    expect(r.text).toBe("Write operation 'trigger_intune_remote_action' is disabled. Set ALLOW_WRITE_OPERATIONS=true to enable write operations.");
    expect(sent).toEqual([]);
  });
});

describe('on bMS 26R1 (AC 1)', () => {
  beforeEach(() => { process.env.BCONNECT_RELEASE = '26R1'; });

  it('is not listed and is refused naming 26R2, sending nothing', async () => {
    expect(await tool()).toBeUndefined();
    expect(await refusal({ id: ENDPOINT, action: 'Sync' })).toMatch(/only available in bMS 26R2; this server uses 26R1/);
    expect(sent).toEqual([]);
  });
});
