/**
 * bconnect-mcp-gateway — built-in bearer-token authentication (SEC-7 / SEC-9).
 *
 * WHY THIS EXISTS AT ALL, GIVEN ADR-0003
 * --------------------------------------
 * ADR-0003 delegated authentication to a fronting reverse proxy. That decision is
 * still respected — a proxy is still the right place for TLS, an IdP, per-user
 * identity and edge rate limiting — but it left the shipped artifact with a
 * problem: docker-compose.gateway.yml set MCP_ALLOW_NO_AUTH=true and the
 * Dockerfile set MCP_GATEWAY_BIND=0.0.0.0, so the fail-closed guard in gateway.ts
 * was permanently satisfied in the ONLY supported deployment path. The container
 * shipped with its own guard disarmed, and the single control left standing was
 * the loopback-scoped host publish — one documented variable away from an
 * unauthenticated MCP endpoint fronting all 13 servers with a bMS service
 * credential.
 *
 * Removing the flag alone breaks `docker compose up`, which is why it was held.
 * So the flag goes AND the gateway grows the smallest authentication that makes
 * the secure configuration the easy one: a shared bearer token the installer
 * generates for you.
 *
 * THE RULE
 * --------
 *   MCP_GATEWAY_AUTH_TOKEN set   → every request to /<domain>/mcp must carry
 *                                  `Authorization: Bearer <token>` or get 401.
 *   MCP_GATEWAY_AUTH_TOKEN unset → no authentication, and gateway.ts then refuses
 *                                  any bind that is not loopback (unless the
 *                                  operator re-asserts MCP_ALLOW_NO_AUTH=true,
 *                                  which remains a documented escape hatch for a
 *                                  real proxy deployment — it is simply no longer
 *                                  pre-asserted on the operator's behalf).
 *
 * This is a shared secret, not an identity system. It answers "may this caller
 * talk to the gateway at all", which is the question the shipped artifact could
 * not previously answer. It deliberately does NOT answer "who is this caller" —
 * that stays with the proxy, and the access log still records the principal the
 * proxy authenticated (see access-log.ts).
 *
 * DESIGN NOTES THAT ARE EASY TO GET WRONG
 * ---------------------------------------
 *   * Comparison is constant-time over SHA-256 digests, not over the raw strings.
 *     Hashing first means a wrong-LENGTH guess costs the same as a wrong-VALUE
 *     guess (timingSafeEqual throws on unequal lengths, and the throw itself is
 *     an oracle), and it bounds work on a hostile 10 MB header.
 *   * Several tokens may be configured, comma-separated. That is the whole
 *     rotation story: publish the new one, let both work, retire the old one. A
 *     rotation that requires downtime does not get done.
 *   * A short token is refused at startup rather than accepted quietly. When this
 *     is the only authentication in the path, a four-character token is worse
 *     than none, because it reads as protection.
 *   * /health is exempt so container and orchestrator probes keep working. To an
 *     unauthenticated caller it answers {"status":"ok"} and nothing else (SEC-10);
 *     the domain list it used to publish is now behind this token.
 *   * The env var is read on every call, never cached at module load, so a test
 *     (and an operator restarting the process) sees the change.
 *
 * Config (env):
 *   MCP_GATEWAY_AUTH_TOKEN       one or more shared tokens, comma-separated.
 *                                Also accepted as MCP_GATEWAY_AUTH_TOKEN_FILE
 *                                (Docker secret) — see secrets.ts.
 *   MCP_ALLOW_NO_AUTH            "true" asserts an authenticating proxy is in
 *                                front, permitting a non-loopback bind with no
 *                                token. Not set by anything we ship.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { Logger } from "./logger.js";

/**
 * Shortest token the gateway will start with.
 *
 * 24 characters is ~144 bits at base64url, which is not a number anyone reaches
 * by typing a password they can remember — and that is the point. The refusal
 * message carries a one-liner that produces a correct one, so the cheapest way
 * out of the error is the secure way.
 */
export const MIN_TOKEN_LENGTH = 24;

/** The one-liners printed with every refusal. Keep them copy-pasteable. */
export const TOKEN_RECIPES = [
  'PowerShell:  [Convert]::ToBase64String((1..32|%{Get-Random -Max 256})) -replace "\\+","-" -replace "/","_" -replace "="',
  "openssl:     openssl rand -base64 32 | tr '+/' '-_' | tr -d '='",
  "node:        node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"",
];

const LOOPBACK_BINDS = ["127.0.0.1", "::1", "localhost", "[::1]"];

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export interface AuthConfig {
  /** Configured tokens, trimmed and de-duplicated. */
  tokens: string[];
  /** True when at least one token is configured — i.e. the gateway authenticates. */
  enabled: boolean;
  /** Configured tokens shorter than MIN_TOKEN_LENGTH, reported by length only. */
  weak: number[];
}

/** Resolve the token configuration from the environment. Never cached. */
export function resolveAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const tokens = [
    ...new Set(
      (env.MCP_GATEWAY_AUTH_TOKEN ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ""),
    ),
  ];
  return {
    tokens,
    enabled: tokens.length > 0,
    // Lengths only. The value must never reach a log line or an error message.
    weak: tokens.filter((t) => t.length < MIN_TOKEN_LENGTH).map((t) => t.length),
  };
}

/** The token presented on a request, or undefined. Bearer scheme, case-insensitive. */
export function presentedToken(req: Request): string | undefined {
  const raw = req.headers?.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== "string") { return undefined; }
  const match = /^bearer[ \t]+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : undefined;
}

/** Constant-time membership test of `candidate` in `tokens`. */
export function tokenMatches(candidate: string, tokens: string[]): boolean {
  const presented = digest(candidate);
  let matched = false;
  for (const token of tokens) {
    // No early exit: every configured token is compared on every call, so the
    // time taken does not reveal WHICH token was close.
    if (timingSafeEqual(presented, digest(token))) { matched = true; }
  }
  return matched;
}

/**
 * Did this request present a token the gateway accepts?
 *
 * SEC-10 — used by /health, which is exempt from the guard below so probes keep
 * working, to decide how much to say. Deliberately FALSE when no token is
 * configured: "nothing authenticates here" is not "everyone is authenticated",
 * and the no-token shape includes the MCP_ALLOW_NO_AUTH deployment, which is
 * network-reachable. A loopback developer install loses nothing by it — the
 * domain list is one POST to an unknown domain away.
 */
export function isAuthenticatedRequest(req: Request): boolean {
  const config = resolveAuthConfig();
  if (!config.enabled) { return false; }
  const candidate = presentedToken(req);
  return candidate !== undefined && tokenMatches(candidate, config.tokens);
}

function deny(res: Response, message: string): void {
  // Same JSON-RPC-shaped envelope the host guard returns, so a client sees one
  // error shape from the gateway's edge regardless of which control refused it.
  res.setHeader("WWW-Authenticate", 'Bearer realm="bconnect-mcp-gateway"');
  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message },
    id: null,
  });
}

/**
 * Bearer-token guard. Mount before the MCP routes.
 *
 * A gateway with no token configured is a pass-through — that is what keeps a
 * loopback single-operator install a one-liner, and gateway.ts is the control
 * that stops it being the shape of a network-reachable deployment.
 */
export function createAuthMiddleware(
  logger?: Logger,
): (req: Request, res: Response, next: NextFunction) => void {
  if (!resolveAuthConfig().enabled) {
    logger?.warn(
      "no MCP_GATEWAY_AUTH_TOKEN — the gateway will not authenticate callers. This is only " +
        "safe on a loopback bind, or behind a proxy that authenticates for it (ADR-0003).",
    );
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const config = resolveAuthConfig();
    if (!config.enabled || req.path === "/health") {
      next();
      return;
    }

    const candidate = presentedToken(req);
    if (candidate === undefined) {
      deny(res, "Missing bearer token. Send 'Authorization: Bearer <MCP_GATEWAY_AUTH_TOKEN>'.");
      return;
    }
    if (!tokenMatches(candidate, config.tokens)) {
      deny(res, "Invalid bearer token.");
      return;
    }

    next();
  };
}

// ─── Startup posture (used by gateway.ts) ────────────────────────────────────

export interface BindPosture {
  /** May the gateway start? */
  ok: boolean;
  /** Why not, ready to print. Present only when ok === false. */
  reason?: string;
  /** Extra lines to print alongside a refusal or a warning. */
  detail: string[];
  loopback: boolean;
  authEnabled: boolean;
  /** MCP_ALLOW_NO_AUTH=true — the operator asserting a proxy is in front. */
  assertedNoAuth: boolean;
  /** One line describing the posture, for the startup log. */
  summary: string;
}

/**
 * Decide whether this bind + auth combination may start, and describe it.
 *
 * Extracted from gateway.ts so the decision is testable: gateway.ts is a
 * top-level script that calls process.exit(), which cannot be exercised from a
 * test without taking the runner with it.
 */
export function evaluateBindPosture(env: NodeJS.ProcessEnv = process.env): BindPosture {
  const bind = (env.MCP_GATEWAY_BIND ?? "127.0.0.1").trim();
  const loopback = LOOPBACK_BINDS.includes(bind.toLowerCase());
  const auth = resolveAuthConfig(env);
  const assertedNoAuth = env.MCP_ALLOW_NO_AUTH === "true";

  // A token too short to be a token fails everywhere, loopback included: it is
  // the one case where the operator believes there is authentication and there
  // effectively is not.
  if (auth.weak.length > 0) {
    return {
      ok: false,
      reason:
        `Refusing to start: MCP_GATEWAY_AUTH_TOKEN contains ${auth.weak.length} token(s) shorter ` +
        `than ${MIN_TOKEN_LENGTH} characters (length ${auth.weak.join(", ")}). This token is the ` +
        "only thing standing between a caller and a bMS service credential; a guessable one is " +
        "worse than none, because it reads as protection.",
      detail: ["Generate one with:", ...TOKEN_RECIPES],
      loopback,
      authEnabled: auth.enabled,
      assertedNoAuth,
      summary: "refused — weak token",
    };
  }

  if (loopback) {
    return {
      ok: true,
      detail: auth.enabled
        ? []
        : [
            "Loopback bind, no token: reachable by anything running as any user on this host.",
            "Set MCP_GATEWAY_AUTH_TOKEN to require one even here.",
          ],
      loopback,
      authEnabled: auth.enabled,
      assertedNoAuth,
      summary: auth.enabled
        ? "loopback bind, bearer token required"
        : "loopback bind, no authentication",
    };
  }

  if (auth.enabled) {
    return {
      ok: true,
      detail: [
        "Non-loopback bind with a bearer token. The token authenticates the CALLER; it is not " +
          "TLS — put a TLS-terminating proxy in front before this crosses a network you do not " +
          "control, or the token travels in clear text.",
      ],
      loopback,
      authEnabled: true,
      assertedNoAuth,
      summary: "non-loopback bind, bearer token required",
    };
  }

  if (assertedNoAuth) {
    return {
      ok: true,
      detail: [
        "MCP_ALLOW_NO_AUTH=true asserts an authenticating proxy is in front. Nothing here checks " +
          "whether that is true. Setting MCP_GATEWAY_AUTH_TOKEN as well costs nothing and makes " +
          "the gateway refuse a caller that reaches it around the proxy.",
      ],
      loopback,
      authEnabled: false,
      assertedNoAuth: true,
      summary: "non-loopback bind, no gateway auth — asserted proxy in front",
    };
  }

  return {
    ok: false,
    reason:
      `Refusing to start: bind '${bind}' is not loopback and nothing authenticates callers. ` +
      "Everything that can reach this port would get the full reach of the bConnect service " +
      "credential.",
    detail: [
      "Pick one:",
      "  1. Set MCP_GATEWAY_AUTH_TOKEN (recommended — one variable, works everywhere):",
      ...TOKEN_RECIPES.map((line) => "     " + line),
      "  2. Keep MCP_GATEWAY_BIND on 127.0.0.1 and reach it through a co-located proxy.",
      "  3. Set MCP_ALLOW_NO_AUTH=true to assert an authenticating proxy already fronts it.",
    ],
    loopback,
    authEnabled: false,
    assertedNoAuth: false,
    summary: "refused — non-loopback bind without authentication",
  };
}
