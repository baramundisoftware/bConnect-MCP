/**
 * The read retry of our own (#425), which replaced axios-retry.
 *
 * The rules themselves (only GET, only no answer and 502/503/504, a write
 * exactly once, the typed error kept, one audit entry) are pinned by
 * timeouts-retries.test.ts, unchanged. This file adds:
 * - the backoff: retryDelay × 2^(retry − 1);
 * - the number of tries for BCONNECT_MAX_RETRIES 1 to 5;
 * - a request with `noRetry` (the release detection) is sent once;
 * - the one try on a new connection after a stale kept-alive one (#160): on
 *   top of the configured retries, and the only one with BCONNECT_MAX_RETRIES=0;
 *   end to end with Node's agent against a real loopback server;
 * - every try passes the rate limiter.
 */
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { BConnectClientBase, type BConnectConfig } from '../packages/mcp-core/src/bconnect-client-base.js';
import { retryDelayMs, shouldRetryRead } from '../packages/mcp-core/src/read-retry.js';

type Raw = { client: { request: (c: { method: string; url: string; noRetry?: boolean }) => Promise<unknown> } };
const outcome = (p: Promise<unknown>): Promise<Error | null> => p.then(() => null, (e: Error) => e);

/** What the loopback server does with the n-th request (1-based) and its socket's request count. */
type Reply = (res: http.ServerResponse, req: http.IncomingMessage, onSocket: number) => void;
let reply: Reply = (res) => { res.end('{}'); };
const arrivals: number[] = [];
const perSocket = new WeakMap<Socket, number>();
const server = http.createServer((req, res) => {
  arrivals.push(Date.now());
  const onSocket = (perSocket.get(req.socket) ?? 0) + 1;
  perSocket.set(req.socket, onSocket);
  res.setHeader('Content-Type', 'application/json');
  reply(res, req, onSocket);
});
let base = '';
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/bconnect`;
});
afterEach(() => { reply = (res) => { res.end('{}'); }; arrivals.length = 0; });
afterAll(() => { server.closeAllConnections(); server.close(); });

const client = (extra: Partial<BConnectConfig> = {}) => new BConnectClientBase({ baseUrl: base, apiKey: 'k', timeout: 2000, ...extra });
const raw = (c: BConnectClientBase) => c as unknown as Raw;
const status = (code: number): Reply => (res) => { res.statusCode = code; res.end('{}'); };
const GET = { method: 'GET', url: '/endpoints/v2.0/Endpoints' };

describe('backoff', () => {
  it('retryDelay × 2^(retry − 1), 100 ms by default', () => {
    expect([1, 2, 3, 4, 5].map((n) => retryDelayMs(n))).toEqual([100, 200, 400, 800, 1600]);
    expect([1, 2, 3].map((n) => retryDelayMs(n, 20))).toEqual([20, 40, 80]);
  });

  it('waits that long between the tries', async () => {
    reply = status(503);
    await outcome(raw(client({ maxRetries: 3, retryDelay: 25 })).client.request(GET));
    expect(arrivals).toHaveLength(4);
    const gaps = arrivals.slice(1).map((t, i) => t - arrivals[i]);
    // Timers fire no earlier than asked (allow 2 ms of clock granularity), and not much later.
    gaps.forEach((gap, i) => {
      expect(gap).toBeGreaterThanOrEqual(25 * 2 ** i - 2);
      expect(gap).toBeLessThan(25 * 2 ** i + 400);
    });
  });
});

describe('number of tries', () => {
  it.each([0, 1, 2, 3, 4, 5])('BCONNECT_MAX_RETRIES=%i: a GET answered 503 throughout is sent %i + 1 times', async (maxRetries) => {
    reply = status(503);
    expect(await outcome(raw(client({ maxRetries, retryDelay: 1 })).client.request(GET))).not.toBeNull();
    expect(arrivals).toHaveLength(maxRetries + 1);
  });

  it('a request with noRetry is sent once', async () => {
    reply = status(503);
    expect(await outcome(raw(client({ maxRetries: 3, retryDelay: 1 })).client.request({ ...GET, noRetry: true }))).not.toBeNull();
    expect(arrivals).toHaveLength(1);
  });

  it('the release detection asks once, whatever BCONNECT_MAX_RETRIES says', async () => {
    reply = status(503);
    expect(await outcome(client({ maxRetries: 3, retryDelay: 1 }).managementServerVersion())).not.toBeNull();
    expect(arrivals).toHaveLength(1);
  });

  it('every try passes the rate limiter: the try over the limit is refused, not sent', async () => {
    reply = status(503);
    const error = await outcome(raw(client({ maxRetries: 3, retryDelay: 1, rateLimit: { enabled: true, maxRequests: 2, windowMs: 60_000 } })).client.request(GET));
    expect(arrivals).toHaveLength(2);
    expect(error?.message).toMatch(/Rate limit exceeded/);
  });
});

describe('a stale kept-alive connection (#160)', () => {
  /** The server drops the second request on a connection without answering, as when it closed it meanwhile. */
  const dropReused: Reply = (res, req, onSocket) => {
    if (onSocket > 1) {req.socket.destroy(); return;}
    res.end('{"ok":true}');
  };

  it('with BCONNECT_MAX_RETRIES=0, the read goes once more, on a new connection, and succeeds', async () => {
    reply = dropReused;
    const c = raw(client({ maxRetries: 0 }));
    expect(await outcome(c.client.request(GET))).toBeNull();
    expect(await outcome(c.client.request(GET))).toBeNull();
    expect(arrivals).toHaveLength(3);
  });

  it('a connection dropped on its first request is not retried with BCONNECT_MAX_RETRIES=0', async () => {
    reply = (_res, req) => { req.socket.destroy(); };
    expect(await outcome(raw(client({ maxRetries: 0 })).client.request(GET))).not.toBeNull();
    expect(arrivals).toHaveLength(1);
  });

  it('a write on a stale connection is not sent again', async () => {
    reply = dropReused;
    const c = raw(client({ maxRetries: 0 }));
    expect(await outcome(c.client.request(GET))).toBeNull();
    expect(await outcome(c.client.request({ method: 'POST', url: '/endpoints/v2.0/Endpoints' }))).not.toBeNull();
    expect(arrivals).toHaveLength(2);
  });

  describe('the decision, after n retries', () => {
    const config = (extra: Partial<InternalAxiosRequestConfig> = {}): InternalAxiosRequestConfig => ({ method: 'get', headers: new AxiosHeaders(), ...extra });
    const stale = (c = config()) => new AxiosError('socket hang up', 'ECONNRESET', c, { reusedSocket: true });
    const fresh = (c = config()) => new AxiosError('socket hang up', 'ECONNRESET', c, { reusedSocket: false });

    it.each([0, 1, 3])('BCONNECT_MAX_RETRIES=%i: the stale try comes once, after the configured retries', (max) => {
      for (let made = 0; made < max; made++) {expect(shouldRetryRead(stale(), made, max)).toBe(true);}
      expect(shouldRetryRead(stale(), max, max)).toBe(true);
      expect(shouldRetryRead(stale(), max + 1, max)).toBe(false);
      expect(shouldRetryRead(fresh(), max, max)).toBe(false);
    });

    it('not for a write, nor with noRetry', () => {
      expect(shouldRetryRead(stale(config({ method: 'post' })), 0, 0)).toBe(false);
      expect(shouldRetryRead(stale(config({ noRetry: true })), 0, 0)).toBe(false);
    });
  });
});
