/**
 * bconnect-mcp-gateway — per-domain MCP server pool (PER-15 / OPT-34).
 *
 * The point of the pool is that the bConnect client, its keep-alive agent, its
 * response cache and its rate-limit window survive across HTTP requests instead
 * of being rebuilt per request. These tests pin the two properties that make
 * that safe: a server is never handed out twice at once, and one that is still
 * holding a transport is never pooled.
 */

import { describe, it, expect, afterEach } from "vitest";

import { createServerPool, type PoolableServer } from "../server-pool.js";

function fakeServer(): PoolableServer & { transport: unknown; closed: boolean } {
  return {
    transport: undefined,
    closed: false,
    async connect() { /* no-op */ },
    async close() { this.closed = true; },
  };
}

afterEach(() => {
  delete process.env.MCP_GATEWAY_SERVER_POOL_MAX;
});

describe("createServerPool", () => {
  it("builds a server when the pool is empty", () => {
    const pool = createServerPool();
    const built = fakeServer();
    expect(pool.acquire("endpoints", () => built)).toBe(built);
  });

  it("reuses a released server for the same domain", () => {
    const pool = createServerPool();
    const first = fakeServer();
    const a = pool.acquire("endpoints", () => first);
    pool.release("endpoints", a);
    let builtAgain = false;
    const b = pool.acquire("endpoints", () => { builtAgain = true; return fakeServer(); });
    expect(b).toBe(first);
    expect(builtAgain).toBe(false);
  });

  it("does not hand the same server to two concurrent requests", () => {
    const pool = createServerPool();
    const first = fakeServer();
    const a = pool.acquire("endpoints", () => first);
    const b = pool.acquire("endpoints", () => fakeServer()); // a is still checked out
    expect(b).not.toBe(a);
  });

  it("keeps pools separate per domain", () => {
    const pool = createServerPool();
    const endpointsServer = fakeServer();
    pool.release("endpoints", endpointsServer);
    const jobsServer = fakeServer();
    expect(pool.acquire("jobs", () => jobsServer)).toBe(jobsServer);
    expect(pool.acquire("endpoints", () => fakeServer())).toBe(endpointsServer);
  });

  it("closes rather than pools a server that still holds a transport", () => {
    // Reusing one would make the next connect() throw 'Already connected'.
    const pool = createServerPool();
    const stuck = fakeServer();
    stuck.transport = { still: "attached" };
    pool.release("endpoints", stuck);
    expect(pool.stats().endpoints ?? 0).toBe(0);
    expect(stuck.closed).toBe(true);
  });

  it("bounds the idle set per domain", () => {
    process.env.MCP_GATEWAY_SERVER_POOL_MAX = "2";
    const pool = createServerPool();
    const overflow = [fakeServer(), fakeServer(), fakeServer()];
    for (const s of overflow) { pool.release("endpoints", s); }
    expect(pool.stats().endpoints).toBe(2);
    expect(overflow[2].closed).toBe(true);
  });

  it("MCP_GATEWAY_SERVER_POOL_MAX=0 restores build-and-discard", () => {
    process.env.MCP_GATEWAY_SERVER_POOL_MAX = "0";
    const pool = createServerPool();
    const s = fakeServer();
    pool.release("endpoints", s);
    expect(pool.stats().endpoints ?? 0).toBe(0);
    expect(s.closed).toBe(true);
  });
});
