/**
 * Basic credentials as bConnect accepts them (#228, #265).
 *
 * bConnect reads Basic credentials as Latin-1, but its API layer rejects a
 * password with a non-ASCII character (401 "Unauthenticated user") even though
 * the Windows logon behind it accepts it (live, bMS 26.1.161). So:
 * - a password with any non-ASCII character is refused before anything is sent,
 *   at startup and in the tool client; every attempt would cost a failed logon;
 * - a username is still sent as Latin-1; above U+00FF it is refused;
 * - the message names the variable, never the value; API keys aren't checked.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http as mswHttp, HttpResponse } from 'msw';
import { BConnectClientBase } from '../packages/mcp-core/src/bconnect-client-base.js';
import { ClientConfigError, basicAuthHeader, clientConfigFromEnv } from '../packages/mcp-core/src/client-config.js';
import { connect, guardEnv, requiredArguments } from './lib/exerciser.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://bms.latin1.test/bconnect';
const ENV = { BCONNECT_BASE_URL: BASE };

/** The decoded bytes of the Basic header a client sends. */
function headerBytes(username: string, password: string): Buffer {
  const client = new BConnectClientBase({ baseUrl: BASE, username, password }) as unknown as {
    client: { defaults: { headers: { common: Record<string, string> } } };
  };
  const header = client.client.defaults.headers.common.Authorization;
  expect(header.startsWith('Basic ')).toBe(true);
  return Buffer.from(header.slice('Basic '.length), 'base64');
}

function refusal(fn: () => unknown): Error {
  try { fn(); } catch (e) { return e as Error; }
  throw new Error('not refused');
}

const NON_ASCII_PASSWORDS: Array<[string, string]> = [
  ['the section sign', 'Pa\u00A7sword1'],
  ['an umlaut', 'P\u00E4ssword1'],
  ['sharp s', 'Pa\u00DFword1'],
  ['the euro sign', '\u20ACuro-pass'],
  ['a decomposed umlaut (a + U+0308)', 'Paa\u0308ssword1'],
];

describe('the Basic header', () => {
  it('is unchanged for a pure-ASCII username and password', () => {
    expect(headerBytes('mcp-reader', 'Secret-123!')).toEqual(Buffer.from('mcp-reader:Secret-123!', 'utf8'));
  });

  it('carries a Latin-1 username as Latin-1 ("\u00F6" is F6)', () => {
    expect([...headerBytes('J\u00F6rg', 'secret')]).toEqual([0x4a, 0xf6, ...Buffer.from('rg:secret', 'ascii')]);
  });
});

describe('a password with a non-ASCII character (#265)', () => {
  it.each(NON_ASCII_PASSWORDS)('with %s is refused from the environment, naming the variable, not the value', (_case, password) => {
    const error = refusal(() => clientConfigFromEnv({ ...ENV, BCONNECT_USERNAME: 'admin', BCONNECT_PASSWORD: password }));
    expect(error).toBeInstanceOf(ClientConfigError);
    expect(error.message).toContain('BCONNECT_PASSWORD');
    expect(error.message).toMatch(/non-ASCII/);
    expect(error.message).toContain('BCONNECT_API_KEY');
    expect(error.message).not.toContain(password);
    expect(error.message).not.toContain(password.slice(2));
  });

  it('passed to createServer(credentials) is refused too, naming the request, not the value', () => {
    const error = refusal(() => clientConfigFromEnv(ENV, { baseUrl: BASE, username: 'admin', password: 'x\u00A7y' }));
    expect(error).toBeInstanceOf(ClientConfigError);
    expect(error.message).toMatch(/request's password/);
    expect(error.message).not.toContain('x\u00A7y');
  });

  it('is refused by a client built without the shared config, and by the header helper', () => {
    expect(() => new BConnectClientBase({ baseUrl: BASE, username: 'admin', password: 'Pa\u00A7s' })).toThrow(ClientConfigError);
    expect(() => basicAuthHeader('admin', 'Pa\u00A7s')).toThrow(/non-ASCII/);
  });

  it('a character that NFC turns into ASCII (Kelvin sign) is refused, not sent as a different password', () => {
    expect(() => basicAuthHeader('admin', 'Pa\u212Aword')).toThrow(/non-ASCII/);
    expect(() => clientConfigFromEnv({ ...ENV, BCONNECT_USERNAME: 'admin', BCONNECT_PASSWORD: 'Pa\u212Aword' })).toThrow(/non-ASCII/);
  });

  it('a U+FFFD (a file not saved as UTF-8) gets a hint about the encoding', () => {
    expect(() => clientConfigFromEnv({ ...ENV, BCONNECT_USERNAME: 'admin', BCONNECT_PASSWORD: 'pa\uFFFDss' })).toThrow(/UTF-8/);
  });

  it('is not checked when an API key is used (the username and password are ignored then)', () => {
    expect(() => clientConfigFromEnv({ ...ENV, BCONNECT_API_KEY: 'k', BCONNECT_PASSWORD: 'Pa\u00A7s' })).not.toThrow();
  });
});

describe('the username keeps the Latin-1 rule (#228)', () => {
  it('a Latin-1 username is accepted', () => {
    expect(() => clientConfigFromEnv({ ...ENV, BCONNECT_USERNAME: 'J\u00F6rg', BCONNECT_PASSWORD: 'secret' })).not.toThrow();
  });

  it('a username above U+00FF is refused, naming the variable, not the value', () => {
    const error = refusal(() => clientConfigFromEnv({ ...ENV, BCONNECT_USERNAME: 'J\u20ACrg', BCONNECT_PASSWORD: 'secret' }));
    expect(error.message).toContain('BCONNECT_USERNAME');
    expect(error.message).not.toContain('J\u20ACrg');
  });
});

describe('in a tool call', () => {
  let sent = 0;
  const msw = setupServer(mswHttp.all('*', () => { sent++; return HttpResponse.json({}); }));
  const savedEnv = { ...process.env };
  beforeAll(() => msw.listen({ onUnhandledRequest: 'error' }));
  afterAll(() => { msw.close(); process.env = savedEnv; });

  it('the refusal is an isError result that names BCONNECT_PASSWORD, and nothing is sent', async () => {
    Object.assign(process.env, guardEnv('26R1', { writes: false, secretRead: false }), { BCONNECT_PASSWORD: 'pa\u00A7ss', BCONNECT_API_KEY: '' });
    const conn = await connect('bconnect-endpoints-mcp');
    const tool = conn.tools.find((t) => t.name === 'list_endpoints') ?? conn.tools[0];
    const result = await conn.call(tool.name, requiredArguments(tool.inputSchema));
    await conn.close();
    expect(sent).toBe(0);
    expect(result.code).toBeUndefined();
    expect(result.isError).toBe(true);
    expect(result.text).toContain('BCONNECT_PASSWORD');
    expect(result.text).not.toContain('pa\u00A7ss');
  });
});

describe('at startup', () => {
  it('a server with a non-ASCII password exits with the message and sends nothing', async () => {
    let requests = 0;
    const api = http.createServer((_req, res) => { requests++; res.end('[]'); });
    const port = await new Promise<number>((r) => api.listen(0, '127.0.0.1', () => r((api.address() as AddressInfo).port)));
    try {
      const child = spawn(process.execPath, [join(ROOT, 'bconnect-endpoints-mcp', 'build', 'index.js')], {
        cwd: join(ROOT, 'bconnect-endpoints-mcp'),
        env: {
          PATH: process.env.PATH ?? '', BCONNECT_BASE_URL: `http://127.0.0.1:${port}/bconnect`,
          BCONNECT_USERNAME: 'admin', BCONNECT_PASSWORD: 'Pa\u00A7sword1', BCONNECT_API_KEY: '', BCONNECT_SKIP_CONNECTIVITY_CHECK: '',
        },
      });
      let stderr = '';
      child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
      const code = await new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => { child.kill(); resolve(null); }, 15_000);
        child.on('exit', (c) => { clearTimeout(timer); resolve(c); });
      });
      expect(code).toBe(1);
      expect(stderr).toContain('BCONNECT_PASSWORD');
      expect(stderr).toMatch(/non-ASCII/);
      expect(stderr).not.toContain('Pa\u00A7sword1');
      expect(requests).toBe(0);
    } finally {
      api.close();
    }
  }, 20_000);
});
