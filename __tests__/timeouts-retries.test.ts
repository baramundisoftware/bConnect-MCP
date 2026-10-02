/**
 * Timeouts are named, the timeout is configurable, only reads are retried
 * (REQ-XC-002, REQ-XC-003 AC 2; #203, #162).
 *
 * - A request that times out says so, with its length; a refused connection
 *   keeps "Cannot connect"; neither names the host.
 * - BCONNECT_TIMEOUT_MS (1000-600000, default 30000) and BCONNECT_MAX_RETRIES
 *   (0-5, default 0); any other value stops the server, naming the variable.
 * - With retries on, only GET is retried, only on network errors, timeouts and
 *   502/503/504. A write is sent exactly once, whatever happens.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { delay, http as mswHttp, HttpResponse } from 'msw';
import { BConnectClientBase, type BConnectConfig } from '../packages/mcp-core/src/bconnect-client-base.js';
import { ClientConfigError, clientConfigFromEnv } from '../packages/mcp-core/src/client-config.js';

const HOST = 'bms.timeouts.test';
const BASE = `https://${HOST}/bconnect`;
const ENV = { BCONNECT_BASE_URL: BASE, BCONNECT_API_KEY: 'k' };

describe('BCONNECT_TIMEOUT_MS and BCONNECT_MAX_RETRIES', () => {
  it('default to 30000 ms and no retries', () => {
    const config = clientConfigFromEnv(ENV);
    expect(config.timeout).toBe(30000);
    expect(config.maxRetries).toBe(0);
  });

  it('take valid values', () => {
    const config = clientConfigFromEnv({ ...ENV, BCONNECT_TIMEOUT_MS: '45000', BCONNECT_MAX_RETRIES: '3' });
    expect(config.timeout).toBe(45000);
    expect(config.maxRetries).toBe(3);
  });

  it.each(['abc', '0', '999', '600001', '1.5', '-5', '30s'])('refuse BCONNECT_TIMEOUT_MS=%s, naming the variable', (value) => {
    expect(() => clientConfigFromEnv({ ...ENV, BCONNECT_TIMEOUT_MS: value })).toThrow(ClientConfigError);
    expect(() => clientConfigFromEnv({ ...ENV, BCONNECT_TIMEOUT_MS: value })).toThrow(/BCONNECT_TIMEOUT_MS/);
  });

  it.each(['x', '-1', '6', '2.5'])('refuse BCONNECT_MAX_RETRIES=%s, naming the variable', (value) => {
    expect(() => clientConfigFromEnv({ ...ENV, BCONNECT_MAX_RETRIES: value })).toThrow(/BCONNECT_MAX_RETRIES/);
  });

  it('treat an empty value as unset', () => {
    const config = clientConfigFromEnv({ ...ENV, BCONNECT_TIMEOUT_MS: '', BCONNECT_MAX_RETRIES: '' });
    expect(config.timeout).toBe(30000);
    expect(config.maxRetries).toBe(0);
  });
});

type Raw = { client: { request: (c: { method: string; url: string; data?: unknown }) => Promise<unknown> } };
const outcome = (p: Promise<unknown>): Promise<Error | null> => p.then(() => null, (e: Error) => e);

describe('failure messages', () => {
  let replies: Array<() => Response | Promise<Response>> = [];
  let sent = 0;
  const msw = setupServer(mswHttp.all(`https://${HOST}/*`, () => {
    sent++;
    const next = replies.shift();
    return next ? next() : HttpResponse.json({});
  }));
  beforeAll(() => msw.listen({ onUnhandledRequest: 'bypass' }));
  afterEach(() => { replies = []; sent = 0; vi.restoreAllMocks(); });
  afterAll(() => msw.close());

  const client = (extra: Partial<BConnectConfig> = {}): Raw =>
    new BConnectClientBase({ baseUrl: BASE, apiKey: 'k', ...extra }) as unknown as Raw;

  it('a timeout names its length and the setting, not "Cannot connect", and no host', async () => {
    replies = [async () => { await delay('infinite'); return HttpResponse.json({}); }];
    const error = await outcome(client({ timeout: 300 }).client.request({ method: 'GET', url: '/endpoints/v2.0/Endpoints' }));
    expect(error?.message).toMatch(/didn't answer within 0\.3 s/);
    expect(error?.message).toContain('BCONNECT_TIMEOUT_MS');
    expect(error?.message).not.toMatch(/Cannot connect/);
    expect(error?.message).not.toContain(HOST);
  });

  it('a refused connection still says "Cannot connect"', async () => {
    const server = http.createServer();
    const port = await new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as AddressInfo).port)));
    await new Promise((r) => server.close(r));
    const refused = new BConnectClientBase({ baseUrl: `http://127.0.0.1:${port}/bconnect`, apiKey: 'k' }) as unknown as Raw;
    const error = await outcome(refused.client.request({ method: 'GET', url: '/endpoints/v2.0/Endpoints' }));
    expect(error?.message).toMatch(/Cannot connect to the bConnect API/);
    expect(error?.message).not.toMatch(/didn't answer/);
  });

  it('the startup check logs that it timed out', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(' ')); });
    replies = [async () => { await delay('infinite'); return HttpResponse.json({}); }];
    const probe = new BConnectClientBase({ baseUrl: BASE, apiKey: 'k', timeout: 300, healthCheckPath: '/endpoints/v2.0/Endpoints' });
    const saved = process.env.BCONNECT_SKIP_CONNECTIVITY_CHECK;
    delete process.env.BCONNECT_SKIP_CONNECTIVITY_CHECK;
    try {
      expect(await probe.testConnection()).toBe(false);
    } finally {
      if (saved !== undefined) {process.env.BCONNECT_SKIP_CONNECTIVITY_CHECK = saved;}
    }
    expect(logged.join('\n')).toMatch(/didn't answer within 0\.3 s/);
  });

  describe('retries (BCONNECT_MAX_RETRIES=2)', () => {
    const retrying = () => client({ maxRetries: 2, retryDelay: 1, timeout: 300 });
    const status = (code: number) => () => new HttpResponse(null, { status: code });

    it.each([502, 503, 504])('a GET answered %i is retried and then succeeds', async (code) => {
      replies = [status(code)];
      expect(await outcome(retrying().client.request({ method: 'GET', url: '/endpoints/v2.0/Endpoints' }))).toBeNull();
      expect(sent).toBe(2);
    });

    it('a GET that hits a network error is retried', async () => {
      replies = [() => HttpResponse.error()];
      expect(await outcome(retrying().client.request({ method: 'GET', url: '/endpoints/v2.0/Endpoints' }))).toBeNull();
      expect(sent).toBe(2);
    });

    it('a GET that times out is retried', async () => {
      replies = [async () => { await delay('infinite'); return HttpResponse.json({}); }];
      expect(await outcome(retrying().client.request({ method: 'GET', url: '/endpoints/v2.0/Endpoints' }))).toBeNull();
      expect(sent).toBe(2);
    });

    it.each([500, 429, 404, 400, 409])('a GET answered %i is sent once', async (code) => {
      replies = [status(code), status(code), status(code)];
      expect(await outcome(retrying().client.request({ method: 'GET', url: '/endpoints/v2.0/Endpoints' }))).not.toBeNull();
      expect(sent).toBe(1);
    });

    it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('a %s is sent exactly once, on 503 and on a network error', async (method) => {
      replies = [status(503), status(503), status(503)];
      expect(await outcome(retrying().client.request({ method, url: '/endpoints/v2.0/Endpoints', data: {} }))).not.toBeNull();
      expect(sent).toBe(1);
      sent = 0;
      replies = [() => HttpResponse.error(), () => HttpResponse.error(), () => HttpResponse.error()];
      expect(await outcome(retrying().client.request({ method, url: '/endpoints/v2.0/Endpoints', data: {} }))).not.toBeNull();
      expect(sent).toBe(1);
    });
  });
});
