/**
 * Env-to-config resolution: PER-13, PER-19, SEC-4's second half, INT-44.
 *
 * `resolveClientConfig` is exported separately from the provider precisely so
 * this mapping can be tested without constructing a client or a server.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveClientConfig } from '@bconnect/mcp-core';

const ENV_KEYS = [
  'BCONNECT_TIMEOUT_MS',
  'BCONNECT_MAX_RETRIES',
  'BCONNECT_RETRY_DELAY_MS',
  'BCONNECT_AUDIT_INCLUDE_PARAMS',
  'BCONNECT_AUDIT_LEVEL',
  'BCONNECT_CA_CERT_PATH',
];

function resolve() {
  return resolveClientConfig({
    factory: (config) => config,
    credentials: { baseUrl: 'https://bms.example.invalid/bconnect', username: 'u', password: 'p' },
    onMissingCredentials: (reason) => {
      throw new Error(`missing ${reason}`);
    },
  });
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  vi.restoreAllMocks();
});

describe('timeout and retry configuration (PER-13)', () => {
  it('defaults to exactly what every deployment ran on before', () => {
    const config = resolve();
    // The values BConnectClientBase already fell back to, so an existing
    // deployment is bit-identical after this change.
    expect(config.timeout).toBe(30000);
    expect(config.maxRetries).toBe(0);
    expect(config.retryDelay).toBe(100);
  });

  it('is finally reachable from the environment', () => {
    process.env.BCONNECT_TIMEOUT_MS = '90000';
    process.env.BCONNECT_MAX_RETRIES = '2';
    process.env.BCONNECT_RETRY_DELAY_MS = '250';

    const config = resolve();

    expect(config.timeout).toBe(90000);
    expect(config.maxRetries).toBe(2);
    expect(config.retryDelay).toBe(250);
  });

  it('falls back rather than propagating a garbage value', () => {
    process.env.BCONNECT_TIMEOUT_MS = 'soon';
    expect(resolve().timeout).toBe(30000);
  });
});

describe('audit configuration (SEC-4, INT-44)', () => {
  it('leaves parameter logging off by default', () => {
    expect(resolve().auditLog?.includeParameters).toBe(false);
  });

  it('wires includeParameters to BCONNECT_AUDIT_INCLUDE_PARAMS', () => {
    process.env.BCONNECT_AUDIT_INCLUDE_PARAMS = 'true';
    expect(resolve().auditLog?.includeParameters).toBe(true);
  });

  it('accepts the four real levels', () => {
    for (const level of ['none', 'security', 'write', 'all'] as const) {
      process.env.BCONNECT_AUDIT_LEVEL = level;
      expect(resolve().auditLog?.level).toBe(level);
    }
  });

  it('warns instead of silently disabling auditing on an unknown level', () => {
    // The root README documented level names that do not exist; an operator who
    // followed it got auditing silently switched off.
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.env.BCONNECT_AUDIT_LEVEL = `info-${Date.now()}`;

    expect(resolve().auditLog?.level).toBe('none');

    const emitted = stderr.mock.calls.map((c) => String(c[0])).join('');
    expect(emitted).toContain('BCONNECT_AUDIT_LEVEL');
    expect(emitted).toContain('DISABLED');
  });

  it('warns once per value, not once per tool call', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.env.BCONNECT_AUDIT_LEVEL = `verbose-${Date.now()}`;

    resolve();
    resolve();
    resolve();

    const warnings = stderr.mock.calls.filter((c) => String(c[0]).includes('BCONNECT_AUDIT_LEVEL'));
    expect(warnings).toHaveLength(1);
  });
});

describe('CA certificate reading (PER-19)', () => {
  let dir: string;
  let pem: string;
  // A whole-millisecond timestamp, so restoring it below is exact — the OS
  // records sub-millisecond mtimes that fs.utimesSync cannot round-trip.
  const FIXED_MTIME = new Date(1_700_000_000_000);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bconnect-ca-'));
    pem = path.join(dir, 'corporate-ca.pem');
    fs.writeFileSync(pem, 'FIRST', 'utf8');
    fs.utimesSync(pem, FIXED_MTIME, FIXED_MTIME);
    process.env.BCONNECT_CA_CERT_PATH = pem;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('still resolves the CA content', () => {
    expect(resolve().ca).toBe('FIRST');
  });

  it('serves a second resolve from memory rather than re-reading the file', () => {
    expect(resolve().ca).toBe('FIRST');

    // Rewrite the content but restore the timestamps: a cache keyed on
    // (path, mtime, size) must not notice. Same byte length on purpose.
    fs.writeFileSync(pem, 'XXXXX', 'utf8');
    fs.utimesSync(pem, FIXED_MTIME, FIXED_MTIME);

    expect(resolve().ca).toBe('FIRST');
  });

  it('picks up a genuinely edited CA bundle', () => {
    expect(resolve().ca).toBe('FIRST');

    fs.writeFileSync(pem, 'SECOND-AND-LONGER', 'utf8');
    fs.utimesSync(pem, new Date(), new Date(Date.now() + 2000));

    // The config fingerprint is computed over the resolved config, so a changed
    // CA must still change it — that is the credential-isolation guard.
    expect(resolve().ca).toBe('SECOND-AND-LONGER');
  });

  it('reports a missing CA file as before', () => {
    process.env.BCONNECT_CA_CERT_PATH = path.join(dir, 'does-not-exist.pem');
    expect(() => resolve()).toThrow(/ENOENT/);
  });
});
