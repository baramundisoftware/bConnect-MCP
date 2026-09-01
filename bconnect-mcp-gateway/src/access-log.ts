/**
 * bconnect-mcp-gateway — per-request access log (audit M4).
 *
 * Logs method, path, status, duration and a NON-reversible caller id for every
 * request (including 401/429), so operators can audit who called what. Placed
 * first in the chain so it captures the final status set by later middleware.
 *
 * The gateway has no built-in auth (ADR-0003); callers are identified by client
 * IP. Real identity lives at the fronting reverse proxy. /health is logged at
 * debug only, to avoid probe noise.
 *
 * SEC-8 — behind the mandated reverse proxy, `caller` used to be the proxy's
 * address for every request, so this log (the gateway's only caller-identity
 * record) had zero attribution value. Two changes fix that: createApp() sets
 * Express `trust proxy`, so req.ip is the real client where the hop is trusted,
 * and the principal the proxy authenticated is logged from a configurable
 * header.
 *
 * Config (env):
 *   MCP_GATEWAY_IDENTITY_HEADER  header carrying the proxy-authenticated
 *                                principal; default "x-forwarded-user".
 */

import type { Request, Response, NextFunction } from "express";
import type { Logger } from "./logger.js";

/**
 * The proxy-supplied principal, if the fronting proxy set one.
 *
 * Only trusted to the same degree as the rest of the proxy's headers — it is an
 * audit aid, not an authorization input, and nothing in the gateway reads it
 * back. Truncated so a hostile header cannot bloat a log line.
 */
function principalOf(req: Request): string | undefined {
  const header = (process.env.MCP_GATEWAY_IDENTITY_HEADER ?? "x-forwarded-user").toLowerCase();
  const raw = req.headers?.[header];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  return value.trim().slice(0, 128);
}

export function createAccessLogMiddleware(logger: Logger): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();

    res.on("finish", () => {
      const durationMs = Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10;
      const caller = req.ip ?? "-";
      const principal = principalOf(req);
      const fields = {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs,
        caller,
        ...(principal && { principal }),
      };
      if (req.path === "/health") {
        logger.debug("request", fields);
      } else {
        logger.info("request", fields);
      }
    });

    next();
  };
}
