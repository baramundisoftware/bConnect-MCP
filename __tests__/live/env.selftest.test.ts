/**
 * Self-test of the live tier's environment handling. Needs no bMS.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from '../lib/exerciser.js';
import { checkReachable, childEnv, controlledKeys, controlledKeysIn, loadLiveConfig } from './lib/env.js';
import { assertExercised } from './lib/report.js';

const dir = mkdtempSync(join(tmpdir(), 'live-env-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function envFile(name: string, lines: string[]): string {
  const file = join(dir, name);
  writeFileSync(file, lines.join('\n'));
  return file;
}

const BASE = 'BCONNECT_BASE_URL=https://bms.selftest.invalid:444/bconnect';

describe('live env: isolated', () => {
  it('controls every variable the servers and the shared core read', () => {
    const keys = controlledKeys(ROOT);
    for (const key of ['BCONNECT_BASE_URL', 'BCONNECT_API_KEY', 'BCONNECT_USERNAME', 'BCONNECT_PASSWORD',
      'BCONNECT_CA_CERT_PATH', 'NODE_TLS_REJECT_UNAUTHORIZED', 'BCONNECT_AUDIT_LEVEL',
      'BCONNECT_RATE_LIMIT_ENABLED', 'BCONNECT_RATE_LIMIT_MAX_REQUESTS', 'BCONNECT_RATE_LIMIT_WINDOW_MS',
      'MCP_TRANSPORT', 'MCP_PORT', 'ALLOW_WRITE_OPERATIONS', 'ALLOW_SECRET_READ',
      'BCONNECT_SKIP_CONNECTIVITY_CHECK', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY']) {
      expect(keys, key).toContain(key);
    }
  });

  it('takes the keys from real reads, not from names in comments or strings', () => {
    const keys = controlledKeysIn([{ file: 'a.ts', text: [
      '// BCONNECT_ONLY_IN_A_COMMENT is documented here',
      "const hint = 'set BCONNECT_ONLY_IN_A_STRING';",
      'const url = process.env.BCONNECT_REAL_READ;',
      "const { MCP_DESTRUCTURED } = process.env;",
      "const tls = process['env'].NODE_TLS_REJECT_UNAUTHORIZED;",
    ].join('\n') }]);
    expect(keys).toContain('BCONNECT_REAL_READ');
    expect(keys).toContain('MCP_DESTRUCTURED');
    expect(keys).toContain('NODE_TLS_REJECT_UNAUTHORIZED');
    expect(keys).not.toContain('BCONNECT_ONLY_IN_A_COMMENT');
    expect(keys).not.toContain('BCONNECT_ONLY_IN_A_STRING');
  });

  it('fails on a read whose name cannot be known, which isolation could not cover', () => {
    expect(() => controlledKeysIn([{ file: 'b.ts', text: 'const k = "BCONNECT_" + x; export const v = process.env[k];' }]))
      .toThrow(/b\.ts/);
  });

  it('sets every controlled key, empty when the file has no value', () => {
    const config = loadLiveConfig({ root: ROOT, file: envFile('basic.env', [BASE, 'BCONNECT_USERNAME=u', 'BCONNECT_PASSWORD=p']), shell: {} });
    for (const key of controlledKeys(ROOT)) expect(config.env, key).toHaveProperty(key);
    expect(config.env.BCONNECT_API_KEY).toBe('');
    expect(config.env.BCONNECT_CA_CERT_PATH).toBe('');
    expect(config.env.BCONNECT_USERNAME).toBe('u');
  });

  it('ignores credential, TLS and proxy values from the shell', () => {
    const shell = { BCONNECT_API_KEY: 'from-shell', NODE_TLS_REJECT_UNAUTHORIZED: '0', HTTPS_PROXY: 'http://proxy.invalid:8080', PATH: '/bin' };
    const config = loadLiveConfig({ root: ROOT, file: envFile('shell.env', [BASE, 'BCONNECT_USERNAME=u', 'BCONNECT_PASSWORD=p']), shell });
    expect(config.env.BCONNECT_API_KEY).toBe('');
    expect(config.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe('');
    expect(config.env.HTTPS_PROXY).toBe('');
    expect(config.tlsVerified).toBe(true);
    const child = childEnv(config, shell);
    expect(child.BCONNECT_API_KEY).toBe('');
    expect(child.HTTPS_PROXY).toBe('');
    expect(child.PATH).toBe('/bin');
  });

  it('keeps the write and secret gates closed and the startup check on', () => {
    for (const line of ['ALLOW_WRITE_OPERATIONS=true', 'ALLOW_SECRET_READ=true', 'BCONNECT_SKIP_CONNECTIVITY_CHECK=true', 'MCP_TRANSPORT=http']) {
      expect(() => loadLiveConfig({ root: ROOT, file: envFile('gate.env', [BASE, line]), shell: {} }), line)
        .toThrow(/must not set/);
    }
    const config = loadLiveConfig({ root: ROOT, file: envFile('gates.env', [BASE]), shell: { ALLOW_WRITE_OPERATIONS: 'true' } });
    expect(config.env.ALLOW_WRITE_OPERATIONS).toBe('');
    expect(config.env.ALLOW_SECRET_READ).toBe('');
    expect(config.env.BCONNECT_SKIP_CONNECTIVITY_CHECK).toBe('');
  });

  it('reports the effective TLS setting', () => {
    const off = loadLiveConfig({ root: ROOT, file: envFile('off.env', [BASE, 'NODE_TLS_REJECT_UNAUTHORIZED=0']), shell: {} });
    expect(off.tlsVerified).toBe(false);
    const ca = envFile('ca.pem', ['-----BEGIN CERTIFICATE-----', 'x', '-----END CERTIFICATE-----']);
    const on = loadLiveConfig({ root: ROOT, file: envFile('on.env', [BASE, `BCONNECT_CA_CERT_PATH=${ca}`]), shell: {} });
    expect(on.tlsVerified).toBe(true);
    expect(on.caFile).toBe(true);
  });

  it('reports no TLS for a plain-HTTP base URL, whatever NODE_TLS_REJECT_UNAUTHORIZED says', () => {
    const plain = loadLiveConfig({ root: ROOT, file: envFile('http.env', ['BCONNECT_BASE_URL=http://bms.selftest.invalid/bconnect']), shell: {} });
    expect(plain.tlsVerified).toBe(false);
    expect(plain.plainHttp).toBe(true);
  });

  it('refuses NODE_EXTRA_CA_CERTS from the shell, which the test process cannot drop', () => {
    expect(() => loadLiveConfig({ root: ROOT, file: envFile('extra.env', [BASE]), shell: { NODE_EXTRA_CA_CERTS: 'C:/ca.pem' } }))
      .toThrow(/NODE_EXTRA_CA_CERTS/);
  });
});

describe('live env: fails loudly when misconfigured', () => {
  it('fails when the env file does not exist', () => {
    expect(() => loadLiveConfig({ root: ROOT, file: join(dir, 'missing.env'), shell: {} })).toThrow(/does not exist/);
  });

  it('fails when the file has no base URL, or an invalid one', () => {
    expect(() => loadLiveConfig({ root: ROOT, file: envFile('nourl.env', ['BCONNECT_USERNAME=u']), shell: {} }))
      .toThrow(/BCONNECT_BASE_URL/);
    expect(() => loadLiveConfig({ root: ROOT, file: envFile('badurl.env', ['BCONNECT_BASE_URL=bms:444']), shell: {} }))
      .toThrow(/BCONNECT_BASE_URL/);
  });

  it('fails when the CA file does not exist', () => {
    expect(() => loadLiveConfig({ root: ROOT, file: envFile('noca.env', [BASE, `BCONNECT_CA_CERT_PATH=${join(dir, 'none.pem')}`]), shell: {} }))
      .toThrow(/BCONNECT_CA_CERT_PATH/);
  });

  it('fails when the bMS cannot be reached', async () => {
    const config = loadLiveConfig({ root: ROOT, file: envFile('closed.env', ['BCONNECT_BASE_URL=http://127.0.0.1:1/bconnect']), shell: {} });
    await expect(checkReachable(config)).rejects.toThrow(/not reachable/);
  });

  it('fails when nothing was exercised', () => {
    expect(() => assertExercised({ startups: 0, calls: 0 })).toThrow(/nothing/);
    expect(() => assertExercised({ startups: 13, calls: 0 })).toThrow(/no read tool/);
    expect(() => assertExercised({ startups: 13, calls: 90 })).not.toThrow();
  });
});
