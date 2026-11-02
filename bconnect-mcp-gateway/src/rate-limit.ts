/**
 * bconnect-mcp-gateway — per-token rate limiting (security audit H2).
 *
 * Limits INBOUND requests to the gateway, keyed per client IP, so one noisy
 * caller / runaway workflow cannot exhaust the gateway or hammer the downstream
 * bMS. Reuses the token-bucket RateLimiter from @bconnect/mcp-core — no extra
 * dependency.
 *
 * Config (env):
 *   MCP_GATEWAY_RATE_LIMIT_ENABLED   default "true" (set "false" to disable)
 *   MCP_GATEWAY_RATE_LIMIT_MAX       default 300   (requests per window, per key)
 *   MCP_GATEWAY_RATE_LIMIT_WINDOW_MS default 60000 (window size, ms)
 *
 * GET /health counts in a bucket of its own with the same settings, so health
 * probes and MCP traffic can't use up each other's limit; any other method on
 * /health counts as an ordinary request (#330).
 *
 * This is a coarse in-app DoS backstop. The gateway has no built-in auth
 * (ADR-0003), so richer edge/flood/per-identity limiting belongs at the
 * fronting reverse proxy. Behind a proxy, MCP_GATEWAY_TRUST_PROXY makes the
 * limit key on the client address the proxy reports (#331).
 */

import type { Request, Response, NextFunction } from "express";
import { RateLimiter, type RateLimitInfo } from "@bconnect/mcp-core";

/** Most client addresses tracked at once, per bucket kind (#330). */
export const MAX_TRACKED_CLIENTS = 10_000;

/**
 * One token bucket per client address, bounded. The map is kept in order of
 * last use: a bucket idle for a whole window is full again, so it is dropped,
 * and when the map is still full the least recently used one goes.
 */
export class ClientBuckets {
  private readonly buckets = new Map<string, { limiter: RateLimiter; lastUsed: number }>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly maxClients = MAX_TRACKED_CLIENTS,
  ) {}

  /** Clients tracked now. */
  get size(): number {
    return this.buckets.size;
  }

  consume(key: string): RateLimitInfo {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (bucket) {
      this.buckets.delete(key);
    } else {
      bucket = { limiter: new RateLimiter({ maxRequests: this.maxRequests, windowMs: this.windowMs, enabled: true }), lastUsed: now };
    }
    for (const [idleKey, idle] of this.buckets) {
      if (now - idle.lastUsed < this.windowMs) {break;}
      this.buckets.delete(idleKey);
    }
    if (this.buckets.size >= this.maxClients) {
      this.buckets.delete(this.buckets.keys().next().value as string);
    }
    bucket.lastUsed = now;
    this.buckets.set(key, bucket);
    return bucket.limiter.tryConsume();
  }
}

export function createRateLimitMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  const enabled = process.env.MCP_GATEWAY_RATE_LIMIT_ENABLED !== "false"; // secure default: on
  const maxRaw = parseInt(process.env.MCP_GATEWAY_RATE_LIMIT_MAX ?? "", 10);
  const windowRaw = parseInt(process.env.MCP_GATEWAY_RATE_LIMIT_WINDOW_MS ?? "", 10);
  const maxRequests = Number.isNaN(maxRaw) ? 300 : maxRaw;
  const windowMs = Number.isNaN(windowRaw) ? 60000 : windowRaw;

  const requests = new ClientBuckets(maxRequests, windowMs);
  const healthChecks = new ClientBuckets(maxRequests, windowMs);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!enabled) {
      next();
      return;
    }

    // Express answers HEAD with the GET route.
    const health = req.path === "/health" && (req.method === "GET" || req.method === "HEAD");
    const info = (health ? healthChecks : requests).consume(req.ip ?? "global");
    res.setHeader("X-RateLimit-Limit", String(maxRequests));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, info.remaining)));

    if (!info.allowed) {
      res.setHeader("Retry-After", String(Math.ceil(info.resetInMs / 1000)));
      res.status(429).json({ error: "Rate limit exceeded. Slow down and retry after the indicated delay." });
      return;
    }

    next();
  };
}
