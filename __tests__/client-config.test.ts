/**
 * Client config from the environment (REQ-SRV-019).
 *
 * One function in the shared core turns the environment (plus, for the
 * gateway, per-request credentials) into the BConnectClient config. Every
 * server's tool client and startup probe use it, so each variable is pinned
 * here once instead of in 13 copies.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ClientConfigError,
  MissingCredentialsError,
  clientConfigFromEnv,
} from '../packages/mcp-core/src/client-config.js';

const BASIC = { BCONNECT_USERNAME: 'user', BCONNECT_PASSWORD: 'secret' };

describe('clientConfigFromEnv', () => {
  describe('base URL and credentials', () => {
    it('reads base URL, username, password and API key from the environment', () => {
      const config = clientConfigFromEnv({
        BCONNECT_BASE_URL: 'https://bms.internal/bconnect',
        BCONNECT_USERNAME: 'user',
        BCONNECT_PASSWORD: 'secret',
        BCONNECT_API_KEY: 'key',
      });
      expect(config).toMatchObject({
        baseUrl: 'https://bms.internal/bconnect',
        username: 'user',
        password: 'secret',
        apiKey: 'key',
      });
    });

    it('falls back to the placeholder base URL when none is set, as before', () => {
      expect(clientConfigFromEnv(BASIC).baseUrl).toBe('https://bms.example.com:443/bconnect');
      expect(clientConfigFromEnv({ ...BASIC, BCONNECT_BASE_URL: '' }).baseUrl)
        .toBe('https://bms.example.com:443/bconnect');
    });

    it('lets per-request credentials override each environment value', () => {
      const config = clientConfigFromEnv(
        {
          BCONNECT_BASE_URL: 'https://env/bconnect',
          BCONNECT_USERNAME: 'env-user',
          BCONNECT_PASSWORD: 'env-pass',
          BCONNECT_API_KEY: 'env-key',
        },
        { baseUrl: 'https://req/bconnect', username: 'req-user', password: 'req-pass', apiKey: 'req-key' },
      );
      expect(config).toMatchObject({
        baseUrl: 'https://req/bconnect',
        username: 'req-user',
        password: 'req-pass',
        apiKey: 'req-key',
      });
    });

    it('takes a value from the environment when the credentials leave it out', () => {
      const config = clientConfigFromEnv(
        { BCONNECT_BASE_URL: 'https://env/bconnect', BCONNECT_API_KEY: 'env-key' },
        { username: 'req-user', password: 'req-pass' },
      );
      expect(config).toMatchObject({
        baseUrl: 'https://env/bconnect',
        username: 'req-user',
        password: 'req-pass',
        apiKey: 'env-key',
      });
    });

    it('keeps an empty per-request API key as given (decision on empty per-request values: #160)', () => {
      // Pins today's behaviour: credentials fields override with ?? (empty stays empty),
      // only the base URL falls back with ||.
      const config = clientConfigFromEnv({ ...BASIC, BCONNECT_API_KEY: 'env-key' }, { apiKey: '' });
      expect(config.apiKey).toBe('');
    });

    it('accepts an API key alone', () => {
      expect(clientConfigFromEnv({ BCONNECT_API_KEY: 'key' }).apiKey).toBe('key');
    });

    it('accepts username and password without an API key', () => {
      expect(clientConfigFromEnv(BASIC)).toMatchObject({ username: 'user', password: 'secret' });
      expect(clientConfigFromEnv(BASIC).apiKey).toBeUndefined();
    });

    it.each([
      ['nothing', {}],
      ['a username only', { BCONNECT_USERNAME: 'user' }],
      ['a password only', { BCONNECT_PASSWORD: 'secret' }],
      ['empty values', { BCONNECT_API_KEY: '', BCONNECT_USERNAME: '', BCONNECT_PASSWORD: '' }],
    ])('throws MissingCredentialsError given %s', (_label, env) => {
      expect(() => clientConfigFromEnv(env)).toThrow(MissingCredentialsError);
    });

    it('names both ways to authenticate in the error, without any value', () => {
      const error = (() => {
        try {
          clientConfigFromEnv({ BCONNECT_USERNAME: 'only-user-xyz' });
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(MissingCredentialsError);
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain('BCONNECT_API_KEY');
      expect(message).toContain('BCONNECT_USERNAME');
      expect(message).toContain('BCONNECT_PASSWORD');
      expect(message).not.toContain('only-user-xyz');
    });
  });

  describe('TLS', () => {
    it('verifies certificates by default', () => {
      expect(clientConfigFromEnv(BASIC).rejectUnauthorized).toBe(true);
    });

    it('turns verification off only for NODE_TLS_REJECT_UNAUTHORIZED=0', () => {
      expect(clientConfigFromEnv({ ...BASIC, NODE_TLS_REJECT_UNAUTHORIZED: '0' }).rejectUnauthorized).toBe(false);
    });

    it.each(['1', 'false', 'no', '', ' 0'])('keeps verification on for NODE_TLS_REJECT_UNAUTHORIZED=%j', (value) => {
      expect(clientConfigFromEnv({ ...BASIC, NODE_TLS_REJECT_UNAUTHORIZED: value }).rejectUnauthorized).toBe(true);
    });

    it('ignores the removed BCONNECT_REJECT_UNAUTHORIZED switch', () => {
      const config = clientConfigFromEnv({ ...BASIC, BCONNECT_REJECT_UNAUTHORIZED: 'false' });
      expect(config.rejectUnauthorized).toBe(true);
    });

    describe('CA certificate', () => {
      let dir: string | undefined;
      afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
        dir = undefined;
      });

      it('reads the file named by BCONNECT_CA_CERT_PATH', () => {
        dir = mkdtempSync(join(tmpdir(), 'client-config-'));
        const path = join(dir, 'ca.pem');
        writeFileSync(path, '-----BEGIN CERTIFICATE-----\ninternal-ca\n-----END CERTIFICATE-----\n');
        const config = clientConfigFromEnv({ ...BASIC, BCONNECT_CA_CERT_PATH: path });
        expect(config.ca).toBe('-----BEGIN CERTIFICATE-----\ninternal-ca\n-----END CERTIFICATE-----\n');
      });

      it('sets no CA when the variable is unset or empty', () => {
        expect(clientConfigFromEnv(BASIC).ca).toBeUndefined();
        expect(clientConfigFromEnv({ ...BASIC, BCONNECT_CA_CERT_PATH: '' }).ca).toBeUndefined();
      });

      it.each([['empty', ''], ['whitespace-only', '  \n']])(
        'fails on an %s CA file instead of connecting with fewer trusted CAs',
        (_label, content) => {
          dir = mkdtempSync(join(tmpdir(), 'client-config-'));
          const path = join(dir, 'ca.pem');
          writeFileSync(path, content);
          expect(() => clientConfigFromEnv({ ...BASIC, BCONNECT_CA_CERT_PATH: path })).toThrow(
            /BCONNECT_CA_CERT_PATH.*empty/,
          );
        },
      );

      it('fails when the CA file cannot be read, instead of connecting without it', () => {
        expect(() =>
          clientConfigFromEnv({ ...BASIC, BCONNECT_CA_CERT_PATH: join(tmpdir(), 'does-not-exist', 'ca.pem') }),
        ).toThrow();
      });
    });
  });

  describe('audit level', () => {
    it.each(['all', 'write', 'security', 'none'] as const)('passes %s through', (level) => {
      expect(clientConfigFromEnv({ ...BASIC, BCONNECT_AUDIT_LEVEL: level }).auditLog?.level).toBe(level);
    });

    it('defaults to none', () => {
      expect(clientConfigFromEnv(BASIC).auditLog?.level).toBe('none');
    });

    it.each([['ALL', 'all'], [' write ', 'write'], ['Security', 'security'], ['\tNONE\n', 'none']] as const)(
      'ignores case and surrounding spaces: %j is %s', (value, level) => {
        expect(clientConfigFromEnv({ ...BASIC, BCONNECT_AUDIT_LEVEL: value }).auditLog?.level).toBe(level);
      });

    it.each(['', '   '])('treats %j like unset: none', (value) => {
      expect(clientConfigFromEnv({ ...BASIC, BCONNECT_AUDIT_LEVEL: value }).auditLog?.level).toBe('none');
    });

    it.each(['writes', 'verbose', 'yes', '0', 'all write'])('refuses unknown value %j, naming it and the valid levels', (value) => {
      const run = () => clientConfigFromEnv({ ...BASIC, BCONNECT_AUDIT_LEVEL: value });
      expect(run).toThrow(ClientConfigError);
      expect(run).toThrow(`BCONNECT_AUDIT_LEVEL "${value}" isn't valid. Use one of: none, security, write, all.`);
    });

    it('shows an invalid value escaped and shortened, so it cannot forge log lines', () => {
      const run = (value: string) => () => clientConfigFromEnv({ ...BASIC, BCONNECT_AUDIT_LEVEL: value });
      expect(run('all\n[AUDIT] forged \u001b[2J')).toThrow(String.raw`BCONNECT_AUDIT_LEVEL "all\n[AUDIT] forged \u001b[2J" isn't valid.`);
      expect(run('x'.repeat(5000))).toThrow(`BCONNECT_AUDIT_LEVEL "${'x'.repeat(64)}…" isn't valid.`);
    });
  });

  describe('rate limit', () => {
    it('is off unless BCONNECT_RATE_LIMIT_ENABLED=true', () => {
      expect(clientConfigFromEnv(BASIC).rateLimit).toBeUndefined();
      expect(clientConfigFromEnv({ ...BASIC, BCONNECT_RATE_LIMIT_ENABLED: 'false' }).rateLimit).toBeUndefined();
      expect(clientConfigFromEnv({ ...BASIC, BCONNECT_RATE_LIMIT_ENABLED: '1' }).rateLimit).toBeUndefined();
    });

    it('uses 100 requests per 60000 ms by default', () => {
      expect(clientConfigFromEnv({ ...BASIC, BCONNECT_RATE_LIMIT_ENABLED: 'true' }).rateLimit).toEqual({
        enabled: true,
        maxRequests: 100,
        windowMs: 60000,
      });
    });

    it('reads the request count and window', () => {
      const config = clientConfigFromEnv({
        ...BASIC,
        BCONNECT_RATE_LIMIT_ENABLED: 'true',
        BCONNECT_RATE_LIMIT_MAX_REQUESTS: '7',
        BCONNECT_RATE_LIMIT_WINDOW_MS: '1500',
      });
      expect(config.rateLimit).toEqual({ enabled: true, maxRequests: 7, windowMs: 1500 });
    });

    it('falls back to the defaults for values that are not numbers', () => {
      const config = clientConfigFromEnv({
        ...BASIC,
        BCONNECT_RATE_LIMIT_ENABLED: 'true',
        BCONNECT_RATE_LIMIT_MAX_REQUESTS: 'many',
        BCONNECT_RATE_LIMIT_WINDOW_MS: '',
      });
      expect(config.rateLimit).toEqual({ enabled: true, maxRequests: 100, windowMs: 60000 });
    });
  });

  describe('result', () => {
    it('is frozen, so nobody can change the shared settings for one client', () => {
      const config = clientConfigFromEnv({ ...BASIC, BCONNECT_RATE_LIMIT_ENABLED: 'true' });
      expect(Object.isFrozen(config)).toBe(true);
      expect(Object.isFrozen(config.rateLimit)).toBe(true);
      expect(Object.isFrozen(config.auditLog)).toBe(true);
      expect(() => Object.assign(config, { rejectUnauthorized: false })).toThrow(TypeError);
    });
  });

  describe('isolation', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });

    it('reads only the environment it is given, not process.env', () => {
      vi.stubEnv('BCONNECT_BASE_URL', 'https://process-env/bconnect');
      vi.stubEnv('BCONNECT_API_KEY', 'process-key');
      vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');
      vi.stubEnv('BCONNECT_AUDIT_LEVEL', 'all');
      vi.stubEnv('BCONNECT_RATE_LIMIT_ENABLED', 'true');
      const config = clientConfigFromEnv(BASIC);
      expect(config.baseUrl).toBe('https://bms.example.com:443/bconnect');
      expect(config.apiKey).toBeUndefined();
      expect(config.rejectUnauthorized).toBe(true);
      expect(config.auditLog?.level).toBe('none');
      expect(config.rateLimit).toBeUndefined();
    });

    it('does not change the environment it is given', () => {
      const env = { ...BASIC, BCONNECT_AUDIT_LEVEL: ' ALL ' };
      clientConfigFromEnv(env);
      expect(env).toEqual({ ...BASIC, BCONNECT_AUDIT_LEVEL: ' ALL ' });
    });

    it('writes nothing to stdout, which carries JSON-RPC in stdio mode', () => {
      const write = vi.spyOn(process.stdout, 'write');
      const log = vi.spyOn(console, 'log');
      clientConfigFromEnv({ ...BASIC, BCONNECT_AUDIT_LEVEL: 'ALL', BCONNECT_RATE_LIMIT_ENABLED: 'true' });
      expect(write).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    });
  });
});

describe('BCONNECT_RELEASE', () => {
  it.each(['26R1', '25R2'])('accepts %s', (value) => {
    expect(() => clientConfigFromEnv({ ...BASIC, BCONNECT_RELEASE: value })).not.toThrow();
  });

  it('accepts it unset (the servers then use 26R1)', () => {
    expect(() => clientConfigFromEnv({ ...BASIC })).not.toThrow();
  });

  // The servers compare `=== "26R1"`, so each of these would quietly give the 25R2 tool set.
  it.each(['26r1', ' 26R1', '', '2026R1', '26R2'])('refuses %j, naming it and the valid values', (value) => {
    const run = () => clientConfigFromEnv({ ...BASIC, BCONNECT_RELEASE: value });
    expect(run).toThrow(ClientConfigError);
    expect(run).toThrow(`BCONNECT_RELEASE ${JSON.stringify(value)} isn't valid. Use 26R1 or 25R2, spelt exactly so, or leave it unset for 26R1.`);
  });
});
