/**
 * bconnect-mcp-gateway — per-token rate limiting (security audit H2).
 *
 * Limits INBOUND requests to the gateway, keyed per Bearer token (or per client
 * IP when auth is disabled), so one noisy caller / runaway workflow cannot
 * exhaust the gateway or hammer the downstream bMS. Reuses the token-bucket
 * RateLimiter from @bconnect/mcp-core — no extra dependency.
 *
 * Config (env):
 *   MCP_GATEWAY_RATE_LIMIT_ENABLED   default "true" (set "false" to disable)
 *   MCP_GATEWAY_RATE_LIMIT_MAX       default 300   (requests per window, per key)
 *   MCP_GATEWAY_RATE_LIMIT_WINDOW_MS default 60000 (window size, ms)
 *
 * Edge/flood protection and per-IP limits belong at the TLS reverse proxy
 * (see ADR-0001); this in-app layer is the per-token fairness/abuse control
 * the proxy cannot do (it does not see token identity).
 */

import type { Request, Response, NextFunction } from "express";
import { RateLimiter } from "@bconnect/mcp-core";

export function createRateLimitMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  const enabled = process.env.MCP_GATEWAY_RATE_LIMIT_ENABLED !== "false"; // secure default: on
  const maxRaw = parseInt(process.env.MCP_GATEWAY_RATE_LIMIT_MAX ?? "", 10);
  const windowRaw = parseInt(process.env.MCP_GATEWAY_RATE_LIMIT_WINDOW_MS ?? "", 10);
  const maxRequests = Number.isNaN(maxRaw) ? 300 : maxRaw;
  const windowMs = Number.isNaN(windowRaw) ? 60000 : windowRaw;

  // One token bucket per caller key. Token maps are finite, so this map is
  // bounded for the authenticated case.
  const limiters = new Map<string, RateLimiter>();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!enabled || req.path === "/health") {
      next();
      return;
    }

    const key = (res.locals["authToken"] as string | undefined) ?? req.ip ?? "global";
    let limiter = limiters.get(key);
    if (!limiter) {
      limiter = new RateLimiter({ maxRequests, windowMs, enabled: true });
      limiters.set(key, limiter);
    }

    const info = limiter.tryConsume();
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
