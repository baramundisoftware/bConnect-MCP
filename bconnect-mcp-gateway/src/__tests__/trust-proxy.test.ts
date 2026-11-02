/**
 * bconnect-mcp-gateway — MCP_GATEWAY_TRUST_PROXY (#331).
 *
 * The setting is parsed strictly; with it, the rate limit and the access log
 * use the client address from X-Forwarded-For, and without it (the default)
 * they use the connection's address, as before. Real HTTP requests from
 * 127.0.0.1, with X-Forwarded-For set as a proxy would.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { createApp } from "../app.js";
import { trustProxySetting } from "../trust-proxy.js";

describe("trustProxySetting", () => {
  it.each([undefined, "", "  ", "false", "FALSE"])("%j is off", (value) => {
    expect(trustProxySetting(value)).toBe(false);
  });

  it.each([["1", 1], ["2", 2], ["10", 10], [" 3 ", 3]])("%j trusts that many hops", (value, hops) => {
    expect(trustProxySetting(value)).toBe(hops);
  });

  it.each([
    ["10.0.0.5", ["10.0.0.5"]],
    ["10.0.0.0/8", ["10.0.0.0/8"]],
    ["fd00::1", ["fd00::1"]],
    ["fd00::/8", ["fd00::/8"]],
    ["10.0.0.5, 192.168.0.0/16,::1", ["10.0.0.5", "192.168.0.0/16", "::1"]],
  ])("%j trusts these addresses and ranges", (value, list) => {
    expect(trustProxySetting(value)).toEqual(list);
  });

  it.each([
    "true", "yes", "0", "11", "-1", "1.5", "loopback", "10.0.0", "10.0.0.256", "10.0.0.0/33", "fd00::/129",
    "10.0.0.0/", "10.0.0.0/8/8", "10.0.0.5,", ",10.0.0.5", "10.0.0.5;10.0.0.6", "proxy.example.com",
  ])("refuses %j with the variable and what it accepts", (value) => {
    expect(() => trustProxySetting(value)).toThrow(
      `MCP_GATEWAY_TRUST_PROXY=${JSON.stringify(value)} isn't valid. Use false, a number of proxy hops from 1 to 10, ` +
        "or the proxy's addresses or ranges, comma-separated (for example 10.0.0.5 or 10.0.0.0/8).",
    );
  });
});

describe("the client address the gateway uses", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  /** Sends one request per X-Forwarded-For value, in order; returns the statuses and the logged callers. */
  async function send(trustProxy: string | undefined, forwardedFor: string[]): Promise<{ statuses: number[]; callers: unknown[] }> {
    vi.stubEnv("MCP_GATEWAY_TRUST_PROXY", trustProxy);
    vi.stubEnv("MCP_GATEWAY_RATE_LIMIT_MAX", "1");
    vi.stubEnv("LOG_FORMAT", "json");
    vi.stubEnv("LOG_LEVEL", "info");
    const lines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => { lines.push(String(chunk)); return true; }) as never);
    const server = http.createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    const statuses: number[] = [];
    try {
      for (const value of forwardedFor) {
        const res = await fetch(`http://127.0.0.1:${port}/nothing-here`, { headers: { "X-Forwarded-For": value } });
        statuses.push(res.status);
      }
    } finally {
      await new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
    }
    const callers = lines.filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as { msg: string; caller?: unknown })
      .filter((entry) => entry.msg === "request").map((entry) => entry.caller);
    return { statuses, callers };
  }

  it("off (default): X-Forwarded-For is ignored, every caller shares the connection's bucket", async () => {
    const { statuses, callers } = await send(undefined, ["203.0.113.1", "203.0.113.2"]);
    expect(statuses).toEqual([404, 429]);
    expect(callers).toEqual(["127.0.0.1", "127.0.0.1"]);
  });

  it("a hop count: each client the proxy reports has its own bucket and shows in the log", async () => {
    const { statuses, callers } = await send("1", ["203.0.113.1", "203.0.113.2", "203.0.113.1"]);
    expect(statuses).toEqual([404, 404, 429]);
    expect(callers).toEqual(["203.0.113.1", "203.0.113.2", "203.0.113.1"]);
  });

  it("an address: the proxy at that address is trusted", async () => {
    const { statuses, callers } = await send("127.0.0.1", ["203.0.113.1", "203.0.113.2"]);
    expect(statuses).toEqual([404, 404]);
    expect(callers).toEqual(["203.0.113.1", "203.0.113.2"]);
  });

  it("a range: a proxy inside it is trusted", async () => {
    const { callers } = await send("127.0.0.0/8", ["203.0.113.1"]);
    expect(callers).toEqual(["203.0.113.1"]);
  });

  it("a request from an address that isn't the named proxy: its X-Forwarded-For is ignored", async () => {
    const { statuses, callers } = await send("10.0.0.0/8", ["203.0.113.1", "203.0.113.2"]);
    expect(statuses).toEqual([404, 429]);
    expect(callers).toEqual(["127.0.0.1", "127.0.0.1"]);
  });
});
