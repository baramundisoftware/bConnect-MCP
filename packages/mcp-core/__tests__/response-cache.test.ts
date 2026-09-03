/**
 * ResponseCache — the first tests it has ever had.
 *
 * ── Why it had none ─────────────────────────────────────────────────────────
 * It reported 0.72% statement coverage, and unlike its neighbours that number
 * was honest: measured 2026-08-23, ZERO test files referenced `ResponseCache`
 * by any name. It is not dead code — `bconnect-client-base.ts:552` builds one
 * whenever `BCONNECT_CACHE_ENABLED=true` and puts it on the request path of
 * every call that client makes.
 *
 * (The lesson beside it: `cache-provenance.ts` reads 15% in the same report and
 * is thoroughly covered — by `__tests__/suite-cache-provenance.test.ts`, which
 * lives at the suite root and imports the BUILT package, so the workspace's
 * src-coverage run cannot see it. A low number means "look", not "untested".)
 *
 * ── What is asserted, and what is only recorded ─────────────────────────────
 * The behaviours below were probed before being written down, and the cache
 * came out sound: real LRU (not FIFO), TTL honoured, `getOnly` respected,
 * invalidation precise. Two measured behaviours are pinned here NOT because
 * they are bugs but because they are surprising, and a future reader deserves
 * to find them asserted rather than rediscover them: parameter KEY ORDER
 * changes the cache key, and falsy parameters collapse onto the no-parameter
 * key. Both cost a cache miss and neither can serve wrong data.
 */

import { describe, it, expect } from 'vitest';
import { ResponseCache } from '../src/response-cache.js';

describe('ResponseCache — eviction is LRU, not FIFO', () => {
  it('keeps the entry that was READ, and evicts the one that was not', () => {
    const cache = new ResponseCache({ enabled: true, maxSize: 3, ttl: 0 });
    cache.set('GET', '/a', 'A');
    cache.set('GET', '/b', 'B');
    cache.set('GET', '/c', 'C');

    // Touching /a must make it the most recently used, so the next insert
    // evicts /b. A FIFO cache would evict /a here and this would fail.
    expect(cache.get('GET', '/a')).toBe('A');
    cache.set('GET', '/d', 'D');

    expect(cache.get('GET', '/a')).toBe('A');
    expect(cache.get('GET', '/b')).toBeNull();
    expect(cache.get('GET', '/c')).toBe('C');
    expect(cache.get('GET', '/d')).toBe('D');
  });

  it('never grows past maxSize', () => {
    const cache = new ResponseCache({ enabled: true, maxSize: 2, ttl: 0 });
    for (let i = 0; i < 20; i += 1) {
      cache.set('GET', `/r${i}`, i);
    }
    expect(cache.getStats().size).toBeLessThanOrEqual(2);
  });
});

describe('ResponseCache — TTL', () => {
  it('serves inside the TTL and misses after it', async () => {
    const cache = new ResponseCache({ enabled: true, maxSize: 10, ttl: 30 });
    cache.set('GET', '/x', 'X');
    expect(cache.get('GET', '/x')).toBe('X');

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(cache.get('GET', '/x')).toBeNull();
  });

  it('ttl 0 means no expiry at all, which is a documented mode', () => {
    const cache = new ResponseCache({ enabled: true, maxSize: 10, ttl: 0 });
    cache.set('GET', '/x', 'X');
    expect(cache.get('GET', '/x')).toBe('X');
  });

  it('an expired entry counts as a MISS, not a hit on stale data', async () => {
    const cache = new ResponseCache({ enabled: true, maxSize: 10, ttl: 20 });
    cache.set('GET', '/x', 'X');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(cache.get('GET', '/x')).toBeNull();
    expect(cache.getStats().hits).toBe(0);
    expect(cache.getStats().misses).toBe(1);
  });

  it('a NEGATIVE ttl makes the cache inert, and never permanent', () => {
    // BCONNECT_CACHE_TTL_MS is parsed with parseInt and no lower bound, so a
    // negative value arrives from an operator's environment. It used to mean
    // "never expires": set() computed MAX_SAFE_INTEGER for any non-positive
    // ttl while isExpired() only special-cased 0, and the dangerous half won —
    // estate data served for the life of the process. Nonsense input must
    // serve nothing, not serve forever.
    const cache = new ResponseCache({ enabled: true, maxSize: 10, ttl: -1 });
    cache.set('GET', '/x', 'X');

    expect(cache.get('GET', '/x')).toBeNull();
  });
});

describe('ResponseCache — what a key separates, and what it does not', () => {
  it('separates the same URL under different parameters', () => {
    const cache = new ResponseCache({ enabled: true, maxSize: 50, ttl: 0 });
    cache.set('GET', '/a', 'paged', { PageSize: 10 });

    expect(cache.get('GET', '/a', { PageSize: 10 })).toBe('paged');
    expect(cache.get('GET', '/a')).toBeNull();
    expect(cache.get('GET', '/a', { PageSize: 20 })).toBeNull();
  });

  it('treats a different parameter ORDER as a different key — a miss, never wrong data', () => {
    // JSON.stringify preserves insertion order, so this is inherent to keying
    // on it. Recorded rather than fixed: module code builds these objects
    // literally, so the order is stable in practice, and the failure mode is
    // an extra fetch.
    const cache = new ResponseCache({ enabled: true, maxSize: 50, ttl: 0 });
    cache.set('GET', '/b', 'ordered', { a: 1, b: 2 });
    expect(cache.get('GET', '/b', { b: 2, a: 1 })).toBeNull();
  });

  it('collapses FALSY parameters onto the no-parameter key', () => {
    // `params ? JSON.stringify(params) : ''`, so 0, '' and false all key as
    // "no parameters". Unreachable through axios, which passes objects, and
    // harmless where it is not: both forms mean the same request.
    const cache = new ResponseCache({ enabled: true, maxSize: 50, ttl: 0 });
    cache.set('GET', '/c', 'zero', 0);
    expect(cache.get('GET', '/c')).toBe('zero');
  });

  it('refuses to STORE a non-GET while getOnly is set', () => {
    const cache = new ResponseCache({ enabled: true, maxSize: 50, ttl: 0, getOnly: true });
    cache.set('POST', '/d', 'posted');
    expect(cache.get('POST', '/d')).toBeNull();
  });

  it('stores every method when getOnly is off', () => {
    const cache = new ResponseCache({ enabled: true, maxSize: 50, ttl: 0, getOnly: false });
    cache.set('POST', '/d', 'posted');
    expect(cache.get('POST', '/d')).toBe('posted');
  });

  it('is inert when disabled', () => {
    const cache = new ResponseCache({ enabled: false, maxSize: 50, ttl: 0 });
    cache.set('GET', '/a', 'A');
    expect(cache.get('GET', '/a')).toBeNull();
  });
});

describe('ResponseCache — invalidation', () => {
  it('clears every entry for a URL, parameterised or not', () => {
    const cache = new ResponseCache({ enabled: true, maxSize: 50, ttl: 0 });
    cache.set('GET', '/jobs/v2.0/Folders', 'list');
    cache.set('GET', '/jobs/v2.0/Folders', 'listp', { PageSize: 5 });
    cache.set('GET', '/endpoints/v2.0/Endpoints', 'other');

    expect(cache.invalidateByPattern(/\/jobs\/v2\.0\/Folders/)).toBe(2);
    expect(cache.get('GET', '/jobs/v2.0/Folders')).toBeNull();
    expect(cache.get('GET', '/jobs/v2.0/Folders', { PageSize: 5 })).toBeNull();
    expect(cache.get('GET', '/endpoints/v2.0/Endpoints')).toBe('other');
  });

  it('invalidate() removes exactly one entry and reports whether it did', () => {
    const cache = new ResponseCache({ enabled: true, maxSize: 50, ttl: 0 });
    cache.set('GET', '/a', 'A');
    expect(cache.invalidate('GET', '/a')).toBe(true);
    expect(cache.invalidate('GET', '/a')).toBe(false);
    expect(cache.getStats().size).toBe(0);
  });

  it('clear() resets the entries AND the counters', () => {
    const cache = new ResponseCache({ enabled: true, maxSize: 50, ttl: 0 });
    cache.set('GET', '/a', 'A');
    cache.get('GET', '/a');
    cache.get('GET', '/missing');
    cache.clear();

    expect(cache.getStats()).toMatchObject({ hits: 0, misses: 0, size: 0 });
  });
});

describe('ResponseCache — the statistics a caller reads', () => {
  it('counts hits and misses, and cannot be mutated through getStats()', () => {
    const cache = new ResponseCache({ enabled: true, maxSize: 50, ttl: 0 });
    cache.set('GET', '/a', 'A');
    cache.get('GET', '/a');
    cache.get('GET', '/nope');

    const stats = cache.getStats();
    expect(stats).toMatchObject({ hits: 1, misses: 1, size: 1 });

    stats.hits = 999;
    expect(cache.getStats().hits).toBe(1);
  });

  it('reports a hit rate, and 0 rather than NaN before anything is asked', () => {
    const cache = new ResponseCache({ enabled: true, maxSize: 50, ttl: 0 });
    expect(cache.getHitRate()).toBe(0);

    cache.set('GET', '/a', 'A');
    cache.get('GET', '/a');
    expect(cache.getHitRate()).toBe(1);
  });
});
