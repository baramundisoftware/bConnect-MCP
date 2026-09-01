/**
 * bconnect-mcp-gateway — per-IP rate limiting (security audit H2).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { Request, Response } from "express";

import { createRateLimitMiddleware } from "../rate-limit.js";

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
  delete process.env.MCP_GATEWAY_RATE_LIMIT_MAX_KEYS;
  delete process.env.MCP_GATEWAY_HEALTH_RATE_LIMIT_MAX;
  vi.useRealTimers();
});

describe("createRateLimitMiddleware", () => {
  it("allows requests under the limit", () => {
    process.env.MCP_GATEWAY_RATE_LIMIT_MAX = "5";
    const mw = createRateLimitMiddleware();
    const next = vi.fn();
    mw(makeReq("/endpoints/mcp"), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  // SEC-4 — /health used to be exempt outright, by path. Three unauthenticated
  // probes were answered while every other path on the same connection was
  // already 429: an unmetered oracle. It is metered now, in a bucket of its own
  // so an exhausted MCP budget cannot starve an orchestrator's probe into
  // restarting a healthy container.
  it("keeps answering GET /health after the MCP budget is spent", () => {
    process.env.MCP_GATEWAY_RATE_LIMIT_MAX = "1";
    const mw = createRateLimitMiddleware();
    mw(makeReq("/endpoints/mcp"), makeRes(), vi.fn()); // consume the 1
    const next = vi.fn();
    mw(makeReq("/health", "127.0.0.1", "GET"), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("meters GET /health rather than exempting it", () => {
    process.env.MCP_GATEWAY_HEALTH_RATE_LIMIT_MAX = "2";
    const mw = createRateLimitMiddleware();
    const first = makeRes();
    mw(makeReq("/health", "127.0.0.1", "GET"), first, vi.fn());
    expect(first._headers["X-RateLimit-Limit"]).toBe("2");
    expect(first._headers["X-RateLimit-Remaining"]).toBe("1");

    mw(makeReq("/health", "127.0.0.1", "GET"), makeRes(), vi.fn());
    const third = makeRes();
    const next = vi.fn();
    mw(makeReq("/health", "127.0.0.1", "GET"), third, next);
    expect(next).not.toHaveBeenCalled();
    expect(third._status).toBe(429);
  });

  it("spends /health's budget without touching the MCP budget", () => {
    process.env.MCP_GATEWAY_RATE_LIMIT_MAX = "1";
    process.env.MCP_GATEWAY_HEALTH_RATE_LIMIT_MAX = "5";
    const mw = createRateLimitMiddleware();
    for (let i = 0; i < 5; i++) {
      mw(makeReq("/health", "127.0.0.1", "GET"), makeRes(), vi.fn());
    }
    const res = makeRes();
    const next = vi.fn();
    mw(makeReq("/endpoints/mcp"), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res._headers["X-RateLimit-Limit"]).toBe("1");
  });

  it("does not treat POST /health as a probe", () => {
    // Matching by path alone meant a body could be posted at /health unmetered.
    process.env.MCP_GATEWAY_RATE_LIMIT_MAX = "1";
    const mw = createRateLimitMiddleware();
    mw(makeReq("/endpoints/mcp"), makeRes(), vi.fn()); // consume the 1
    const res = makeRes();
    const next = vi.fn();
    mw(makeReq("/health"), res, next);
    expect(next).not.toHaveBeenCalled();
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

  // SEC-8 — the bucket map used to grow without bound, so a caller with a
  // rotating source address could exhaust the container's memory.
  it("bounds the bucket map, evicting the least recently used key", () => {
    process.env.MCP_GATEWAY_RATE_LIMIT_MAX = "1";
    process.env.MCP_GATEWAY_RATE_LIMIT_MAX_KEYS = "2";
    const mw = createRateLimitMiddleware();

    mw(makeReq("/endpoints/mcp", "10.0.0.1"), makeRes(), vi.fn()); // A consumes its 1
    const blocked = makeRes();
    mw(makeReq("/endpoints/mcp", "10.0.0.1"), blocked, vi.fn());
    expect(blocked._status).toBe(429); // A is tracked and blocked

    // Two further keys fill the cap and push A out as the least recently used.
    mw(makeReq("/endpoints/mcp", "10.0.0.2"), makeRes(), vi.fn());
    mw(makeReq("/endpoints/mcp", "10.0.0.3"), makeRes(), vi.fn());

    const afterEviction = vi.fn();
    mw(makeReq("/endpoints/mcp", "10.0.0.1"), makeRes(), afterEviction);
    expect(afterEviction).toHaveBeenCalledOnce(); // A got a fresh bucket => evicted
  });

  it("keeps an active caller's bucket alive across other keys (LRU, not FIFO)", () => {
    process.env.MCP_GATEWAY_RATE_LIMIT_MAX = "2";
    process.env.MCP_GATEWAY_RATE_LIMIT_MAX_KEYS = "2";
    const mw = createRateLimitMiddleware();

    mw(makeReq("/endpoints/mcp", "10.0.0.1"), makeRes(), vi.fn()); // A: 1 of 2
    mw(makeReq("/endpoints/mcp", "10.0.0.2"), makeRes(), vi.fn()); // B
    mw(makeReq("/endpoints/mcp", "10.0.0.1"), makeRes(), vi.fn()); // A: 2 of 2, now MRU
    mw(makeReq("/endpoints/mcp", "10.0.0.3"), makeRes(), vi.fn()); // evicts B, not A

    const res = makeRes();
    mw(makeReq("/endpoints/mcp", "10.0.0.1"), res, vi.fn());
    expect(res._status).toBe(429); // A's consumption survived the eviction
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
