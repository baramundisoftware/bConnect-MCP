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
 */

import type { Request, Response, NextFunction } from "express";
import type { Logger } from "./logger.js";

export function createAccessLogMiddleware(logger: Logger): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();

    res.on("finish", () => {
      const durationMs = Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10;
      const caller = req.ip ?? "-";
      const fields = {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs,
        caller,
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
