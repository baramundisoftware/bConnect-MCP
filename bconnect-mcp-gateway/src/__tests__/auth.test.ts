/**
 * bconnect-mcp-gateway — bearer-token authentication (SEC-7).
 *
 * The unit half. The end-to-end half — a real HTTP request with and without the
 * header — is in app.test.ts, because "the middleware said next()" and "the MCP
 * endpoint answered" are different claims and only the second one matters.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import type { Request, Response } from "express";

import {
  MIN_TOKEN_LENGTH,
  createAuthMiddleware,
  evaluateBindPosture,
  isAuthenticatedRequest,
  presentedToken,
  resolveAuthConfig,
  tokenMatches,
} from "../auth.js";

const GOOD = "K3s9vQx7pL2mN8rT4wY6bZ1cD5fH0jA";      // 31 chars
const OTHER = "Q8w4E7r2T5y9U1i3O6p0A2s5D8f1G4h";      // 31 chars

function makeReq(path: string, headers: Record<string, string> = {}): Request {
  return { path, headers } as unknown as Request;
}

function makeRes() {
  const stub = {
    _status: 0,
    _body: null as unknown,
    _headers: {} as Record<string, string>,
    status(code: number) { stub._status = code; return stub; },
    json(body: unknown) { stub._body = body; return stub; },
    setHeader(k: string, v: string) { stub._headers[k] = v; },
  };
  return stub as unknown as Response & { _status: number; _body: unknown; _headers: Record<string, string> };
}

afterEach(() => {
  delete process.env.MCP_GATEWAY_AUTH_TOKEN;
  delete process.env.MCP_GATEWAY_BIND;
  delete process.env.MCP_ALLOW_NO_AUTH;
});

// ─── configuration ───────────────────────────────────────────────────────────

describe("resolveAuthConfig", () => {
  it("is disabled when MCP_GATEWAY_AUTH_TOKEN is unset", () => {
    expect(resolveAuthConfig({}).enabled).toBe(false);
  });

  it("treats an empty or whitespace token as unset", () => {
    expect(resolveAuthConfig({ MCP_GATEWAY_AUTH_TOKEN: "   " }).enabled).toBe(false);
  });

  it("accepts several comma-separated tokens (the rotation window)", () => {
    const config = resolveAuthConfig({ MCP_GATEWAY_AUTH_TOKEN: `${GOOD}, ${OTHER}` });
    expect(config.tokens).toEqual([GOOD, OTHER]);
    expect(config.enabled).toBe(true);
  });

  it("reports a short token as weak, by length only — never by value", () => {
    const config = resolveAuthConfig({ MCP_GATEWAY_AUTH_TOKEN: "hunter2" });
    expect(config.weak).toEqual([7]);
    expect(JSON.stringify(config.weak)).not.toContain("hunter2");
  });

  it("reads the environment on every call rather than caching it", () => {
    expect(resolveAuthConfig({}).enabled).toBe(false);
    process.env.MCP_GATEWAY_AUTH_TOKEN = GOOD;
    expect(resolveAuthConfig().enabled).toBe(true);
  });
});

// ─── header parsing and comparison ───────────────────────────────────────────

describe("presentedToken", () => {
  it("extracts a Bearer token", () => {
    expect(presentedToken(makeReq("/x", { authorization: `Bearer ${GOOD}` }))).toBe(GOOD);
  });

  it("accepts the scheme in any case (RFC 7235 says it is case-insensitive)", () => {
    expect(presentedToken(makeReq("/x", { authorization: `bEaReR ${GOOD}` }))).toBe(GOOD);
  });

  it("returns undefined for a non-Bearer scheme", () => {
    expect(presentedToken(makeReq("/x", { authorization: "Basic dXNlcjpwYXNz" }))).toBeUndefined();
  });

  it("returns undefined when there is no Authorization header", () => {
    expect(presentedToken(makeReq("/x"))).toBeUndefined();
  });
});

describe("tokenMatches", () => {
  it("matches a configured token", () => {
    expect(tokenMatches(GOOD, [GOOD])).toBe(true);
  });

  it("matches any token in the rotation set", () => {
    expect(tokenMatches(OTHER, [GOOD, OTHER])).toBe(true);
  });

  it("rejects a wrong token of the same length", () => {
    expect(tokenMatches(OTHER, [GOOD])).toBe(false);
  });

  // timingSafeEqual throws on unequal buffer lengths; comparing SHA-256 digests
  // means a wrong-length guess is a plain false rather than an exception (which
  // would be both a crash and a length oracle).
  it("rejects a wrong token of a different length without throwing", () => {
    expect(() => tokenMatches("x", [GOOD])).not.toThrow();
    expect(tokenMatches("x", [GOOD])).toBe(false);
    expect(tokenMatches(GOOD + GOOD, [GOOD])).toBe(false);
  });

  it("rejects a prefix of a configured token", () => {
    expect(tokenMatches(GOOD.slice(0, -1), [GOOD])).toBe(false);
  });
});

// ─── the middleware ──────────────────────────────────────────────────────────

describe("createAuthMiddleware", () => {
  it("passes everything through when no token is configured", () => {
    const next = vi.fn();
    createAuthMiddleware()(makeReq("/endpoints/mcp"), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("401s a request with no Authorization header", () => {
    process.env.MCP_GATEWAY_AUTH_TOKEN = GOOD;
    const res = makeRes();
    const next = vi.fn();
    createAuthMiddleware()(makeReq("/endpoints/mcp"), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
    expect(res._headers["WWW-Authenticate"]).toMatch(/^Bearer /);
  });

  it("401s a wrong token", () => {
    process.env.MCP_GATEWAY_AUTH_TOKEN = GOOD;
    const res = makeRes();
    createAuthMiddleware()(makeReq("/endpoints/mcp", { authorization: `Bearer ${OTHER}` }), res, vi.fn());
    expect(res._status).toBe(401);
  });

  it("never echoes the configured token in the refusal body", () => {
    process.env.MCP_GATEWAY_AUTH_TOKEN = GOOD;
    const res = makeRes();
    createAuthMiddleware()(makeReq("/endpoints/mcp", { authorization: "Bearer wrong" }), res, vi.fn());
    expect(JSON.stringify(res._body)).not.toContain(GOOD);
  });

  it("admits the correct token", () => {
    process.env.MCP_GATEWAY_AUTH_TOKEN = GOOD;
    const next = vi.fn();
    createAuthMiddleware()(makeReq("/endpoints/mcp", { authorization: `Bearer ${GOOD}` }), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("admits the OLD token during a rotation window", () => {
    process.env.MCP_GATEWAY_AUTH_TOKEN = `${OTHER},${GOOD}`;
    const next = vi.fn();
    createAuthMiddleware()(makeReq("/endpoints/mcp", { authorization: `Bearer ${OTHER}` }), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  // Container and orchestrator probes cannot carry the token, so /health stays
  // reachable — and, since SEC-10, discloses nothing to a caller without one.
  it("exempts /health", () => {
    process.env.MCP_GATEWAY_AUTH_TOKEN = GOOD;
    const next = vi.fn();
    createAuthMiddleware()(makeReq("/health"), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("picks up a token set after the middleware was created", () => {
    const mw = createAuthMiddleware();
    process.env.MCP_GATEWAY_AUTH_TOKEN = GOOD;
    const res = makeRes();
    mw(makeReq("/endpoints/mcp"), res, vi.fn());
    expect(res._status).toBe(401);
  });
});

// ─── SEC-10 · how much an exempt route may say ───────────────────────────────

describe("isAuthenticatedRequest", () => {
  it("is true only for a request carrying a configured token", () => {
    process.env.MCP_GATEWAY_AUTH_TOKEN = GOOD;
    expect(isAuthenticatedRequest(makeReq("/health", { authorization: `Bearer ${GOOD}` }))).toBe(true);
    expect(isAuthenticatedRequest(makeReq("/health", { authorization: `Bearer ${OTHER}` }))).toBe(false);
    expect(isAuthenticatedRequest(makeReq("/health"))).toBe(false);
  });

  it("is FALSE when no token is configured — 'nothing authenticates' is not 'everyone did'", () => {
    // The no-token shape includes the MCP_ALLOW_NO_AUTH deployment, which is
    // network-reachable. It must not be the shape that talks the most.
    expect(isAuthenticatedRequest(makeReq("/health"))).toBe(false);
  });
});

// ─── the startup posture — SEC-7's actual subject ────────────────────────────

describe("evaluateBindPosture", () => {
  it("permits the default loopback bind with no token (today's dev shape)", () => {
    const posture = evaluateBindPosture({});
    expect(posture.ok).toBe(true);
    expect(posture.loopback).toBe(true);
    expect(posture.authEnabled).toBe(false);
  });

  // THE regression this whole item exists to prevent: the shipped compose used
  // to set MCP_ALLOW_NO_AUTH=true and the Dockerfile MCP_GATEWAY_BIND=0.0.0.0,
  // so this combination — which is what `docker compose up` produced — started.
  it("REFUSES a non-loopback bind with no token and no assertion", () => {
    const posture = evaluateBindPosture({ MCP_GATEWAY_BIND: "0.0.0.0" });
    expect(posture.ok).toBe(false);
    expect(posture.reason).toMatch(/not loopback/i);
  });

  it("permits a non-loopback bind once a token is configured", () => {
    const posture = evaluateBindPosture({ MCP_GATEWAY_BIND: "0.0.0.0", MCP_GATEWAY_AUTH_TOKEN: GOOD });
    expect(posture.ok).toBe(true);
    expect(posture.authEnabled).toBe(true);
  });

  it("still permits the documented proxy escape hatch, MCP_ALLOW_NO_AUTH=true", () => {
    const posture = evaluateBindPosture({ MCP_GATEWAY_BIND: "0.0.0.0", MCP_ALLOW_NO_AUTH: "true" });
    expect(posture.ok).toBe(true);
    expect(posture.assertedNoAuth).toBe(true);
  });

  it("refuses a token shorter than the minimum, even on loopback", () => {
    const posture = evaluateBindPosture({ MCP_GATEWAY_AUTH_TOKEN: "short" });
    expect(posture.ok).toBe(false);
    expect(posture.reason).toContain(String(MIN_TOKEN_LENGTH));
  });

  it("puts a way out in the refusal rather than only a complaint", () => {
    const posture = evaluateBindPosture({ MCP_GATEWAY_BIND: "0.0.0.0" });
    expect(posture.detail.join("\n")).toContain("MCP_GATEWAY_AUTH_TOKEN");
    expect(posture.detail.join("\n")).toMatch(/openssl rand|randomBytes/);
  });

  it("never repeats the token in a message", () => {
    // A value that cannot appear by coincidence — "short" would, in "shorter".
    const posture = evaluateBindPosture({ MCP_GATEWAY_AUTH_TOKEN: "zzq7", MCP_GATEWAY_BIND: "0.0.0.0" });
    expect([posture.reason ?? "", ...posture.detail].join("\n")).not.toContain("zzq7");
  });

  it("treats ::1 and localhost as loopback", () => {
    expect(evaluateBindPosture({ MCP_GATEWAY_BIND: "::1" }).loopback).toBe(true);
    expect(evaluateBindPosture({ MCP_GATEWAY_BIND: "localhost" }).loopback).toBe(true);
  });
});
