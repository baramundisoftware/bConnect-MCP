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
  /** The request path the entry answers; invalidation matches it by path segments. */
  url: string;
  timestamp: number;
  expiresAt: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
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

  constructor(config: ResponseCacheConfig) {
    // A negative TTL used to mean "never expires"; NaN or Infinity can't expire either.
    if (config.ttl !== undefined && !(Number.isFinite(config.ttl) && config.ttl >= 0)) {
      throw new RangeError(`Response cache TTL must be a number of milliseconds, 0 or more (0 = no expiry); got ${config.ttl}`);
    }
    this.config = {
      enabled: config.enabled,
      maxSize: config.maxSize || 100,
      ttl: config.ttl !== undefined ? config.ttl : 300000, // 5 minutes default
      getOnly: config.getOnly !== undefined ? config.getOnly : true,
    };

    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      size: 0,
      maxSize: this.config.maxSize,
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
      return false; // No expiration
    }
    return Date.now() > entry.expiresAt;
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
      url,
      timestamp: now,
      expiresAt: this.config.ttl > 0 ? now + this.config.ttl : Number.MAX_SAFE_INTEGER,
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
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.size = 0;
  }

  /**
   * Invalidate specific cache entry
   */
  invalidate(method: string, url: string, params?: unknown): boolean {
    const key = this.generateKey(method, url, params);
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.size = this.cache.size;
    }
    return deleted;
  }

  /**
   * Invalidate the entries for a path and everything below it, matched by
   * whole path segments: "/x/v2.0/Things" covers "/x/v2.0/Things" and
   * "/x/v2.0/Things/1", not "/x/v2.0/ThingsX".
   */
  invalidatePath(path: string): number {
    // Trailing slashes off, without a regex: /\/+$/ backtracks on long runs of "/".
    let end = path.length;
    while (end > 0 && path[end - 1] === '/') {end--;}
    const prefix = path.slice(0, end);
    let count = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.url === prefix || entry.url.startsWith(`${prefix}/`)) {
        this.cache.delete(key);
        count++;
      }
    }
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
