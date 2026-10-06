/**
 * bconnect-mcp-gateway — per-domain clients and the handler's error paths
 *
 * app.test.ts covers routing and a factory that throws an Error. This file
 * pins that each domain keeps its own client (and so its own rate limit), and
 * the remaining failure paths of a request: something thrown that is not an
 * Error, a failure after the answer has started, and a cleanup that fails.
 * Each one fails only that request.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { createApp, serverFactories } from "../app.js";

const MCP_HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

async function startApp(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

const call = (baseUrl: string, domain: string, tool: string, id = 1) =>
  fetch(`${baseUrl}/${domain}/mcp`, {
    method: "POST",
    headers: MCP_HEADERS,
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: tool, arguments: {} } }),
    signal: AbortSignal.timeout(5000),
  });

/** "ok", "refused" (rate limit) or the error text of a tool call's answer. */
async function outcome(res: Response): Promise<string> {
  const text = await res.text();
  const data = text.split("\n").find((line) => line.startsWith("data: "));
  const body = JSON.parse(data ? data.slice(6) : text) as { result?: { isError?: boolean; content?: Array<{ text: string }> } };
  const message = body.result?.content?.[0]?.text ?? text;
  if (!body.result?.isError) {return "ok";}
  return /rate limit/i.test(message) ? "refused" : message;
}

describe("each domain has its own client and rate limit", () => {
  let gateway: { baseUrl: string; close: () => Promise<void> };
  let bms: http.Server;
  const sent: string[] = [];

  beforeAll(async () => {
    bms = http.createServer((req, res) => {
      sent.push(new URL(req.url ?? "/", "http://bms").pathname.split("/")[2] ?? "");
      res.setHeader("content-type", "application/json");
      res.end("[]");
    });
    await new Promise<void>((resolve) => bms.listen(0, "127.0.0.1", resolve));
    const { port } = bms.address() as { port: number };
    vi.stubEnv("BCONNECT_BASE_URL", `http://127.0.0.1:${port}/bconnect`);
    vi.stubEnv("BCONNECT_API_KEY", "gateway-test-key");
    vi.stubEnv("BCONNECT_RELEASE", "26R1");
    vi.stubEnv("BCONNECT_RATE_LIMIT_ENABLED", "true");
    vi.stubEnv("BCONNECT_RATE_LIMIT_MAX_REQUESTS", "1");
    vi.stubEnv("BCONNECT_RATE_LIMIT_WINDOW_MS", "600000");
    vi.stubEnv("LOG_LEVEL", "error");
    gateway = await startApp();
  });
  afterAll(async () => {
    await gateway.close();
    bms.closeAllConnections();
    await new Promise<void>((resolve) => bms.close(() => resolve()));
    vi.unstubAllEnvs();
  });

  it("a domain that used up its limit does not use up another domain's", async () => {
    const outcomes = [
      await outcome(await call(gateway.baseUrl, "compliance", "list_vulnerabilities", 1)),
      await outcome(await call(gateway.baseUrl, "compliance", "list_vulnerabilities", 2)),
      await outcome(await call(gateway.baseUrl, "activedirectory", "list_ad_users", 3)),
      await outcome(await call(gateway.baseUrl, "activedirectory", "list_ad_users", 4)),
    ];
    expect(outcomes).toEqual(["ok", "refused", "ok", "refused"]);
    expect(sent).toEqual(["compliance", "activedirectory"]);
  });
});

describe("a request that fails fails only itself", () => {
  let gateway: { baseUrl: string; close: () => Promise<void> };
  let logged: string[];

  beforeAll(async () => {
    vi.stubEnv("LOG_FORMAT", "json");
    gateway = await startApp();
  });
  afterAll(async () => {
    await gateway.close();
    vi.unstubAllEnvs();
  });
  afterEach(() => vi.restoreAllMocks());

  const captureLog = () => {
    logged = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => { logged.push(chunk); return true; }) as never);
  };
  const errors = () => logged.filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as Record<string, string>).filter((l) => l.level === "error");
  const initialize = () => fetch(`${gateway.baseUrl}/variables/mcp`, {
    method: "POST",
    headers: MCP_HEADERS,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
    signal: AbortSignal.timeout(5000),
  });

  it("something thrown that is not an Error: 500, JSON-RPC error, logged as text", async () => {
    captureLog();
    vi.spyOn(serverFactories as { variables: () => unknown }, "variables").mockImplementation(() => {
      throw "plain string failure";
    });
    const res = await initialize();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    expect(errors()).toEqual([expect.objectContaining({ msg: "MCP request failed", domain: "variables", error: "plain string failure" })]);
  });

  it("a failure after the answer started: no second answer, cleanup failures swallowed", async () => {
    captureLog();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    // A plain function: a vi.fn() would observe the rejected promise and so handle it.
    let closed = 0;
    const close = async () => { closed++; throw new Error("close failed"); };
    vi.spyOn(serverFactories as { variables: () => unknown }, "variables").mockImplementation(() => ({
      server: {
        // Replace the transport's request handling: answer, then fail.
        connect: async (transport: { handleRequest: unknown; close: () => Promise<void> }) => {
          transport.handleRequest = async (_req: unknown, res: http.ServerResponse) => {
            res.writeHead(200, { "content-type": "text/plain" });
            res.end("started");
            throw new Error("failed mid-answer");
          };
          transport.close = async () => { throw new Error("transport close failed"); };
        },
        close,
      },
    }));
    try {
      const res = await initialize();
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("started");
      await vi.waitFor(() => expect(closed).toBeGreaterThan(0));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
      expect(errors()).toEqual([expect.objectContaining({ domain: "variables", error: "failed mid-answer" })]);
    } finally {
      process.off("unhandledRejection", unhandled);
    }

    const health = await fetch(`${gateway.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
    expect(health.status).toBe(200);
  });
});
