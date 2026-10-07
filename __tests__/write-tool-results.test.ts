/**
 * Write tools report what bMS returned (REQ-XC-003; #172 rest, #185).
 *
 * MSW answers each operation with a body shaped like its 26R1 response schema.
 * The tools must pass that result on instead of a fixed success text, report a
 * boolean result as what it is, and offer a scheduled restart.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const ID = '66666666-6666-4666-8666-666666666666';
const QR_IMAGE = 'iVBORw0KGgo'.padEnd(4000, 'A');

let sent: Array<{ method: string; path: string; query: string }> = [];
let intuneAnswer: unknown = true;

const answer = (path: string): [unknown, number] => {
  if (path.endsWith('/StartEnrollment') && path.includes('/WindowsEndpoints/')) {
    return [{ installCommand: 'msiexec /i bmsagent.msi TOKEN=abc', validUntil: '2026-10-09T12:00:00Z' }, 200];
  }
  if (path.endsWith('/StartEnrollment') && path.includes('/MacEndpoints/')) {
    return [{ fqdn: 'bms.example.com', token: 'mac-token-123', tokenValidUntilUTC: '2026-10-09T12:00:00Z',
      url: 'https://bms.example.com/enroll/mac', qrCodeText: 'bms://enroll?t=mac-token-123', qrCodeImageBase64: QR_IMAGE }, 200];
  }
  if (path.endsWith('/TriggerInstallationViaIntune')) return [intuneAnswer, 200];
  if (path.endsWith('/MaintenanceWindow')) return [{ id: ID, name: 'Night window', isActive: true }, 200];
  if (path.includes('/NetworkEndpoints/')) return [{ id: ID, displayName: 'Switch-01' }, 200];
  if (path.endsWith('/MSWCleanup')) return [{ wasSuccessful: true, result: '42 files deleted' }, 200];
  if (path.endsWith('/SimulateMSWCleanup')) return [{ simulationResult: 'ok', filesToDelete: ['a.cab', 'b.cab'] }, 200];
  if (path.includes('/SecurityGroups/')) return [{ id: ID, name: 'Helpdesk' }, 200];
  if (path.includes('/SecurityProfiles/')) return [{ id: ID, name: 'Read only' }, 200];
  if (path.includes('/Objects/')) return [{ id: ID, permissions: ['Read'] }, 200];
  if (path.endsWith('/Restart')) return ['2026-10-02T22:00:00Z', 200];
  return [{}, 200];
};

const msw = setupServer(http.all('*', ({ request }) => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/bconnect/, '');
  sent.push({ method: request.method, path, query: url.search });
  const [body, status] = answer(path);
  return HttpResponse.json(body as never, { status });
}));

const saved = { ...process.env };
const clients: Record<string, Client> = {};

beforeAll(async () => {
  Object.assign(process.env, {
    BCONNECT_BASE_URL: 'https://bms.results.test/bconnect', BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p',
    BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', BCONNECT_RELEASE: '26R1', ALLOW_WRITE_OPERATIONS: 'true',
  });
  msw.listen({ onUnhandledRequest: 'error' });
  for (const server of ['endpoints', 'servermanagement']) {
    const { createServer } = await import(`../bconnect-${server}-mcp/src/index.ts`);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'write-tool-results', version: '0' });
    await Promise.all([createServer().server.connect(a), client.connect(b)]);
    clients[server] = client;
  }
});
afterEach(() => { sent = []; intuneAnswer = true; });
afterAll(async () => { await Promise.all(Object.values(clients).map((c) => c.close())); msw.close(); process.env = saved; });

async function call(server: string, name: string, args: Record<string, unknown>) {
  try {
    const r = await clients[server].callTool({ name, arguments: args });
    return { isError: r.isError === true, text: (r.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n') };
  } catch (e) {
    return { isError: true, text: String((e as Error).message) };
  }
}

const PATCH = [{ op: 'replace', path: '/name', value: 'x' }];

describe('enrollment returns what the administrator needs (#172)', () => {
  it('start_enrollment (WindowsEndpoint) returns the install command and its validity', async () => {
    const r = await call('endpoints', 'start_enrollment', { type: 'WindowsEndpoint', id: ID });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('msiexec /i bmsagent.msi TOKEN=abc');
    expect(r.text).toContain('2026-10-09T12:00:00Z');
  });

  it('start_enrollment (MacEndpoint) returns token, URL and QR text, and leaves out the QR image', async () => {
    const r = await call('endpoints', 'start_enrollment', { type: 'MacEndpoint', id: ID });
    for (const v of ['mac-token-123', 'https://bms.example.com/enroll/mac', 'bms://enroll?t=mac-token-123']) expect(r.text).toContain(v);
    expect(r.text).not.toContain(QR_IMAGE);
    expect(r.text).toMatch(/qrCodeImageBase64/);
  });
});

describe('trigger_intune_installation reports the result as it is (#172)', () => {
  it.each([
    [true, /triggered/i, /not triggered/i],
    [false, /not triggered/i, /^$/],
  ])('bMS answers %s', async (value, must, mustNot) => {
    intuneAnswer = value;
    const r = await call('endpoints', 'trigger_intune_installation', { id: ID });
    expect(r.text).toMatch(must);
    if (mustNot.source !== '^$') expect(r.text).not.toMatch(mustNot);
  });

  it('says the result is unknown when bMS answers neither true nor false', async () => {
    intuneAnswer = { unexpected: 1 };
    const r = await call('endpoints', 'trigger_intune_installation', { id: ID });
    expect(r.text).toMatch(/unknown/i);
  });
});

describe('updates and cleanups return the result bMS sent (#172)', () => {
  it.each([
    ['endpoints', 'update_maintenance_window_for_endpoint', { id: ID, maintenanceWindowDefinitionType: 'Never' }, 'Night window'],
    ['endpoints', 'update_maintenance_window_for_logical_group', { id: ID, maintenanceWindowDefinitionType: 'Never' }, 'Night window'],
    ['endpoints', 'update_endpoint', { type: 'NetworkEndpoint', id: ID, displayName: 'Switch-01' }, 'Switch-01'],
    ['servermanagement', 'msw_cleanup', {}, '42 files deleted'],
    ['servermanagement', 'simulate_msw_cleanup', {}, 'b.cab'],
    ['servermanagement', 'update_security_group', { id: ID, patchOperations: PATCH }, 'Helpdesk'],
    ['servermanagement', 'update_security_profile', { id: ID, patchOperations: PATCH }, 'Read only'],
    ['servermanagement', 'update_object_permission', { id: ID, patchOperations: PATCH }, 'Read'],
  ])('%s %s', async (server, name, args, expected) => {
    const r = await call(server, name, args);
    expect(r.isError).toBe(false);
    expect(r.text).toContain(expected);
  });
});

describe('restart_management_server (#185, #172)', () => {
  it('offers a scheduled restart and says that without it the restart is immediate', async () => {
    const tool = (await clients.servermanagement.listTools()).tools.find((t) => t.name === 'restart_management_server')!;
    expect(Object.keys(tool.inputSchema.properties ?? {})).toContain('utcScheduleRestartTime');
    expect(tool.description).toMatch(/immediate/i);
  });

  it('passes the schedule as the query parameter the API declares and reports the restart time', async () => {
    const r = await call('servermanagement', 'restart_management_server', { utcScheduleRestartTime: '2026-10-02T22:00:00Z' });
    expect(sent.map((r) => [r.method, r.path])).toEqual([['POST', '/servermanagement/v2.0/Restart']]);
    expect(new URLSearchParams(sent[0].query).get('utcScheduleRestartTime')).toBe('2026-10-02T22:00:00Z');
    expect(r.text).toContain('2026-10-02T22:00:00Z');
  });

  it('refuses a schedule that is not a date-time, before any request', async () => {
    const r = await call('servermanagement', 'restart_management_server', { utcScheduleRestartTime: 'tonight' });
    expect(r.isError).toBe(true);
    expect(sent).toEqual([]);
  });
});
