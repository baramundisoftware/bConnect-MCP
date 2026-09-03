/**
 * Response Cache - LRU Cache with TTL
 *
 * Provides response caching for bConnect API with configurable TTL and size limits.
 * Uses LRU (Least Recently Used) eviction strategy.
 */

export interface ResponseCacheConfig {
  /**
   * Enable response caching
   * @default false
   */
  enabled: boolean;

  /**
   * Maximum number of cache entries
   * @default 100
   */
  maxSize?: number;

  /**
   * Time-to-live in milliseconds (0 = no expiration)
   * @default 300000 (5 minutes)
   */
  ttl?: number;

  /**
   * Cache only GET requests
   * @default true
   */
  getOnly?: boolean;
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
  /** Requests served by joining another caller's in-flight identical GET. */
  sharedFlights: number;
  /** In-flight GETs currently registered for single-flight sharing. */
  inFlight: number;
}

/**
 * What a completed flight hands every waiter: the leader's HTTP outcome,
 * status included. NOT just the body — the waiter's own `validateStatus`
 * decides whether its status is an answer or an error, because production
 * callers genuinely differ here (insights composites read with
 * `validateStatus: () => true` on the same client whose tool paths use the
 * default), and a waiter must keep its own contract regardless of who led.
 */
export interface SharedFlightResult {
  status: number;
  statusText: string;
  data: unknown;
}

/** Settle handles for the caller that leads a flight. */
export interface FlightHandle {
  resolve: (outcome: SharedFlightResult) => void;
  reject: (error: unknown) => void;
}

/**
 * LRU Cache with TTL
 *
 * Caches API responses with automatic expiration and size-based eviction.
 * Uses Map to maintain insertion order for LRU behavior.
 */
export class ResponseCache {
  private cache: Map<string, CacheEntry<unknown>>;
  private readonly config: Required<ResponseCacheConfig>;
  private stats: CacheStats;
  /**
   * Single-flight registry: cache key -> the promise of an identical GET that
   * is on the wire RIGHT NOW. Separate from `cache` on purpose — these are
   * coordination, not data: an entry exists only between dispatch and settle,
   * is never TTL'd, and is never served after the flight lands (the landed
   * response reaches later callers through `cache`, under the TTL, or not at
   * all).
   *
   * ── Why this exists (measured) ─────────────────────────────────────────────
   * Ten CONCURRENT identical GETs produced ten wire calls where ten sequential
   * ones produced one: the cache can only serve what has ALREADY landed, so a
   * burst of the same question — the shape every composite fan-out produces —
   * was a thundering herd pointed at bMS.
   *
   * ── The error rules, decided rather than inherited ─────────────────────────
   *  * A flight that ends in an HTTP RESPONSE (any status) resolves with
   *    {status, statusText, data}; each waiter applies its OWN validateStatus.
   *  * A flight that ends with NO response — network failure, client-side
   *    refusal, cancellation — REJECTS, and every waiter shares that error:
   *    they asked the same question at the same moment, and re-issuing N
   *    requests at a failing bMS is the herd again, at the worst time.
   *  * A settled flight is DELETED in the same tick, so a rejection is never
   *    remembered: the next caller leads a fresh request. Errors are never
   *    cached, here or in `cache` (set() is 2xx-only).
   *  * The registered promise carries a no-op catch, so a leader that fails
   *    with ZERO waiters does not become an unhandledRejection.
   */
  private flights: Map<string, Promise<SharedFlightResult>>;

  constructor(config: ResponseCacheConfig) {
    this.config = {
      enabled: config.enabled,
      maxSize: config.maxSize || 100,
      ttl: config.ttl !== undefined ? config.ttl : 300000, // 5 minutes default
      getOnly: config.getOnly !== undefined ? config.getOnly : true,
    };

    this.cache = new Map();
    this.flights = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      size: 0,
      maxSize: this.config.maxSize,
      sharedFlights: 0,
      inFlight: 0,
    };
  }

  /**
   * Generate cache key from method, URL, and parameters
   */
  private generateKey(method: string, url: string, params?: unknown): string {
    const paramsStr = params ? JSON.stringify(params) : '';
    return `${method.toUpperCase()}:${url}:${paramsStr}`;
  }

  /**
   * Check if cache entry is expired
   */
  private isExpired(entry: CacheEntry<unknown>): boolean {
    if (this.config.ttl === 0) {
      return false; // No expiration — a documented mode.
    }
    return Date.now() > entry.expiresAt;
  }

  /**
   * When an entry written now should stop being served.
   *
   * The three cases are deliberate, and a NEGATIVE ttl is the one worth
   * explaining. `set` used to compute `ttl > 0 ? now + ttl : MAX_SAFE_INTEGER`,
   * so a ttl of -1 produced an entry that never expired, while `isExpired`
   * only treated 0 as "no expiration" and would happily have expired it. The
   * two halves disagreed, and the half that won was the dangerous one: a cache
   * that serves estate data for the life of the process.
   *
   * `BCONNECT_CACHE_TTL_MS` is read with `parseInt` and no lower bound, so a
   * negative value reaches here from an operator's environment rather than
   * from code. It is nonsense input, and the safe reading of nonsense is the
   * one that serves nothing: entries expire immediately, the cache becomes
   * inert, and the caller gets live data. Never the reading that serves a
   * stale answer forever.
   */
  private expiryFor(now: number): number {
    if (this.config.ttl > 0) {
      return now + this.config.ttl;
    }
    return this.config.ttl === 0 ? Number.MAX_SAFE_INTEGER : 0;
  }

  /**
   * Evict expired entries
   */
  private evictExpired(): void {
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
      }
    }
    this.stats.size = this.cache.size;
  }

  /**
   * Evict oldest entry (LRU)
   */
  private evictOldest(): void {
    // Map maintains insertion order, so first key is oldest
    const firstKey = this.cache.keys().next().value;
    if (firstKey) {
      this.cache.delete(firstKey);
      this.stats.size = this.cache.size;
    }
  }

  /**
   * Check if request should be cached
   */
  shouldCache(method: string): boolean {
    if (!this.config.enabled) {
      return false;
    }

    if (this.config.getOnly) {
      return method.toUpperCase() === 'GET';
    }

    return true;
  }

  /**
   * Get cached response
   */
  get<T>(method: string, url: string, params?: unknown): T | null {
    if (!this.config.enabled) {
      return null;
    }

    const key = this.generateKey(method, url, params);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check if expired
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.stats.size = this.cache.size;
      this.stats.misses++;
      return null;
    }

    // Move to end (mark as recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.stats.hits++;
    return entry.data as T;
  }

  /**
   * Set cached response
   */
  set<T>(method: string, url: string, data: T, params?: unknown): void {
    if (!this.config.enabled || !this.shouldCache(method)) {
      return;
    }

    const key = this.generateKey(method, url, params);
    const now = Date.now();

    const entry: CacheEntry<T> = {
      data,
      timestamp: now,
      expiresAt: this.expiryFor(now),
    };

    // Evict expired entries first
    this.evictExpired();

    // If cache is full, evict oldest
    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      this.evictOldest();
    }

    // If key already exists, delete it first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    this.cache.set(key, entry);
    this.stats.size = this.cache.size;
  }

  /**
   * True when this method may participate in single-flight sharing.
   *
   * GET only, ALWAYS — deliberately narrower than `shouldCache`, whose
   * `getOnly: false` mode would otherwise let two concurrent POSTs share one
   * wire call. Caching a POST response is an operator's explicit choice about
   * REREADING; collapsing two distinct POST submissions into one send is a
   * different action with side effects, and no configuration should be able
   * to turn it on.
   */
  private canShareFlight(method: string): boolean {
    return this.config.enabled && method.toUpperCase() === "GET";
  }

  /**
   * Join an identical GET already on the wire, if any. Null means "no flight —
   * dispatch your own" (also the answer whenever sharing is off for this
   * method or the cache is disabled).
   */
  joinFlight(method: string, url: string, params?: unknown): Promise<SharedFlightResult> | null {
    if (!this.canShareFlight(method)) {
      return null;
    }
    const flight = this.flights.get(this.generateKey(method, url, params));
    if (!flight) {
      return null;
    }
    this.stats.sharedFlights++;
    return flight;
  }

  /**
   * Register a new flight and return its settle handles, or null when sharing
   * is off for this method or a flight is already registered (the caller lost
   * a race and should just dispatch — one extra wire call, never a hang).
   *
   * The handles are idempotent-ish by construction: settling removes the
   * registry entry only if it is still THIS flight, so a stale handle can
   * never delete a successor's registration.
   */
  beginFlight(method: string, url: string, params?: unknown): FlightHandle | null {
    if (!this.canShareFlight(method)) {
      return null;
    }
    const key = this.generateKey(method, url, params);
    if (this.flights.has(key)) {
      return null;
    }
    let resolve!: (outcome: SharedFlightResult) => void;
    let reject!: (error: unknown) => void;
    const flight = new Promise<SharedFlightResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // A leader that fails with no waiters must not crash the process: the
    // registry's copy of the promise absorbs the rejection; every waiter got
    // its own link via joinFlight and still sees the error.
    flight.catch(() => {});
    this.flights.set(key, flight);
    this.stats.inFlight = this.flights.size;
    const settle = (): void => {
      if (this.flights.get(key) === flight) {
        this.flights.delete(key);
        this.stats.inFlight = this.flights.size;
      }
    };
    return {
      resolve: (outcome) => {
        settle();
        resolve(outcome);
      },
      reject: (error) => {
        settle();
        reject(error);
      },
    };
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
    // Coordination follows the data: joiners after a clear() should re-ask the
    // wire. Waiters already holding a cleared flight still settle from it.
    this.flights.clear();
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.size = 0;
    this.stats.sharedFlights = 0;
    this.stats.inFlight = 0;
  }

  /**
   * Invalidate specific cache entry
   */
  invalidate(method: string, url: string, params?: unknown): boolean {
    const key = this.generateKey(method, url, params);
    // Drop any in-flight registration too: a GET dispatched before the
    // invalidating write carries pre-write data, and a caller arriving AFTER
    // the invalidation must not be handed it. Existing waiters keep their
    // promise — they joined before the write, same as today's TOCTOU window.
    if (this.flights.delete(key)) {
      this.stats.inFlight = this.flights.size;
    }
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.size = this.cache.size;
    }
    return deleted;
  }

  /**
   * Invalidate cache entries by URL pattern
   */
  /**
   * Extract the URL from a cache key (format: METHOD:URL:PARAMS_JSON).
   * URL may contain ':' (e.g. https://host:port/path). params are always
   * JSON.stringify(object) so they start with '{', or empty string.
   * Find method/URL boundary (first ':') and URL/params boundary (last ':{' or trailing ':').
   */
  private urlOfKey(key: string): string | null {
    const methodEnd = key.indexOf(':');
    if (methodEnd === -1) {return null;}
    const paramsColonIdx = key.lastIndexOf(':{');
    return paramsColonIdx > methodEnd
      ? key.slice(methodEnd + 1, paramsColonIdx)
      : key.slice(methodEnd + 1).replace(/:$/, '');
  }

  invalidateByPattern(pattern: RegExp): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      const url = this.urlOfKey(key);
      if (url !== null && pattern.test(url)) {
        this.cache.delete(key);
        count++;
      }
    }
    // Same rule as invalidate(): coordination follows the data, so a caller
    // arriving after the write leads a fresh request instead of joining a
    // flight that predates it.
    for (const key of this.flights.keys()) {
      const url = this.urlOfKey(key);
      if (url !== null && pattern.test(url)) {
        this.flights.delete(key);
      }
    }
    this.stats.inFlight = this.flights.size;
    this.stats.size = this.cache.size;
    return count;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<Required<ResponseCacheConfig>> {
    return { ...this.config };
  }

  /**
   * Get cache hit rate
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    return total > 0 ? this.stats.hits / total : 0;
  }
}
