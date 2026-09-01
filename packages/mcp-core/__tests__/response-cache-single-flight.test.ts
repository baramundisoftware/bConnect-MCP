/**
 * Single-flight on the real client path: concurrent identical GETs share one
 * wire call, and — the half that earns the tests — every ERROR path settles.
 *
 * ── Why this exists (measured before it was built) ──────────────────────────
 * Ten CONCURRENT identical GETs produced ten wire calls where ten sequential
 * produced one: the cache serves only what has LANDED, so a burst of the same
 * question — every composite fan-out's shape — was a thundering herd at bMS.
 *
 * ── The rules under test ────────────────────────────────────────────────────
 *  * A flight that ends in an HTTP response (ANY status) resolves with
 *    {status, statusText, data}; each waiter applies its OWN validateStatus.
 *  * A flight with no response — network failure, refusal — rejects, shared.
 *  * A settled or invalidated flight is GONE: errors are never cached, and
 *    `stats.inFlight` returning to 0 is the leak observable.
 *  * A leader that fails with zero waiters must not become an
 *    unhandledRejection.
 *  * A waiter is bounded by its own `timeout` even if a flight leaks.
 *  * axios-retry re-dispatch must not make a leader join its own flight.
 *
 * The wire is a controllable default adapter (`seen.length` = wire calls); a
 * waiter served by the shared-flight adapter never reaches it, which is
 * exactly the claim being counted.
 */

import { describe, it, expect } from 'vitest';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { BConnectClientBase } from '../src/bconnect-client-base.js';

function cachingClient(extra: Partial<ConstructorParameters<typeof BConnectClientBase>[0]> = {}): BConnectClientBase {
  return new BConnectClientBase({
    baseUrl: 'https://bms.invalid/bconnect',
    apiKey: 'test-key',
    timeout: 1000,
    cache: { enabled: true, maxSize: 100, ttl: 60_000, getOnly: true },
    ...extra,
  });
}

interface Gate {
  opened: Promise<void>;
  release: () => void;
}
function gate(): Gate {
  let release!: () => void;
  const opened = new Promise<void>((r) => {
    release = r;
  });
  return { opened, release };
}

/**
 * Install a wire: every DISPATCHED request lands here (a shared-flight waiter
 * never does). `answer` may await a gate to hold requests in flight.
 */
function wire(
  client: BConnectClientBase,
  answer: (config: InternalAxiosRequestConfig, hit: number) => Promise<{ status: number; data: unknown }>
): InternalAxiosRequestConfig[] {
  const seen: InternalAxiosRequestConfig[] = [];
  client.getHttpClient().defaults.adapter = async (config) => {
    const cfg = config as InternalAxiosRequestConfig;
    seen.push(cfg);
    const { status, data } = await answer(cfg, seen.length);
    // Faithful to settle(): the REQUEST's own validateStatus decides whether a
    // status resolves or throws — a validateStatus-true caller receives a 500
    // as data from a real adapter, and must from this one too.
    const validate = cfg.validateStatus;
    if (validate && !validate(status)) {
      throw new AxiosError(
        `Request failed with status code ${status}`,
        status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
        cfg,
        {},
        { data, status, statusText: 'Error', headers: {}, config } as never
      );
    }
    return { data, status, statusText: status < 400 ? 'OK' : 'Error', headers: {}, config } as never;
  };
  return seen;
}

/** A network-level failure: no response object at all. */
function wireThatDies(client: BConnectClientBase): InternalAxiosRequestConfig[] {
  const seen: InternalAxiosRequestConfig[] = [];
  client.getHttpClient().defaults.adapter = async (config) => {
    seen.push(config as InternalAxiosRequestConfig);
    throw new AxiosError('socket hang up', 'ECONNRESET', config as InternalAxiosRequestConfig);
  };
  return seen;
}

describe('concurrent identical GETs share one wire call', () => {
  it('10 concurrent -> 1 dispatch, 1 MISS + 9 SHARED, identical data', async () => {
    const client = cachingClient();
    const g = gate();
    const seen = wire(client, async () => {
      await g.opened;
      return { status: 200, data: { totalItems: 7 } };
    });
    const http = client.getHttpClient();

    const calls = Array.from({ length: 10 }, () => http.get('/endpoints/v2.0/Endpoints'));
    // Let every request pass its interceptors before the wire answers —
    // this is the burst the 10-wire-calls measurement was taken on.
    await new Promise((r) => setTimeout(r, 20));
    g.release();
    const responses = await Promise.all(calls);

    expect(seen).toHaveLength(1);
    const markers = responses.map((r) => r.headers['x-cache']).sort();
    expect(markers).toEqual(['MISS', ...Array.from({ length: 9 }, () => 'SHARED')]);
    for (const r of responses) {
      expect(r.status).toBe(200);
      expect(r.data).toEqual({ totalItems: 7 });
    }
    expect(client.getCacheStats()?.sharedFlights).toBe(9);
    expect(client.getCacheStats()?.inFlight).toBe(0);
  });

  it('different params are different questions and do not share', async () => {
    const client = cachingClient();
    const g = gate();
    const seen = wire(client, async (cfg) => {
      await g.opened;
      return { status: 200, data: { page: (cfg.params as { Page: number }).Page } };
    });
    const http = client.getHttpClient();

    const a = http.get('/endpoints/v2.0/Endpoints', { params: { Page: 0 } });
    const b = http.get('/endpoints/v2.0/Endpoints', { params: { Page: 1 } });
    await new Promise((r) => setTimeout(r, 20));
    g.release();
    const [ra, rb] = await Promise.all([a, b]);

    expect(seen).toHaveLength(2);
    expect(ra.data).toEqual({ page: 0 });
    expect(rb.data).toEqual({ page: 1 });
  });

  it('after the flight lands, the next caller is an ordinary cache HIT', async () => {
    const client = cachingClient();
    const seen = wire(client, async () => ({ status: 200, data: { n: 1 } }));
    const http = client.getHttpClient();

    const [first, second] = await Promise.all([
      http.get('/endpoints/v2.0/Endpoints'),
      http.get('/endpoints/v2.0/Endpoints'),
    ]);
    const third = await http.get('/endpoints/v2.0/Endpoints');

    expect(seen).toHaveLength(1);
    expect([first.headers['x-cache'], second.headers['x-cache']].sort()).toEqual(['MISS', 'SHARED']);
    expect(third.headers['x-cache']).toBe('HIT');
  });

  it('caching disabled means no sharing — an explicit opt-out stays opted out', async () => {
    const client = new BConnectClientBase({
      baseUrl: 'https://bms.invalid/bconnect',
      apiKey: 'test-key',
      timeout: 1000,
    });
    const g = gate();
    const seen = wire(client, async () => {
      await g.opened;
      return { status: 200, data: {} };
    });
    const http = client.getHttpClient();
    const calls = [http.get('/x'), http.get('/x')];
    await new Promise((r) => setTimeout(r, 20));
    g.release();
    await Promise.all(calls);
    expect(seen).toHaveLength(2);
  });

  it('POST never shares, even with getOnly:false caching', async () => {
    // shouldCache(POST) is true under getOnly:false — an operator's choice
    // about REREADING. Collapsing two POST submissions into one send would be
    // a different action with side effects; canShareFlight is GET-only.
    const client = cachingClient({ cache: { enabled: true, getOnly: false, ttl: 60_000 } });
    const g = gate();
    const seen = wire(client, async () => {
      await g.opened;
      return { status: 200, data: {} };
    });
    const http = client.getHttpClient();
    const calls = [http.post('/jobs/v2.0/Folders', { a: 1 }), http.post('/jobs/v2.0/Folders', { a: 1 })];
    await new Promise((r) => setTimeout(r, 20));
    g.release();
    await Promise.all(calls);
    expect(seen).toHaveLength(2);
  });
});

describe('the error paths, which are the point', () => {
  it('a network failure rejects EVERY waiter, is never cached, and clears the flight', async () => {
    const client = cachingClient();
    const seen = wireThatDies(client);
    const http = client.getHttpClient();

    const results = await Promise.allSettled([
      http.get('/endpoints/v2.0/Endpoints'),
      http.get('/endpoints/v2.0/Endpoints'),
      http.get('/endpoints/v2.0/Endpoints'),
    ]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(seen).toHaveLength(1);
    expect(client.getCacheStats()?.inFlight).toBe(0);

    // The rejection was not remembered: the next caller leads a fresh request.
    await expect(http.get('/endpoints/v2.0/Endpoints')).rejects.toThrow();
    expect(seen).toHaveLength(2);
  });

  it('an HTTP 500 resolves the flight with its status; each caller applies its OWN validateStatus', async () => {
    const client = cachingClient();
    const g = gate();
    const seen = wire(client, async () => {
      await g.opened;
      return { status: 500, data: { traceId: 't' } };
    });
    const http = client.getHttpClient();

    // Leader uses the default contract; the waiter reads statuses as data —
    // both call shapes exist in production (insights composites vs tools).
    const leader = http.get('/endpoints/v2.0/Endpoints');
    const waiter = http.get('/endpoints/v2.0/Endpoints', { validateStatus: () => true });
    await new Promise((r) => setTimeout(r, 20));
    g.release();

    // handleError has already translated the 500 into its INT-43 message by
    // the time a caller sees it — same as any non-shared wire 500.
    await expect(leader).rejects.toThrow(/internal server error/);
    const shared = await waiter;
    expect(shared.status).toBe(500);
    expect(shared.data).toEqual({ traceId: 't' });
    expect(shared.headers['x-cache']).toBe('SHARED');
    expect(seen).toHaveLength(1);
    // A 500 is never cached, whichever contract observed it.
    expect(client.getCacheStats()?.size).toBe(0);
    expect(client.getCacheStats()?.inFlight).toBe(0);
  });

  it('the mirror image: a validateStatus-true leader hands a default-contract waiter its proper error', async () => {
    const client = cachingClient();
    const g = gate();
    wire(client, async () => {
      await g.opened;
      return { status: 500, data: { traceId: 't' } };
    });
    const http = client.getHttpClient();

    const leader = http.get('/endpoints/v2.0/Endpoints', { validateStatus: () => true });
    const waiter = http.get('/endpoints/v2.0/Endpoints');
    await new Promise((r) => setTimeout(r, 20));
    g.release();

    const observed = await leader;
    expect(observed.status).toBe(500);
    // The waiter's own contract turns the shared 500 into an error carrying
    // the response, so handleError produces EXACTLY the message its own wire
    // call would have produced — the INT-43 text, estate body included.
    await expect(waiter).rejects.toThrow(/internal server error/);
  });

  it('a refused leader settles its flight — nothing stays registered behind a RequestBlockedError', async () => {
    const client = cachingClient();
    const seen = wire(client, async () => ({ status: 200, data: {} }));
    const http = client.getHttpClient();

    // `..` is refused by the path guard AFTER the cache interceptor has
    // already registered the flight (request interceptors run LIFO). Without
    // the config attached to the refusal, this flight would leak and
    // inFlight would stay 1 — the hang every later identical caller inherits.
    const results = await Promise.allSettled([
      http.get('/endpoints/v2.0/../secrets'),
      http.get('/endpoints/v2.0/../secrets'),
    ]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(seen).toHaveLength(0);
    expect(client.getCacheStats()?.inFlight).toBe(0);
  });

  it('a leader that fails with zero waiters does not become an unhandledRejection', async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', listener);
    try {
      const client = cachingClient();
      wireThatDies(client);
      await expect(client.getHttpClient().get('/endpoints/v2.0/Endpoints')).rejects.toThrow();
      // Unhandled rejections surface on later macrotask turns; give them two.
      await new Promise((r) => setTimeout(r, 20));
      await new Promise((r) => setTimeout(r, 0));
      // Mapped to messages so a failure NAMES the leaked rejection.
      expect(unhandled.map((e) => String(e instanceof Error ? e.message : e))).toEqual([]);
    } finally {
      process.off('unhandledRejection', listener);
    }
  });

  it("a waiter is bounded by its OWN timeout even when the flight never settles", async () => {
    const client = cachingClient();
    const g = gate(); // never released within the waiter's window
    wire(client, async () => {
      await g.opened;
      return { status: 200, data: {} };
    });
    const http = client.getHttpClient();

    const leader = http.get('/endpoints/v2.0/Endpoints', { timeout: 60_000 });
    const waiter = http.get('/endpoints/v2.0/Endpoints', { timeout: 100 });
    await new Promise((r) => setTimeout(r, 20));

    // handleError's fallback prefixes "Request error:" and re-wraps, so the
    // MESSAGE is the durable contract here (the ETIMEDOUT code is for layers
    // that observe the error before handleError, axios-retry among them).
    await expect(waiter).rejects.toThrow(/Shared in-flight GET .* did not settle within 100ms/);

    // Let the leader land so nothing is left pending after the test.
    g.release();
    await leader;
  });

  it('axios-retry spans the flight: waiters wait out the retries and get the recovery', async () => {
    const client = cachingClient({ maxRetries: 1, retryDelay: 1 });
    const g = gate();
    const seen = wire(client, async (_cfg, hit) => {
      await g.opened;
      // First attempt fails, the retry succeeds.
      return hit === 1 ? { status: 500, data: {} } : { status: 200, data: { recovered: true } };
    });
    const http = client.getHttpClient();

    const leader = http.get('/endpoints/v2.0/Endpoints');
    const waiter = http.get('/endpoints/v2.0/Endpoints');
    await new Promise((r) => setTimeout(r, 20));
    g.release();

    const [rl, rw] = await Promise.all([leader, waiter]);
    // Two dispatches (attempt + retry), both from the LEADER; the waiter rode
    // along. A leader whose retry re-entered the interceptor and JOINED its
    // own flight would deadlock here instead.
    expect(seen).toHaveLength(2);
    expect(rl.data).toEqual({ recovered: true });
    expect(rw.data).toEqual({ recovered: true });
  });

  it('a write invalidates the pending flight: a caller arriving after it leads fresh', async () => {
    const client = cachingClient();
    const g = gate();
    const seen = wire(client, async (cfg, hit) => {
      if (hit === 1) {
        await g.opened;
        return { status: 200, data: { stale: true } };
      }
      return { status: 200, data: cfg.method?.toUpperCase() === 'POST' ? { written: true } : { fresh: true } };
    });
    const http = client.getHttpClient();

    // A GET is on the wire when a write lands under the same parent. The
    // write's invalidation must drop the FLIGHT along with the cache entries:
    // a reader arriving after the write must not be handed pre-write data.
    const before = http.get('/jobs/v2.0/Folders');
    await new Promise((r) => setTimeout(r, 20));
    await http.post('/jobs/v2.0/Folders', { name: 'new' });
    const after = http.get('/jobs/v2.0/Folders');
    await new Promise((r) => setTimeout(r, 20));
    g.release();

    const [rb, ra] = await Promise.all([before, after]);
    // Three dispatches: the gated GET, the POST, and the post-write GET that
    // led its own flight instead of joining the stale one.
    expect(seen).toHaveLength(3);
    expect(rb.data).toEqual({ stale: true });
    expect(ra.data).toEqual({ fresh: true });
  });
});
