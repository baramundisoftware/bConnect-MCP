/**
 * Cache invalidation on the real client path, including the URL that used to
 * make the response interceptor throw.
 *
 * ── The shape ───────────────────────────────────────────────────────────────
 * After a successful write, the client invalidates cache entries under the
 * written resource's PARENT path. It built that pattern with
 * `new RegExp(url.replace(/\/[^\/]+$/, ''))` — the URL interpolated into a
 * regex unescaped. Measured 2026-08-23:
 *
 *   * `.` was a wildcard, so a write under `/jobs/v2.0/Folders` also matched
 *     `/jobs/v2X0/Folders`. Over-invalidation, harmless — one cache entry too
 *     few costs a refetch.
 *   * an unbalanced `(` or `[` in a NON-FINAL segment made `new RegExp` THROW,
 *     inside the SUCCESS interceptor, after bMS had already applied the write.
 *     The caller sees a successful write as a failure, and may repeat it.
 *
 * ── Reachability, stated plainly ────────────────────────────────────────────
 * Not reached on this estate, and this is hardening rather than a repair. It
 * needs response caching enabled (off by default), a 2xx write, and a regex
 * metacharacter in a segment that is not the last. Real ids are GUIDs;
 * `assertSafePathSegment` rejects `/`, `\` and `..` but permits `(`, and
 * `encodeURIComponent` leaves parens alone, so nothing structurally prevents
 * one from reaching a path. The failure mode is bad enough, and the fix small
 * enough, that "it cannot happen today" was not a good enough reason to leave
 * it.
 */

import { describe, it, expect } from 'vitest';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { BConnectClientBase } from '../src/bconnect-client-base.js';

function cachingClient(): BConnectClientBase {
  return new BConnectClientBase({
    baseUrl: 'https://bms.invalid/bconnect',
    apiKey: 'test-key',
    timeout: 1000,
    cache: { enabled: true, maxSize: 100, ttl: 60_000, getOnly: true },
  });
}

/** Answers every request from memory, and records what was dispatched. */
function adapterAnswering(
  client: BConnectClientBase,
  answer: (config: InternalAxiosRequestConfig) => { status: number; data: unknown }
): InternalAxiosRequestConfig[] {
  const seen: InternalAxiosRequestConfig[] = [];
  client.getHttpClient().defaults.adapter = async (config) => {
    seen.push(config as InternalAxiosRequestConfig);
    const { status, data } = answer(config as InternalAxiosRequestConfig);
    if (status >= 400) {
      throw new AxiosError(
        `Request failed with status code ${status}`,
        String(status),
        config as InternalAxiosRequestConfig,
        {},
        { data, status, statusText: 'Error', headers: {}, config } as never
      );
    }
    return { data, status, statusText: 'OK', headers: {}, config } as never;
  };
  return seen;
}

describe('the cache actually caches, on the client path', () => {
  it('serves the second identical GET without dispatching it', async () => {
    const client = cachingClient();
    const seen = adapterAnswering(client, () => ({ status: 200, data: { totalItems: 1 } }));
    const http = client.getHttpClient();

    const first = await http.get('/endpoints/v2.0/Endpoints');
    const second = await http.get('/endpoints/v2.0/Endpoints');

    expect(seen).toHaveLength(1);
    expect(first.headers['x-cache']).toBe('MISS');
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.data).toEqual({ totalItems: 1 });
  });

  it('a write under the same parent drops the cached read', async () => {
    const client = cachingClient();
    const seen = adapterAnswering(client, () => ({ status: 200, data: { ok: true } }));
    const http = client.getHttpClient();

    await http.get('/jobs/v2.0/Folders');
    await http.delete('/jobs/v2.0/Folders/aaaa0001-0001-0001-0001-000000000001');
    await http.get('/jobs/v2.0/Folders');

    // GET, DELETE, GET — the second GET must reach the adapter again.
    expect(seen).toHaveLength(3);
  });

  it('leaves an unrelated collection cached', async () => {
    const client = cachingClient();
    const seen = adapterAnswering(client, () => ({ status: 200, data: { ok: true } }));
    const http = client.getHttpClient();

    await http.get('/endpoints/v2.0/Endpoints');
    await http.delete('/jobs/v2.0/Folders/aaaa0001-0001-0001-0001-000000000001');
    const again = await http.get('/endpoints/v2.0/Endpoints');

    expect(again.headers['x-cache']).toBe('HIT');
    expect(seen).toHaveLength(2);
  });
});

describe('a regex metacharacter in the path cannot break a successful write', () => {
  it('does not reject the response when a NON-FINAL segment holds an unbalanced paren', async () => {
    const client = cachingClient();
    adapterAnswering(client, () => ({ status: 200, data: { ok: true } }));
    const http = client.getHttpClient();

    // The parent path becomes `/jobs/v2.0/Folders/a(b`, which is not a valid
    // regex. Unescaped, `new RegExp` threw here and the caller saw the write
    // fail — after bMS had performed it.
    await expect(
      http.delete('/jobs/v2.0/Folders/a(b/Children')
    ).resolves.toMatchObject({ status: 200 });
  });

  it('survives every metacharacter that can legally reach a path segment', async () => {
    const client = cachingClient();
    adapterAnswering(client, () => ({ status: 200, data: { ok: true } }));
    const http = client.getHttpClient();

    for (const segment of ['a(b', 'a[b', 'a+b', 'a*b', 'a?b', 'a{2b', 'a$b', 'a^b', 'a|b']) {
      await expect(
        http.delete(`/jobs/v2.0/Folders/${segment}/Children`),
        `a "${segment}" segment broke the response interceptor`
      ).resolves.toMatchObject({ status: 200 });
    }
  });

  it('invalidates the exact parent, treating "." as a literal', async () => {
    const client = cachingClient();
    const seen = adapterAnswering(client, () => ({ status: 200, data: { ok: true } }));
    const http = client.getHttpClient();

    // `/jobs/v2X0/Folders` differs from `/jobs/v2.0/Folders` only where the
    // unescaped '.' used to act as a wildcard.
    await http.get('/jobs/v2X0/Folders');
    await http.delete('/jobs/v2.0/Folders/aaaa0001-0001-0001-0001-000000000001');
    const again = await http.get('/jobs/v2X0/Folders');

    expect(again.headers['x-cache'], 'the wildcard "." invalidated an unrelated path').toBe('HIT');
    expect(seen).toHaveLength(2);
  });
});
