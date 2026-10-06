/**
 * The response cache, when a client config enables it (REQ-SRV-023 AC 4).
 * server-runtime.test.ts pins what the client does with it (hit sends
 * nothing, a write forgets its resource, path-segment matching); this file
 * pins the cache's own rules: expiry, size limit, and what makes two
 * requests the same entry.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { BConnectClientBase } from '../packages/mcp-core/src/bconnect-client-base.js';
import { ResponseCache } from '../packages/mcp-core/src/response-cache.js';

describe('ResponseCache', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('answers until the TTL has passed, then forgets', () => {
    vi.useFakeTimers({ now: 0 });
    const cache = new ResponseCache({ enabled: true, ttl: 1000 });
    cache.set('GET', '/d/v2.0/Things', 'fresh');
    vi.advanceTimersByTime(1000);
    expect(cache.get('GET', '/d/v2.0/Things')).toBe('fresh');
    vi.advanceTimersByTime(1);
    expect(cache.get('GET', '/d/v2.0/Things')).toBeNull();
  });

  it('keeps entries without expiry for a TTL of 0', () => {
    vi.useFakeTimers({ now: 0 });
    const cache = new ResponseCache({ enabled: true, ttl: 0 });
    cache.set('GET', '/d/v2.0/Things', 'kept');
    vi.advanceTimersByTime(365 * 24 * 3600 * 1000);
    expect(cache.get('GET', '/d/v2.0/Things')).toBe('kept');
  });

  it('expires after 5 minutes by default', () => {
    vi.useFakeTimers({ now: 0 });
    const cache = new ResponseCache({ enabled: true });
    cache.set('GET', '/d/v2.0/Things', 'x');
    vi.advanceTimersByTime(300_000);
    expect(cache.get('GET', '/d/v2.0/Things')).toBe('x');
    vi.advanceTimersByTime(1);
    expect(cache.get('GET', '/d/v2.0/Things')).toBeNull();
  });

  it('drops the least recently used entry when full', () => {
    const cache = new ResponseCache({ enabled: true, ttl: 60_000, maxSize: 2 });
    cache.set('GET', '/a', 'a');
    cache.set('GET', '/b', 'b');
    cache.get('GET', '/a');
    cache.set('GET', '/c', 'c');
    expect([cache.get('GET', '/a'), cache.get('GET', '/b'), cache.get('GET', '/c')]).toEqual(['a', null, 'c']);
  });

  it('makes room by dropping expired entries before live ones', () => {
    vi.useFakeTimers({ now: 0 });
    const cache = new ResponseCache({ enabled: true, ttl: 1000, maxSize: 2 });
    cache.set('GET', '/a', 'a');          // expires at 1000
    vi.advanceTimersByTime(500);
    cache.set('GET', '/b', 'b');          // expires at 1500
    vi.advanceTimersByTime(100);
    cache.get('GET', '/a');               // read: /a is now the most recently used
    vi.advanceTimersByTime(600);          // 1200: /a expired, /b live, and /b is the least recently used
    cache.set('GET', '/c', 'c');
    expect([cache.get('GET', '/b'), cache.get('GET', '/c')]).toEqual(['b', 'c']);
  });

  it('replaces an entry for the same request instead of adding one', () => {
    const cache = new ResponseCache({ enabled: true, ttl: 60_000, maxSize: 2 });
    cache.set('GET', '/a', 'first');
    cache.set('GET', '/b', 'b');
    cache.set('GET', '/a', 'second');
    expect([cache.get('GET', '/a'), cache.get('GET', '/b')]).toEqual(['second', 'b']);
  });

  it('keeps requests with different query parameters apart', () => {
    const cache = new ResponseCache({ enabled: true, ttl: 60_000 });
    cache.set('GET', '/d/v2.0/Things', 'page 0', { Page: 0 });
    cache.set('GET', '/d/v2.0/Things', 'page 1', { Page: 1 });
    expect(cache.get('GET', '/d/v2.0/Things', { Page: 0 })).toBe('page 0');
    expect(cache.get('GET', '/d/v2.0/Things', { Page: 1 })).toBe('page 1');
    expect(cache.get('GET', '/d/v2.0/Things')).toBeNull();
  });

  it('stores only GET answers by default', () => {
    const cache = new ResponseCache({ enabled: true, ttl: 60_000 });
    cache.set('POST', '/d/v2.0/Things', 'created');
    cache.set('get', '/d/v2.0/Things', 'listed');
    expect(cache.get('POST', '/d/v2.0/Things')).toBeNull();
    expect(cache.get('GET', '/d/v2.0/Things')).toBe('listed');
  });

  it('stores and answers nothing when disabled', () => {
    const cache = new ResponseCache({ enabled: false, ttl: 60_000 });
    cache.set('GET', '/d/v2.0/Things', 'x');
    expect(cache.get('GET', '/d/v2.0/Things')).toBeNull();
  });
});

describe('the client with a cache', () => {
  class Client extends BConnectClientBase {
    list(params: object) { return this.client.get('/d/v2.0/Things', { params }); }
  }
  let requests: string[] = [];
  const msw = setupServer(http.get('*', ({ request }) => {
    const url = new URL(request.url);
    requests.push(url.search);
    return HttpResponse.json({ search: url.search });
  }));
  beforeAll(() => msw.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => { requests = []; });
  afterAll(() => msw.close());

  it('never answers one filter with the result of another', async () => {
    const client = new Client({ baseUrl: 'http://bms.cache.test/bconnect', apiKey: 'k', cache: { enabled: true, ttl: 60_000 } });
    const a = await client.list({ DisplayName: 'a' });
    const b = await client.list({ DisplayName: 'b' });
    const again = await client.list({ DisplayName: 'a' });
    expect(requests).toEqual(['?DisplayName=a', '?DisplayName=b']);
    expect([a.data, b.data, again.data]).toEqual([{ search: '?DisplayName=a' }, { search: '?DisplayName=b' }, { search: '?DisplayName=a' }]);
  });
});
