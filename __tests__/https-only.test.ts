/**
 * Credentials go only over HTTPS unless the operator opts out (REQ-SRV-020, D1 = a).
 *
 * Every request carries the bConnect credential, so the shared client-config
 * helper refuses an http:// base URL to a remote host. Loopback http (the
 * bundled mock, local testing) stays allowed; anything else needs
 * BCONNECT_ALLOW_INSECURE_HTTP=true and then logs one warning per process.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const BASIC = { BCONNECT_USERNAME: 'user', BCONNECT_PASSWORD: 'secret' };

/** A fresh copy of the helper module, so the once-per-process warning starts unset. */
async function helper() {
  vi.resetModules();
  return import('../packages/mcp-core/src/client-config.js');
}

describe('base URL scheme', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it.each([
    'https://bms.internal/bconnect',
    'https://bms.internal:444/bconnect',
  ])('accepts %s', async (url) => {
    const { clientConfigFromEnv } = await helper();
    expect(clientConfigFromEnv({ ...BASIC, BCONNECT_BASE_URL: url }).baseUrl).toBe(url);
  });

  it.each([
    'http://127.0.0.1:13433/bconnect',
    'http://127.12.0.5/bconnect',
    'http://localhost:3433/bconnect',
    'http://[::1]:3433/bconnect',
  ])('accepts loopback http %s without the opt-in', async (url) => {
    const { clientConfigFromEnv } = await helper();
    expect(clientConfigFromEnv({ ...BASIC, BCONNECT_BASE_URL: url }).baseUrl).toBe(url);
  });

  it.each([
    'http://bms.internal/bconnect',
    'http://10.0.0.5/bconnect',
    'http://localhost.example.com/bconnect',
  ])('refuses remote http %s, naming the fix', async (url) => {
    const { clientConfigFromEnv, InsecureBaseUrlError, ClientConfigError } = await helper();
    let error: unknown;
    try { clientConfigFromEnv({ ...BASIC, BCONNECT_BASE_URL: url }); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(InsecureBaseUrlError);
    expect(error).toBeInstanceOf(ClientConfigError);
    expect((error as Error).message).toMatch(/https:\/\//);
    expect((error as Error).message).toMatch(/BCONNECT_ALLOW_INSECURE_HTTP=true/);
    expect((error as Error).message).not.toContain('secret');
  });

  it.each(['true', 'TRUE', ' true '])('allows remote http with BCONNECT_ALLOW_INSECURE_HTTP=%j', async (flag) => {
    const { clientConfigFromEnv } = await helper();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { ...BASIC, BCONNECT_BASE_URL: 'http://bms.internal/bconnect', BCONNECT_ALLOW_INSECURE_HTTP: flag };
    expect(clientConfigFromEnv(env).baseUrl).toBe('http://bms.internal/bconnect');
  });

  it.each(['false', '1', 'yes', ''])('does not treat BCONNECT_ALLOW_INSECURE_HTTP=%j as the opt-in', async (flag) => {
    const { clientConfigFromEnv, InsecureBaseUrlError } = await helper();
    const env = { ...BASIC, BCONNECT_BASE_URL: 'http://bms.internal/bconnect', BCONNECT_ALLOW_INSECURE_HTTP: flag };
    expect(() => clientConfigFromEnv(env)).toThrow(InsecureBaseUrlError);
  });

  it('warns once per process on stderr when the opt-in is used, not on every call', async () => {
    const { clientConfigFromEnv } = await helper();
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { ...BASIC, BCONNECT_BASE_URL: 'http://bms.internal/bconnect', BCONNECT_ALLOW_INSECURE_HTTP: 'true' };
    clientConfigFromEnv(env);
    clientConfigFromEnv(env);
    clientConfigFromEnv(env);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/unencrypted/i);
  });

  it('does not warn for https or loopback http', async () => {
    const { clientConfigFromEnv } = await helper();
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    clientConfigFromEnv({ ...BASIC, BCONNECT_BASE_URL: 'https://bms.internal/bconnect' });
    clientConfigFromEnv({ ...BASIC, BCONNECT_BASE_URL: 'http://127.0.0.1:13433/bconnect' });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    'ftp://bms.internal/bconnect',
    'bms.internal/bconnect',
    'not a url',
  ])('refuses %j, which is neither https nor http', async (url) => {
    const { clientConfigFromEnv, InsecureBaseUrlError } = await helper();
    expect(() => clientConfigFromEnv({ ...BASIC, BCONNECT_BASE_URL: url })).toThrow(InsecureBaseUrlError);
  });

  it('makes the existing configuration errors part of the same family', async () => {
    const { MissingCredentialsError, ClientConfigError } = await helper();
    expect(new MissingCredentialsError()).toBeInstanceOf(ClientConfigError);
  });
});

describe('through a real server (variables)', () => {
  const sent: string[] = [];
  const msw = setupServer(http.all('*', ({ request }) => { sent.push(request.url); return HttpResponse.json([]); }));
  const saved = { ...process.env };

  beforeAll(() => msw.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => { process.env = { ...saved }; sent.length = 0; });
  afterAll(() => msw.close());

  async function call(baseUrl: string, extra: Record<string, string> = {}) {
    Object.assign(process.env, {
      BCONNECT_BASE_URL: baseUrl, BCONNECT_USERNAME: 'u', BCONNECT_PASSWORD: 'p',
      BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true', BCONNECT_ALLOW_INSECURE_HTTP: '', ...extra,
    });
    vi.resetModules();
    const { createServer } = await import('../bconnect-variables-mcp/src/index.ts');
    const { server } = createServer();
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'https-only', version: '0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const r = await client.callTool({ name: 'list_variable_definitions', arguments: {} });
      return { error: r.isError === true, text: JSON.stringify(r.content ?? '') };
    } catch (e) {
      return { error: true, text: String((e as Error).message) };
    } finally {
      await client.close();
    }
  }

  it('refuses a remote http base URL before any request, naming the fix', async () => {
    const r = await call('http://bms.remote.test/bconnect');
    expect(r.error).toBe(true);
    expect(r.text).toMatch(/BCONNECT_ALLOW_INSECURE_HTTP/);
    expect(sent).toEqual([]);
  });

  it('sends the request with the opt-in', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await call('http://bms.remote.test/bconnect', { BCONNECT_ALLOW_INSECURE_HTTP: 'true' });
    expect(r.error).toBe(false);
    expect(sent.length).toBe(1);
  });
});
