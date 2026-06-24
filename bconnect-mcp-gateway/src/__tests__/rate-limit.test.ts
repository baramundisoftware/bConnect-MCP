/**
 * bconnect-mcp-gateway — per-token rate limiting (security audit H2).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { Request, Response } from "express";

import { createRateLimitMiddleware } from "../rate-limit.js";

function makeReq(path: string): Request {
  return { path, ip: "127.0.0.1", headers: {} } as unknown as Request;
}

function makeRes(authToken?: string) {
  const stub = {
    locals: (authToken ? { authToken } : {}) as Record<string, unknown>,
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
  delete process.env.MCP_GATEWAY_RATE_LIMIT_ENABLED;
  delete process.env.MCP_GATEWAY_RATE_LIMIT_MAX;
  delete process.env.MCP_GATEWAY_RATE_LIMIT_WINDOW_MS;
});

describe("createRateLimitMiddleware", () => {
  it("allows requests under the limit", () => {
    process.env.MCP_GATEWAY_RATE_LIMIT_MAX = "5";
    const mw = createRateLimitMiddleware();
    const next = vi.fn();
    mw(makeReq("/endpoints/mcp"), makeRes("tok-a"), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("always exempts /health", () => {
    process.env.MCP_GATEWAY_RATE_LIMIT_MAX = "1";
    const mw = createRateLimitMiddleware();
    mw(makeReq("/endpoints/mcp"), makeRes("tok-h"), vi.fn()); // consume the 1
    const next = vi.fn();
    mw(makeReq("/health"), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 429 with Retry-After once a token exceeds its limit", () => {
    process.env.MCP_GATEWAY_RATE_LIMIT_MAX = "2";
    const mw = createRateLimitMiddleware();
    mw(makeReq("/endpoints/mcp"), makeRes("tok-x"), vi.fn());
    mw(makeReq("/endpoints/mcp"), makeRes("tok-x"), vi.fn());
    const res3 = makeRes("tok-x");
    const next3 = vi.fn();
    mw(makeReq("/endpoints/mcp"), res3, next3);
    expect(next3).not.toHaveBeenCalled();
    expect(res3._status).toBe(429);
    expect(res3._headers["Retry-After"]).toBeDefined();
  });

  it("isolates limits per token (token A exhausted does not block token B)", () => {
    process.env.MCP_GATEWAY_RATE_LIMIT_MAX = "1";
    const mw = createRateLimitMiddleware();
    mw(makeReq("/endpoints/mcp"), makeRes("A"), vi.fn()); // A consumes its 1
    const resA2 = makeRes("A");
    mw(makeReq("/endpoints/mcp"), resA2, vi.fn());
    expect(resA2._status).toBe(429); // A is now blocked
    const nextB = vi.fn();
    mw(makeReq("/endpoints/mcp"), makeRes("B"), nextB);
    expect(nextB).toHaveBeenCalledOnce(); // B is unaffected
  });

  it("is a no-op when MCP_GATEWAY_RATE_LIMIT_ENABLED=false", () => {
    process.env.MCP_GATEWAY_RATE_LIMIT_ENABLED = "false";
    process.env.MCP_GATEWAY_RATE_LIMIT_MAX = "1";
    const mw = createRateLimitMiddleware();
    mw(makeReq("/endpoints/mcp"), makeRes("z"), vi.fn());
    const next = vi.fn();
    mw(makeReq("/endpoints/mcp"), makeRes("z"), next);
    expect(next).toHaveBeenCalledOnce(); // not blocked despite max=1
  });
});
