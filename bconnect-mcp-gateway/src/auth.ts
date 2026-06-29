/**
 * bconnect-mcp-gateway — Auth middleware
 *
 * Exported separately so tests can import this module without pulling in
 * all 13 MCP server packages (which auth logic does not depend on).
 */

import fs from "fs";
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BConnectCredentials {
  baseUrl?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

export type TokenMap = Record<string, BConnectCredentials>;

// ─── Token hashing (audit M1) ──────────────────────────────────────────────────

const SHA256_HEX = /^[a-f0-9]{64}$/;

/** SHA-256 hex of a Bearer token — the key form used in a hashed token map. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * A token map is in "hashed" mode when every key is a SHA-256 hex digest.
 * Mixed/plaintext maps stay in legacy plaintext mode (with a warning at load).
 */
export function isHashedTokenMap(tokenMap: TokenMap): boolean {
  const keys = Object.keys(tokenMap);
  return keys.length > 0 && keys.every((k) => SHA256_HEX.test(k));
}

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
  const hashedMode = isHashedTokenMap(tokenMap);

  if (authEnabled) {
    if (hashedMode) {
      console.error(`[mcp-gateway] Auth: token map is hashed (SHA-256) — tokens are not stored in plaintext.`);
    } else {
      console.error(`[mcp-gateway] Auth: token map is PLAINTEXT. Recommend hashing tokens at rest — run 'node build/hash-token.js <token>' and use the digests as keys.`);
    }
  }

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
    // In hashed mode (audit M1) the map is keyed by SHA-256 of the token, so the
    // raw token is never stored at rest; hash the presented token before lookup.
    // Hashing also defuses lookup-timing concerns — there is no preimage to
    // recover from the (uniformly distributed) hash key.
    const lookupKey = hashedMode ? hashToken(token) : token;
    // Look up as an OWN property only. `tokenMap` is a plain object, so it
    // inherits truthy keys from Object.prototype (`__proto__`, `constructor`,
    // `toString`, …); indexing with one of those would pass the credential check
    // and authenticate as the env-fallback identity. hasOwnProperty rejects them.
    if (!Object.prototype.hasOwnProperty.call(tokenMap, lookupKey)) {
      res.status(401).json({ error: "Invalid or unknown token" });
      return;
    }

    const credentials = tokenMap[lookupKey];
    if (!credentials) {
      res.status(401).json({ error: "Invalid or unknown token" });
      return;
    }

    res.locals["bconnectCredentials"] = credentials;
    res.locals["authToken"] = token; // used as the per-token rate-limit key
    next();
  };
}
