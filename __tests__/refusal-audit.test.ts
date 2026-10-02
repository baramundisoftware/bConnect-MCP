/**
 * Refused requests are audited (#168).
 *
 * The secret-route gate and the canonical-path check refuse a request before
 * it is sent, and before the audit step that records sent requests. A refusal
 * is a security event in its own right (for example a model trying to read a
 * LAPS password), so it is recorded at every audit level except none, flagged
 * security-sensitive, with the path escaped so it can't forge log lines.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { AuditLogger, type AuditLevel, type AuditLogEntry } from '../packages/mcp-core/src/audit-logger.js';
import { BConnectClientBase } from '../packages/mcp-core/src/bconnect-client-base.js';

const ID = '00000000-0000-4000-8000-000000000001';
const BITLOCKER = `/defensecontrol/v2.0/BitLocker/WindowsEndpoints/${ID}/Secrets`;
const LAPS = `/defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/${ID}`;
const TRAVERSAL = `/endpoints/v2.0/Endpoints/../../../variables/v2.0/VariableDefinitions`;

const sent: string[] = [];
const msw = setupServer(http.all('*', ({ request }) => {
  sent.push(`${request.method} ${new URL(request.url).pathname}`);
  return HttpResponse.json({ ok: true });
}));
const saved = process.env.ALLOW_SECRET_READ;

type Raw = { client: { get: (u: string) => Promise<unknown>; patch: (u: string, d: unknown) => Promise<unknown> } };
function audited(level: AuditLevel) {
  const entries: AuditLogEntry[] = [];
  const client = new BConnectClientBase({
    baseUrl: 'http://bms.audit.test/bconnect', username: 'auditor', password: 'p',
    auditLog: { level, logHandler: (entry) => entries.push(entry) },
  }) as unknown as Raw;
  return { client: client.client, entries };
}

beforeAll(() => msw.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  sent.length = 0;
  vi.restoreAllMocks();
  if (saved === undefined) delete process.env.ALLOW_SECRET_READ; else process.env.ALLOW_SECRET_READ = saved;
});
afterAll(() => msw.close());

describe('a refused request is audited', () => {
  it.each(['security', 'write', 'all'] as const)('at %s: a refused BitLocker and LAPS read each leave one security entry', async (level) => {
    process.env.ALLOW_SECRET_READ = '';
    const { client, entries } = audited(level);
    await expect(client.get(BITLOCKER)).rejects.toThrow(/ALLOW_SECRET_READ=true/);
    await expect(client.patch(LAPS, [])).rejects.toThrow(/ALLOW_SECRET_READ=true/);
    expect(sent).toEqual([]);
    expect(entries.map((e) => [e.method, e.path, e.level, e.securitySensitive, e.user])).toEqual([
      ['GET', BITLOCKER, 'warn', true, 'auditor'],
      ['PATCH', LAPS, 'warn', true, 'auditor'],
    ]);
    expect(entries.every((e) => /^Refused: /.test(e.error ?? ''))).toBe(true);
  });

  it('at security: a path refused as non-canonical leaves one security entry', async () => {
    const { client, entries } = audited('security');
    await expect(client.get(TRAVERSAL)).rejects.toThrow(/not in canonical form/);
    expect(sent).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ method: 'GET', path: TRAVERSAL, level: 'warn', securitySensitive: true });
  });

  it('at none: nothing is recorded, and the refusal still happens', async () => {
    process.env.ALLOW_SECRET_READ = '';
    const { client, entries } = audited('none');
    await expect(client.get(BITLOCKER)).rejects.toThrow(/ALLOW_SECRET_READ=true/);
    expect(entries).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('an allowed request is recorded once, not as a refusal', async () => {
    process.env.ALLOW_SECRET_READ = 'true';
    const { client, entries } = audited('security');
    await client.get(BITLOCKER);
    expect(sent).toEqual([`GET /bconnect${BITLOCKER}`]);
    expect(entries.some((e) => /^Refused/.test(e.error ?? ''))).toBe(false);
  });

  it('writes a refusal as one stderr line, with control characters in the path escaped', async () => {
    const toStderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const toStdout = vi.spyOn(process.stdout, 'write');
    const forged = `${TRAVERSAL}\n[SECURITY AUDIT] forged \u001b[2J`;
    // No custom handler: the default one writes to stderr.
    const raw = new BConnectClientBase({ baseUrl: 'http://bms.audit.test/bconnect', username: 'auditor', password: 'p', auditLog: { level: 'security' } }) as unknown as Raw;
    await expect(raw.client.get(forged)).rejects.toThrow(/not in canonical form/);
    const lines = toStderr.mock.calls.map(([chunk]) => String(chunk));
    expect(lines).toHaveLength(1);
    expect(lines[0].match(/\n/g)).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[SECURITY AUDIT\] .* GET .*\\u000a\[SECURITY AUDIT\] forged \\u001b\[2J - REFUSED: /);
    expect(toStdout).not.toHaveBeenCalled();
  });

  it('escapes DEL, C1 controls and Unicode line separators in an audit line', () => {
    const toStderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    new AuditLogger({ level: 'security', username: 'auditor' })
      .logRefusal('GET', '/x\u007f\u0085\u009b\u2028\u2029y', 'test');
    const line = String(toStderr.mock.calls[0][0]);
    expect(line).toContain('/x\\u007f\\u0085\\u009b\\u2028\\u2029y');
    expect(line.slice(0, -1)).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
  });

  it('records no refusal at level none', () => {
    const entries: AuditLogEntry[] = [];
    new AuditLogger({ level: 'none', username: 'auditor', logHandler: (e) => entries.push(e) }).logRefusal('GET', BITLOCKER, 'test');
    expect(entries).toEqual([]);
  });

  it('keeps the refusal when a custom audit handler throws', async () => {
    process.env.ALLOW_SECRET_READ = '';
    const raw = new BConnectClientBase({
      baseUrl: 'http://bms.audit.test/bconnect', username: 'auditor', password: 'p',
      auditLog: { level: 'security', logHandler: () => { throw new Error('log sink down'); } },
    }) as unknown as Raw;
    await expect(raw.client.get(BITLOCKER)).rejects.toThrow(/ALLOW_SECRET_READ=true/);
    expect(sent).toEqual([]);
  });
});
