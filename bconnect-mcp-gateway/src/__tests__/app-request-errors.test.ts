/**
 * bconnect-mcp-gateway — request errors are JSON, never an HTML page (REQ-GW-004, #319)
 *
 * A body the gateway can't read (malformed JSON, over MCP_GATEWAY_MAX_BODY,
 * an unsupported charset) gets a JSON-RPC error with the error's status; a
 * path no route matches gets a JSON 404. The gateway keeps serving afterwards.
 * The answers that were JSON already (unknown domain, 405, 429, host check,
 * handler failure) are covered in app.test.ts, app-errors.test.ts and
 * rate-limit.test.ts.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { createApp } from "../app.js";

async function startApp(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

const MCP_HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
const PARSE_ERROR = { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null };
const INTERNAL_ERROR = { jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null };

describe("request errors", () => {
  let gateway: { baseUrl: string; close: () => Promise<void> };

  beforeAll(async () => {
    vi.stubEnv("MCP_GATEWAY_MAX_BODY", "1kb");
    vi.stubEnv("LOG_LEVEL", "error");
    gateway = await startApp();
  });
  afterAll(async () => {
    await gateway.close();
    vi.unstubAllEnvs();
  });

  /** Status, content type and parsed body of an answer; the body is JSON or the test fails. */
  async function answer(res: Response): Promise<{ status: number; type: string; body: unknown }> {
    const type = res.headers.get("content-type") ?? "";
    const text = await res.text();
    expect(type, text).toContain("application/json");
    return { status: res.status, type, body: JSON.parse(text) };
  }

  const post = (path: string, body: string, headers: Record<string, string> = MCP_HEADERS) =>
    fetch(`${gateway.baseUrl}${path}`, { method: "POST", headers, body, signal: AbortSignal.timeout(5000) });

  it("malformed JSON to /<domain>/mcp → 400, JSON-RPC parse error", async () => {
    expect(await answer(await post("/endpoints/mcp", "{bad"))).toMatchObject({ status: 400, body: PARSE_ERROR });
  });

  it("a body over MCP_GATEWAY_MAX_BODY → 413, JSON-RPC internal error", async () => {
    const big = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { pad: "x".repeat(4096) } });
    expect(await answer(await post("/endpoints/mcp", big))).toMatchObject({ status: 413, body: INTERNAL_ERROR });
  });

  it("an unsupported charset → 415, JSON-RPC internal error", async () => {
    const res = await post("/endpoints/mcp", "{}", { ...MCP_HEADERS, "Content-Type": "application/json; charset=koi8-r" });
    expect(await answer(res)).toMatchObject({ status: 415, body: INTERNAL_ERROR });
  });

  it("malformed JSON to any other path is JSON as well", async () => {
    expect(await answer(await post("/health", "{bad"))).toMatchObject({ status: 400, body: PARSE_ERROR });
  });

  it("no error answer names the parser's message", async () => {
    const text = await (await post("/endpoints/mcp", "{bad")).text();
    expect(text).not.toContain("Unexpected");
    expect(text).not.toContain("node_modules");
  });

  it.each([
    ["POST", "/"],
    ["GET", "/"],
    ["GET", "/nothing-here"],
    ["POST", "/endpoints"],
    ["PUT", "/endpoints/mcp"],
    ["GET", "/endpoints/mcp/extra"],
  ])("%s %s (no route) → JSON 404", async (method, path) => {
    const res = await fetch(`${gateway.baseUrl}${path}`, { method, signal: AbortSignal.timeout(5000) });
    expect(await answer(res)).toEqual({ status: 404, type: expect.stringContaining("application/json"), body: { error: "Not found" } });
  });

  it("keeps serving after each error", async () => {
    await post("/endpoints/mcp", "{bad");
    await post("/endpoints/mcp", "x".repeat(4096));
    const res = await fetch(`${gateway.baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
    expect(await answer(res)).toMatchObject({ status: 200, body: { status: "ok" } });
  });
});
