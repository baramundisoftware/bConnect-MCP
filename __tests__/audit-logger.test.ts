/**
 * Audit levels and audit output (#168).
 *
 * Levels are cumulative: none < security < write < all. A security-sensitive
 * read (a BitLocker secret, a LAPS password) is recorded from `security` up;
 * writes from `write` up; everything at `all`.
 *
 * Audit lines go to stderr. stdout carries JSON-RPC in stdio mode, so a line
 * there breaks the MCP connection.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditLogger, type AuditLevel } from '../packages/mcp-core/src/audit-logger.js';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const REQUESTS = {
  read: ['GET', '/endpoints/v2.0/WindowsEndpoints'],
  write: ['POST', '/jobs/v2.0/JobInstances'],
  bitLockerSecret: ['GET', `/defensecontrol/v2.0/BitLocker/WindowsEndpoints/${ID}/Secrets`],
  lapsPassword: ['GET', `/defensecontrol/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/${ID}`],
} as const;
type Kind = keyof typeof REQUESTS;

const RECORDED: Record<AuditLevel, Kind[]> = {
  none: [],
  security: ['bitLockerSecret', 'lapsPassword'],
  write: ['write', 'bitLockerSecret', 'lapsPassword'],
  all: ['read', 'write', 'bitLockerSecret', 'lapsPassword'],
};

describe('audit levels are cumulative', () => {
  for (const [level, kinds] of Object.entries(RECORDED) as [AuditLevel, Kind[]][]) {
    it(`${level} records ${kinds.join(', ') || 'nothing'}`, () => {
      const logger = new AuditLogger({ level, username: 'auditor', logHandler: () => {} });
      const recorded = (Object.keys(REQUESTS) as Kind[]).filter((kind) => logger.shouldLog(...REQUESTS[kind]));
      expect(recorded).toEqual(kinds);
    });
  }

  it('flags a LAPS password read as security-sensitive', () => {
    const logger = new AuditLogger({ level: 'all', username: 'auditor', logHandler: () => {} });
    expect(logger.isSecuritySensitive(REQUESTS.lapsPassword[1], 'GET')).toBe(true);
    expect(logger.isSecuritySensitive(REQUESTS.read[1], 'GET')).toBe(false);
  });
});

describe('default audit output', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes every audit line to stderr and nothing to stdout', () => {
    const toStdout = [vi.spyOn(process.stdout, 'write'), vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'debug')];
    const toStderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = new AuditLogger({ level: 'all', username: 'auditor', includeParameters: true });
    const start = logger.logRequest('POST', '/jobs/v2.0/JobInstances', { name: 'x' });
    logger.logResponse('POST', '/jobs/v2.0/JobInstances', 201, start);
    logger.logResponse('GET', '/endpoints/v2.0/WindowsEndpoints', 302, start);
    logger.logError('GET', '/endpoints/v2.0/WindowsEndpoints', new Error('boom'), start);
    for (const spy of toStdout) expect(spy).not.toHaveBeenCalled();
    const lines = toStderr.mock.calls.map(([chunk]) => String(chunk));
    expect(lines.filter((l) => /^\[AUDIT\] \d{4}-/.test(l))).toHaveLength(4);
    expect(lines.some((l) => l.includes('Parameters:') && l.includes('"name": "x"'))).toBe(true);
    expect(lines.every((l) => l.endsWith('\n'))).toBe(true);
  });
});
