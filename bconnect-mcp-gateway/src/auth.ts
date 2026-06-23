/**
 * bconnect-mcp-gateway — Auth middleware
 *
 * Exported separately so tests can import this module without pulling in
 * all 13 MCP server packages (which auth logic does not depend on).
 */

import fs from "fs";
import type { Request, Response, NextFunction } from "express";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BConnectCredentials {
  baseUrl?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

export type TokenMap = Record<string, BConnectCredentials>;

// ─── Token map loading ───────────────────────────────────────────────────────

/**
 * Load and parse the token map from a JSON file.
 * Returns an empty object when configPath is falsy (auth disabled).
 * Calls process.exit(1) on any file or parse error.
 */
export function loadTokenMap(configPath?: string): TokenMap {
  if (!configPath) {
    return {};
  }

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    console.error(`[mcp-gateway] Cannot read token map at '${configPath}':`, err);
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[mcp-gateway] Token map at '${configPath}' is not valid JSON:`, err);
    process.exit(1);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.error(`[mcp-gateway] Token map must be a JSON object mapping tokens to credentials.`);
    process.exit(1);
  }

  console.error(`[mcp-gateway] Auth: loaded ${Object.keys(parsed as object).length} token(s) from '${configPath}'`);
  return parsed as TokenMap;
}

// ─── Auth middleware factory ──────────────────────────────────────────────────

/**
 * Returns an Express middleware that:
 *  - Always passes /health through unauthenticated.
 *  - When tokenMap is empty (auth disabled): passes all requests through.
 *  - When tokenMap is non-empty: requires Authorization: Bearer <token>;
 *    resolves the token to credentials and stores them in res.locals.
 */
export function createAuthMiddleware(
  tokenMap: TokenMap
): (req: Request, res: Response, next: NextFunction) => void {
  const authEnabled = Object.keys(tokenMap).length > 0;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path === "/health") {
      next();
      return;
    }

    if (!authEnabled) {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Authorization header required: Bearer <token>" });
      return;
    }

    const token = authHeader.slice(7);
    // Look up the token as an OWN property only. `tokenMap` is a plain object,
    // so it inherits truthy keys from Object.prototype (`__proto__`,
    // `constructor`, `toString`, `hasOwnProperty`, …). Indexing with one of
    // those as the token would return a truthy value and pass the credential
    // check, authenticating an attacker as the env-fallback identity. Gating
    // on hasOwnProperty rejects every inherited key.
    if (!Object.prototype.hasOwnProperty.call(tokenMap, token)) {
      res.status(401).json({ error: "Invalid or unknown token" });
      return;
    }

    const credentials = tokenMap[token];
    if (!credentials) {
      res.status(401).json({ error: "Invalid or unknown token" });
      return;
    }

    res.locals["bconnectCredentials"] = credentials;
    next();
  };
}
