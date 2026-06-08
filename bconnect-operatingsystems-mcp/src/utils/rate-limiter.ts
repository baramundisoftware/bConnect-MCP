/**
 * Rate Limiter - Token Bucket Algorithm
 *
 * Implements rate limiting to prevent API abuse and protect backend services.
 * Uses the token bucket algorithm for smooth rate limiting with burst capacity.
 */

export interface RateLimiterConfig {
  /**
   * Maximum number of requests allowed per time window
   * @default 100
   */
  maxRequests: number;

  /**
   * Time window in milliseconds
   * @default 60000 (1 minute)
   */
  windowMs: number;

  /**
   * Whether rate limiting is enabled
   * @default true
   */
  enabled: boolean;

  /**
   * Custom error message when rate limit is exceeded
   * @default "Rate limit exceeded. Please try again later."
   */
  message?: string;

  /**
   * Allow burst capacity (tokens can accumulate up to maxRequests)
   * @default true
   */
  allowBurst?: boolean;
}

export interface RateLimitInfo {
  /** Number of requests remaining in current window */
  remaining: number;
  /** Total requests allowed per window */
  limit: number;
  /** Time in ms until rate limit resets */
  resetInMs: number;
  /** Whether the request was allowed */
  allowed: boolean;
}

/**
 * Token Bucket Rate Limiter
 *
 * Allows smooth rate limiting with burst capacity. Tokens are added at a constant
 * rate, and each request consumes one token. If no tokens are available, the
 * request is rate limited.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefillTime: number;
  private readonly config: Required<RateLimiterConfig>;
  private readonly refillRate: number; // tokens per millisecond

  constructor(config: RateLimiterConfig) {
    this.config = {
      maxRequests: config.maxRequests,
      windowMs: config.windowMs,
      enabled: config.enabled,
      message: config.message || 'Rate limit exceeded. Please try again later.',
      allowBurst: config.allowBurst !== undefined ? config.allowBurst : true,
    };

    // Calculate refill rate: tokens per millisecond
    this.refillRate = this.config.maxRequests / this.config.windowMs;

    // Start with full bucket
    this.tokens = this.config.maxRequests;
    this.lastRefillTime = Date.now();
  }

  /**
   * Refill tokens based on elapsed time since last refill
   */
  private refillTokens(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefillTime;

    // Add tokens based on time passed
    const tokensToAdd = timePassed * this.refillRate;
    this.tokens = Math.min(
      this.config.maxRequests, // Cap at bucket size
      this.tokens + tokensToAdd
    );

    this.lastRefillTime = now;
  }

  /**
   * Try to consume a token for a request
   * @returns Rate limit information
   */
  tryConsume(): RateLimitInfo {
    // If rate limiting is disabled, always allow
    if (!this.config.enabled) {
      return {
        remaining: this.config.maxRequests,
        limit: this.config.maxRequests,
        resetInMs: 0,
        allowed: true,
      };
    }

    // Refill tokens based on time elapsed
    this.refillTokens();

    // Check if we have tokens available
    const allowed = this.tokens >= 1;

    if (allowed) {
      // Consume one token
      this.tokens -= 1;
    }

    // Calculate time until next token is available
    const tokensNeeded = allowed ? 0 : 1 - this.tokens;
    const resetInMs = Math.ceil(tokensNeeded / this.refillRate);

    return {
      remaining: Math.floor(this.tokens),
      limit: this.config.maxRequests,
      resetInMs,
      allowed,
    };
  }

  /**
   * Check if a request would be allowed without consuming a token
   * @returns Rate limit information
   */
  checkLimit(): RateLimitInfo {
    if (!this.config.enabled) {
      return {
        remaining: this.config.maxRequests,
        limit: this.config.maxRequests,
        resetInMs: 0,
        allowed: true,
      };
    }

    // Refill tokens (but don't consume)
    this.refillTokens();

    const allowed = this.tokens >= 1;
    const tokensNeeded = allowed ? 0 : 1 - this.tokens;
    const resetInMs = Math.ceil(tokensNeeded / this.refillRate);

    return {
      remaining: Math.floor(this.tokens),
      limit: this.config.maxRequests,
      resetInMs,
      allowed,
    };
  }

  /**
   * Reset the rate limiter (refill bucket to full)
   */
  reset(): void {
    this.tokens = this.config.maxRequests;
    this.lastRefillTime = Date.now();
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<Required<RateLimiterConfig>> {
    return { ...this.config };
  }
}

/**
 * Rate Limit Error
 * Thrown when a request exceeds the rate limit
 */
export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly info: RateLimitInfo
  ) {
    super(message);
    this.name = 'RateLimitError';
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}
