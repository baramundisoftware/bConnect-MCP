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
 * This is a coarse in-app DoS backstop. The gateway has no built-in auth
 * (ADR-0003), so richer edge/flood/per-identity limiting belongs at the
 * fronting reverse proxy. Behind a proxy, set Express `trust proxy` if you need
 * the real client IP rather than the proxy's.
 */

import type { Request, Response, NextFunction } from "express";
import { RateLimiter } from "@bconnect/mcp-core";

export function createRateLimitMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  const enabled = process.env.MCP_GATEWAY_RATE_LIMIT_ENABLED !== "false"; // secure default: on
  const maxRaw = parseInt(process.env.MCP_GATEWAY_RATE_LIMIT_MAX ?? "", 10);
  const windowRaw = parseInt(process.env.MCP_GATEWAY_RATE_LIMIT_WINDOW_MS ?? "", 10);
  const maxRequests = Number.isNaN(maxRaw) ? 300 : maxRaw;
  const windowMs = Number.isNaN(windowRaw) ? 60000 : windowRaw;

  // One token bucket per client IP.
  const limiters = new Map<string, RateLimiter>();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!enabled || req.path === "/health") {
      next();
      return;
    }

    const key = req.ip ?? "global";
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
