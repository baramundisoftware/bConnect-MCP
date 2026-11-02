/**
 * bconnect-mcp-gateway — per-IP rate limiting (security audit H2).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { Request, Response } from "express";

import { ClientBuckets, MAX_TRACKED_CLIENTS, createRateLimitMiddleware } from "../rate-limit.js";

function makeReq(path: string, ip = "127.0.0.1", method = "POST"): Request {
  return { path, ip, method, headers: {} } as unknown as Request;
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

  it("counts GET /health in a bucket of its own (#330)", () => {
    process.env.MCP_GATEWAY_RATE_LIMIT_MAX = "1";
    const mw = createRateLimitMiddleware();
    mw(makeReq("/endpoints/mcp"), makeRes(), vi.fn()); // consume the MCP request
    const next = vi.fn();
    mw(makeReq("/health", "127.0.0.1", "GET"), makeRes(), next);
    expect(next).toHaveBeenCalledOnce(); // MCP traffic doesn't use up the health limit
    const res = makeRes();
    mw(makeReq("/health", "127.0.0.1", "HEAD"), res, vi.fn());
    expect(res._status).toBe(429); // the health bucket has a limit of its own
  });

  it("counts health checks apart from MCP requests both ways", () => {
    process.env.MCP_GATEWAY_RATE_LIMIT_MAX = "1";
    const mw = createRateLimitMiddleware();
    mw(makeReq("/health", "127.0.0.1", "GET"), makeRes(), vi.fn());
    const next = vi.fn();
    mw(makeReq("/endpoints/mcp"), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("counts any other method on /health as an ordinary request", () => {
    process.env.MCP_GATEWAY_RATE_LIMIT_MAX = "1";
    const mw = createRateLimitMiddleware();
    mw(makeReq("/health", "127.0.0.1", "POST"), makeRes(), vi.fn());
    const res = makeRes();
    mw(makeReq("/endpoints/mcp"), res, vi.fn());
    expect(res._status).toBe(429);
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

describe("ClientBuckets: bounded state (#330)", () => {
  afterEach(() => { vi.useRealTimers(); });

  it(`tracks at most ${MAX_TRACKED_CLIENTS} client addresses, however many call`, () => {
    const buckets = new ClientBuckets(300, 60_000);
    for (let i = 0; i < 3 * MAX_TRACKED_CLIENTS; i++) {
      buckets.consume(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);
    }
    expect(buckets.size).toBe(MAX_TRACKED_CLIENTS);
  });

  it("drops the least recently used address when full, and keeps an active one", () => {
    const buckets = new ClientBuckets(1, 60_000, 3);
    buckets.consume("a");
    buckets.consume("b");
    buckets.consume("c");
    expect(buckets.consume("a").allowed).toBe(false); // a is used again, so b is now the oldest
    buckets.consume("d"); // full: b goes
    expect(buckets.size).toBe(3);
    expect(buckets.consume("a").allowed).toBe(false); // a kept its exhausted bucket
    expect(buckets.consume("b").allowed).toBe(true); // b starts afresh
  });

  it("expires addresses idle for a whole window, when anyone calls next", () => {
    vi.useFakeTimers();
    const buckets = new ClientBuckets(1, 60_000);
    buckets.consume("a");
    buckets.consume("b");
    vi.advanceTimersByTime(30_000);
    buckets.consume("c");
    vi.advanceTimersByTime(30_000);
    buckets.consume("d"); // a and b idle for 60 s: gone; c stays
    expect(buckets.size).toBe(2);
    expect(buckets.consume("c").allowed).toBe(false);
  });
});
