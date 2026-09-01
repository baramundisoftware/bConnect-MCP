/**
 * Audit level 'security' must actually cover the security-sensitive routes (SEC-4).
 *
 * The defect: `BCONNECT_AUDIT_LEVEL=security` is the setting an operator picks
 * to watch credential access, and it produced no record at all for a LAPS
 * password read or a BitLocker PIN change, because the classifier's patterns
 * did not match the routes the code issues.
 */

import { describe, it, expect } from 'vitest';
import { AuditLogger, redactSensitiveParameters, type AuditLogEntry } from '@bconnect/mcp-core';

const ID = 'e57a7e00-0000-4000-8000-000000000009';
const BASE = '/defensecontrol/v2.0';
const LAPS = `${BASE}/LocalAdministrativeAccounts/WindowsEndpoints/${ID}`;
const PIN = `${BASE}/BitLocker/WindowsEndpoints/${ID}/Pin`;
const SECRETS = `${BASE}/BitLocker/WindowsEndpoints/${ID}/Secrets`;

function capture(config: Record<string, unknown> = {}) {
  const entries: AuditLogEntry[] = [];
  const logger = new AuditLogger({
    level: 'security',
    username: 'svcacct',
    logHandler: (entry: AuditLogEntry) => entries.push(entry),
    ...config,
  } as never);
  return { logger, entries };
}

describe("audit level 'security'", () => {
  it('records the LAPS credential read that used to produce nothing', () => {
    const { logger, entries } = capture();

    logger.logRequest('GET', LAPS);

    expect(entries).toHaveLength(1);
    expect(entries[0].securitySensitive).toBe(true);
  });

  it('records the BitLocker PIN change that used to produce nothing', () => {
    const { logger, entries } = capture();

    logger.logRequest('PATCH', PIN);

    expect(entries).toHaveLength(1);
    expect(entries[0].securitySensitive).toBe(true);
  });

  it('still records the one route the old patterns did match', () => {
    const { logger, entries } = capture();
    logger.logRequest('GET', SECRETS);
    expect(entries).toHaveLength(1);
  });

  it('does not start recording ordinary estate reads', () => {
    const { logger, entries } = capture();

    logger.logRequest('GET', '/endpoints/v2.0/Endpoints');
    logger.logResponse('GET', '/endpoints/v2.0/Endpoints', 200, Date.now());

    expect(entries).toHaveLength(0);
  });

  it('tags responses and errors on those routes too', () => {
    const { logger, entries } = capture();

    logger.logResponse('GET', LAPS, 200, Date.now());
    logger.logError('PATCH', PIN, new Error('boom'), Date.now());

    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.securitySensitive)).toBe(true);
  });
});

describe('parameter redaction (SEC-4)', () => {
  it('omits parameters entirely when includeParameters is off', () => {
    const { logger, entries } = capture({ level: 'all' } as never);

    logger.logRequest('PATCH', LAPS, { password: 'hunter2' });

    expect(entries[0].parameters).toBeUndefined();
  });

  it('redacts credential-shaped keys when it is on', () => {
    const { logger, entries } = capture({ level: 'all', includeParameters: true } as never);

    logger.logRequest('PATCH', LAPS, {
      DisplayName: 'WORKSTATION1',
      password: 'hunter2',
      apiKey: 'abc',
      nested: { newPassword: 'hunter3' },
    });

    const serialised = JSON.stringify(entries[0].parameters);
    expect(serialised).not.toContain('hunter2');
    expect(serialised).not.toContain('hunter3');
    expect(serialised).not.toContain('abc');
    expect(serialised).toContain('WORKSTATION1');
  });

  it('redacts a JSON Patch that targets a secret field by path', () => {
    const patched = redactSensitiveParameters([
      { op: 'replace', path: '/displayName', value: 'WORKSTATION1' },
      { op: 'replace', path: '/password', value: 'hunter2' },
    ]);

    const serialised = JSON.stringify(patched);
    expect(serialised).not.toContain('hunter2');
    expect(serialised).toContain('WORKSTATION1');
  });

  it('passes ordinary query parameters through untouched', () => {
    expect(redactSensitiveParameters({ PageSize: 1000, Page: 0 })).toEqual({ PageSize: 1000, Page: 0 });
  });
});
