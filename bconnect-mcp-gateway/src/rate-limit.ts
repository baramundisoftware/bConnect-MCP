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
 *   MCP_GATEWAY_RATE_LIMIT_MAX_KEYS  default 10000 (distinct client keys tracked)
 *   MCP_GATEWAY_HEALTH_RATE_LIMIT_MAX default 120  (GET /health, per key)
 *
 * SEC-4 — GET /health used to be exempt outright, matched by `req.path`. Two
 * things were wrong with that. It was an unmetered oracle: three consecutive
 * unauthenticated probes were answered while every other path on the same
 * connection was already 429. And matching by path alone meant POST /health was
 * treated as a probe too, so a body could be posted at it unmetered. Both are
 * closed by metering the liveness probe in its OWN keyspace: an orchestrator's
 * probe cannot spend the MCP budget, and a flood against /<domain>/mcp cannot
 * starve the probe into restarting a container that is perfectly healthy. Only
 * GET matches; anything else at that path is an ordinary request.
 *
 * SEC-8 — the bucket map is bounded. It used to be an unbounded
 * Map<ip, RateLimiter> with create-on-miss and no eviction, so a caller with a
 * rotating source address (an IPv6 /64 is enough) could allocate buckets until
 * the container's memory limit killed the process — the exact DoS this
 * middleware exists to prevent. Two bounds now apply: buckets untouched for
 * longer than the window are swept lazily (no timer, so nothing keeps the event
 * loop alive or leaks in tests), and the map is capped at MAX_KEYS with
 * least-recently-used eviction. Evicting a bucket only ever forgives past
 * consumption, so an attacker cannot use eviction to escape a limit they are
 * currently hitting: the LRU end of the map is by definition the callers who
 * are NOT active.
 *
 * This is a coarse in-app DoS backstop. The gateway has no built-in auth
 * (ADR-0003), so richer edge/flood/per-identity limiting belongs at the
 * fronting reverse proxy. Behind a proxy the real client IP requires Express
 * `trust proxy`, which createApp() now sets from MCP_GATEWAY_TRUST_PROXY.
 */

import type { Request, Response, NextFunction } from "express";
import { RateLimiter } from "@bconnect/mcp-core";

interface Bucket {
  limiter: RateLimiter;
  lastSeen: number;
}

export function createRateLimitMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  const enabled = process.env.MCP_GATEWAY_RATE_LIMIT_ENABLED !== "false"; // secure default: on
  const maxRaw = parseInt(process.env.MCP_GATEWAY_RATE_LIMIT_MAX ?? "", 10);
  const windowRaw = parseInt(process.env.MCP_GATEWAY_RATE_LIMIT_WINDOW_MS ?? "", 10);
  const keysRaw = parseInt(process.env.MCP_GATEWAY_RATE_LIMIT_MAX_KEYS ?? "", 10);
  const healthRaw = parseInt(process.env.MCP_GATEWAY_HEALTH_RATE_LIMIT_MAX ?? "", 10);
  const maxRequests = Number.isNaN(maxRaw) ? 300 : maxRaw;
  const windowMs = Number.isNaN(windowRaw) ? 60000 : windowRaw;
  const maxKeys = Number.isNaN(keysRaw) || keysRaw < 1 ? 10000 : keysRaw;
  // Generous by default: a container probe runs every 30s (twice a window), a
  // Kubernetes liveness+readiness pair rather more. The bound exists to stop an
  // unmetered oracle, not to police orchestrators.
  const healthMax = Number.isNaN(healthRaw) ? 120 : healthRaw;

  // One token bucket per client IP. Insertion order is maintained as LRU order:
  // a hit deletes and re-inserts the entry, so the map's first key is always the
  // least recently used one.
  const buckets = new Map<string, Bucket>();
  let lastSweep = Date.now();

  /** Drop buckets whose owner has not been seen for a full window. */
  function sweep(now: number): void {
    for (const [key, bucket] of buckets) {
      if (now - bucket.lastSeen > windowMs) {
        buckets.delete(key);
      }
    }
    lastSweep = now;
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!enabled) {
      next();
      return;
    }

    const now = Date.now();
    if (now - lastSweep > windowMs) {
      sweep(now);
    }

    // The liveness probe gets its own bucket per client, never the shared one.
    const probe = req.method === "GET" && req.path === "/health";
    const limit = probe ? healthMax : maxRequests;
    const key = `${probe ? "health" : "mcp"}:${req.ip ?? "global"}`;
    const existing = buckets.get(key);
    let limiter: RateLimiter;
    if (existing) {
      // Re-insert so this key moves to the most-recently-used end.
      buckets.delete(key);
      existing.lastSeen = now;
      buckets.set(key, existing);
      limiter = existing.limiter;
    } else {
      // Evict the least-recently-used keys until there is room for this one.
      while (buckets.size >= maxKeys) {
        const oldest = buckets.keys().next();
        if (oldest.done) { break; }
        buckets.delete(oldest.value);
      }
      limiter = new RateLimiter({ maxRequests: limit, windowMs, enabled: true });
      buckets.set(key, { limiter, lastSeen: now });
    }

    const info = limiter.tryConsume();
    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, info.remaining)));

    if (!info.allowed) {
      res.setHeader("Retry-After", String(Math.ceil(info.resetInMs / 1000)));
      res.status(429).json({ error: "Rate limit exceeded. Slow down and retry after the indicated delay." });
      return;
    }

    next();
  };
}
