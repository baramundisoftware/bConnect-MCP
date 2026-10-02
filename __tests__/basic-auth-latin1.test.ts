/**
 * Basic auth works with Latin-1 passwords (#228).
 *
 * bConnect decodes Basic credentials as ISO-8859-1 (its WWW-Authenticate has no
 * charset). A password with "\u00A7" sent as UTF-8 (C2 A7) is a different password
 * to bMS (401); as Latin-1 (A7) it works. Characters above U+00FF can't be sent
 * at all: they are refused when the config is built, naming the variable, never
 * the value.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { BConnectClientBase } from '../packages/mcp-core/src/bconnect-client-base.js';
import { ClientConfigError, clientConfigFromEnv } from '../packages/mcp-core/src/client-config.js';
import { connect, guardEnv, requiredArguments } from './lib/exerciser.js';

const BASE = 'https://bms.latin1.test/bconnect';

/** The decoded bytes of the Basic header a client sends. */
function headerBytes(username: string, password: string): Buffer {
  const client = new BConnectClientBase({ baseUrl: BASE, username, password }) as unknown as {
    client: { defaults: { headers: { common: Record<string, string> } } };
  };
  const header = client.client.defaults.headers.common.Authorization;
  expect(header.startsWith('Basic ')).toBe(true);
  return Buffer.from(header.slice('Basic '.length), 'base64');
}

describe('the Basic header (#228 AC 1, AC 2)', () => {
  it('carries the password as Latin-1: "\u00A7" is A7, "\u00E4" is E4, "\u00DF" is DF', () => {
    const bytes = headerBytes('admin', 'Pa\u00A7s\u00E4\u00DF');
    expect([...bytes]).toEqual([...Buffer.from('admin:Pa', 'ascii'), 0xa7, 0x73, 0xe4, 0xdf]);
    expect(bytes.includes(Buffer.from([0xc2, 0xa7]))).toBe(false); // not UTF-8
  });

  it('is unchanged for a pure-ASCII username and password', () => {
    expect(headerBytes('mcp-reader', 'Secret-123!')).toEqual(Buffer.from('mcp-reader:Secret-123!', 'utf8'));
  });
});

describe('characters Latin-1 cannot carry (#228 AC 3)', () => {
  const ENV = { BCONNECT_BASE_URL: BASE };

  it.each([
    ['BCONNECT_PASSWORD', { BCONNECT_USERNAME: 'admin', BCONNECT_PASSWORD: '\u20ACuro-pass' }],
    ['BCONNECT_USERNAME', { BCONNECT_USERNAME: 'J\u20ACrg', BCONNECT_PASSWORD: 'secret' }],
  ])('a %s with a character above U+00FF is refused, naming the variable, not the value', (name, creds) => {
    let error: unknown;
    try { clientConfigFromEnv({ ...ENV, ...creds }); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(ClientConfigError);
    const message = (error as Error).message;
    expect(message).toContain(name);
    expect(message).toContain('BCONNECT_API_KEY');
    expect(message).not.toContain('\u20AC');
    expect(message).not.toContain('uro-pass');
    expect(message).not.toContain('J\u20ACrg');
  });

  it('per-request credentials (gateway) are refused too, naming the request, not the value', () => {
    let error: unknown;
    try { clientConfigFromEnv(ENV, { baseUrl: BASE, username: 'admin', password: 'x\u20ACy' }); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(ClientConfigError);
    expect((error as Error).message).toMatch(/request/i);
    expect((error as Error).message).not.toContain('x\u20ACy');
  });

  it('is not checked when an API key is used (the username and password are ignored then)', () => {
    expect(() => clientConfigFromEnv({ ...ENV, BCONNECT_API_KEY: 'k', BCONNECT_PASSWORD: '\u20AC' })).not.toThrow();
  });

  it('Latin-1 characters are accepted', () => {
    expect(() => clientConfigFromEnv({ ...ENV, BCONNECT_USERNAME: 'J\u00F6rg', BCONNECT_PASSWORD: '\u00A7\u00E4\u00F6\u00FC\u00DF' })).not.toThrow();
  });

  it('a client built without the shared config refuses them as well', () => {
    expect(() => new BConnectClientBase({ baseUrl: BASE, username: 'admin', password: '\u20AC' })).toThrow(ClientConfigError);
  });
});

describe('in a tool call', () => {
  let sent = 0;
  const msw = setupServer(http.all('*', () => { sent++; return HttpResponse.json({}); }));
  const savedEnv = { ...process.env };
  beforeAll(() => msw.listen({ onUnhandledRequest: 'error' }));
  afterAll(() => { msw.close(); process.env = savedEnv; });

  it('the refusal is an isError result that names BCONNECT_PASSWORD, and nothing is sent', async () => {
    Object.assign(process.env, guardEnv('26R1', { writes: false, secretRead: false }), { BCONNECT_PASSWORD: 'pa\u20ACss', BCONNECT_API_KEY: '' });
    const conn = await connect('bconnect-endpoints-mcp');
    const tool = conn.tools.find((t) => t.name === 'list_endpoints') ?? conn.tools[0];
    const result = await conn.call(tool.name, requiredArguments(tool.inputSchema));
    await conn.close();
    expect(sent).toBe(0);
    expect(result.code).toBeUndefined();
    expect(result.isError).toBe(true);
    expect(result.text).toContain('BCONNECT_PASSWORD');
    expect(result.text).not.toContain('pa\u20ACss');
  });
});
