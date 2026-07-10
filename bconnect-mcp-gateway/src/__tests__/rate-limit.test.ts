/**
 * bconnect-mcp-gateway — per-IP rate limiting (security audit H2).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { Request, Response } from "express";

import { createRateLimitMiddleware } from "../rate-limit.js";

function makeReq(path: string, ip = "127.0.0.1"): Request {
  return { path, ip, headers: {} } as unknown as Request;
}

function makeRes() {
  const stub = {
    locals: {} as Record<string, unknown>,
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
    mw(makeReq("/endpoints/mcp"), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("always exempts /health", () => {
    process.env.MCP_GATEWAY_RATE_LIMIT_MAX = "1";
    const mw = createRateLimitMiddleware();
    mw(makeReq("/endpoints/mcp"), makeRes(), vi.fn()); // consume the 1
    const next = vi.fn();
    mw(makeReq("/health"), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 429 with Retry-After once a caller exceeds its limit", () => {
    process.env.MCP_GATEWAY_RATE_LIMIT_MAX = "2";
    const mw = createRateLimitMiddleware();
    mw(makeReq("/endpoints/mcp"), makeRes(), vi.fn());
    mw(makeReq("/endpoints/mcp"), makeRes(), vi.fn());
    const res3 = makeRes();
    const next3 = vi.fn();
    mw(makeReq("/endpoints/mcp"), res3, next3);
    expect(next3).not.toHaveBeenCalled();
    expect(res3._status).toBe(429);
    expect(res3._headers["Retry-After"]).toBeDefined();
  });

  it("isolates limits per client IP (IP A exhausted does not block IP B)", () => {
    process.env.MCP_GATEWAY_RATE_LIMIT_MAX = "1";
    const mw = createRateLimitMiddleware();
    mw(makeReq("/endpoints/mcp", "10.0.0.1"), makeRes(), vi.fn()); // A consumes its 1
    const resA2 = makeRes();
    mw(makeReq("/endpoints/mcp", "10.0.0.1"), resA2, vi.fn());
    expect(resA2._status).toBe(429); // A is now blocked
    const nextB = vi.fn();
    mw(makeReq("/endpoints/mcp", "10.0.0.2"), makeRes(), nextB);
    expect(nextB).toHaveBeenCalledOnce(); // B (different IP) is unaffected
  });

  it("is a no-op when MCP_GATEWAY_RATE_LIMIT_ENABLED=false", () => {
    process.env.MCP_GATEWAY_RATE_LIMIT_ENABLED = "false";
    process.env.MCP_GATEWAY_RATE_LIMIT_MAX = "1";
    const mw = createRateLimitMiddleware();
    mw(makeReq("/endpoints/mcp"), makeRes(), vi.fn());
    const next = vi.fn();
    mw(makeReq("/endpoints/mcp"), makeRes(), next);
    expect(next).toHaveBeenCalledOnce(); // not blocked despite max=1
  });
});
