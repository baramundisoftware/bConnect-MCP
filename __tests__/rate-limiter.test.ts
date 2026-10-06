/**
 * The client-side rate limit (REQ-SRV-023 AC 1): a token bucket of
 * `maxRequests` tokens that refills evenly over `windowMs`. One limiter is
 * shared by every client of a server (server-runtime.test.ts pins that); this
 * file pins the bucket itself and what a refused call does: it sends nothing.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { BConnectClientBase } from '../packages/mcp-core/src/bconnect-client-base.js';
import { RateLimiter, RateLimitError } from '../packages/mcp-core/src/rate-limiter.js';
import { serverClients } from '../packages/mcp-core/src/server-runtime.js';

describe('RateLimiter: window edges', () => {
  beforeAll(() => { vi.useFakeTimers({ now: 0 }); });
  afterAll(() => { vi.useRealTimers(); });

  // 2 per second: one token every 500 ms.
  const limiter = () => new RateLimiter({ enabled: true, maxRequests: 2, windowMs: 1000 });

  it('allows a full bucket back to back, then refuses', () => {
    const l = limiter();
    expect([l.tryConsume(), l.tryConsume(), l.tryConsume()].map((i) => [i.allowed, i.remaining])).toEqual([
      [true, 1], [true, 0], [false, 0],
    ]);
  });

  it('says how long until the next token', () => {
    const l = limiter();
    l.tryConsume();
    l.tryConsume();
    expect(l.tryConsume()).toMatchObject({ allowed: false, limit: 2, resetInMs: 500 });
  });

  it('refuses just before a token is due and allows just after', () => {
    const l = limiter();
    l.tryConsume();
    l.tryConsume();
    vi.advanceTimersByTime(499);
    expect(l.tryConsume().allowed).toBe(false);
    vi.advanceTimersByTime(2);
    expect(l.tryConsume().allowed).toBe(true);
    expect(l.tryConsume().allowed).toBe(false);
  });

  it('a refused call costs no token', () => {
    const l = limiter();
    l.tryConsume();
    l.tryConsume();
    for (let i = 0; i < 5; i++) {l.tryConsume();}
    vi.advanceTimersByTime(500);
    expect(l.tryConsume().allowed).toBe(true);
  });

  it('never holds more than maxRequests tokens, however long it was idle', () => {
    const l = limiter();
    vi.advanceTimersByTime(60_000);
    expect([l.tryConsume(), l.tryConsume(), l.tryConsume()].map((i) => i.allowed)).toEqual([true, true, false]);
  });

  it('has a default refusal message', () => {
    expect(limiter().getConfig().message).toMatch(/rate limit exceeded/i);
    expect(new RateLimiter({ enabled: true, maxRequests: 1, windowMs: 1, message: 'slow down' }).getConfig().message).toBe('slow down');
  });

  it('RateLimitError carries the limit info', () => {
    const info = { allowed: false, remaining: 0, limit: 2, resetInMs: 500 };
    const error = new RateLimitError('x', info);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toBeInstanceOf(Error);
    expect(error.info).toBe(info);
    expect(error.name).toBe('RateLimitError');
  });
});

describe('a refused call through the client', () => {
  const ENV = {
    BCONNECT_BASE_URL: 'http://bms.ratelimit.test/bconnect',
    BCONNECT_ALLOW_INSECURE_HTTP: 'true',
    BCONNECT_API_KEY: 'k',
    BCONNECT_RATE_LIMIT_ENABLED: 'true',
    BCONNECT_RATE_LIMIT_MAX_REQUESTS: '1',
    BCONNECT_RATE_LIMIT_WINDOW_MS: '600000',
  };
  class Client extends BConnectClientBase {
    get(path: string) { return this.client.get(path); }
    post(path: string) { return this.client.post(path, {}); }
  }
  let requests: string[] = [];
  const msw = setupServer(http.all('*', ({ request }) => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
    return HttpResponse.json({});
  }));
  beforeAll(() => msw.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => { requests = []; });
  afterAll(() => msw.close());

  it('sends nothing and says when to retry', async () => {
    const client = serverClients(Client, { ...ENV }).get();
    await client.get('/d/v2.0/Things');
    await expect(client.get('/d/v2.0/Things')).rejects.toThrow(/rate limit exceeded.*Remaining: 0, Reset in: 600s/i);
    expect(requests).toEqual(['GET /bconnect/d/v2.0/Things']);
  });

  it('refuses a write as well, without sending it', async () => {
    const client = serverClients(Client, { ...ENV }).get();
    await client.get('/d/v2.0/Things');
    await expect(client.post('/d/v2.0/Things')).rejects.toThrow(/rate limit exceeded/i);
    expect(requests).toEqual(['GET /bconnect/d/v2.0/Things']);
  });

  it('builds a new limiter when the rate settings change', async () => {
    const env: NodeJS.ProcessEnv = { ...ENV };
    const clients = serverClients(Client, env);
    await clients.get().get('/d/v2.0/Things');
    await expect(clients.get().get('/d/v2.0/Things')).rejects.toThrow(/rate limit/i);
    env.BCONNECT_RATE_LIMIT_MAX_REQUESTS = '2';
    await expect(clients.get().get('/d/v2.0/Things')).resolves.toBeDefined();
    expect(requests).toHaveLength(2);
  });

  it('has no limiter when the rate limit is off', async () => {
    const client = serverClients(Client, { ...ENV, BCONNECT_RATE_LIMIT_ENABLED: 'false' }).get();
    for (let i = 0; i < 3; i++) {await client.get('/d/v2.0/Things');}
    expect(requests).toHaveLength(3);
  });
});
