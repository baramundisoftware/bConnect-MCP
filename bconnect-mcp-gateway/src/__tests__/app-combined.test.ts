/**
 * bconnect-mcp-gateway — the combined endpoint POST /mcp (#131)
 *
 * Over real HTTP, with the SDK's Streamable HTTP client (as LiteLLM and other
 * MCP clients connect). Off by default; with MCP_GATEWAY_COMBINED it lists the
 * tools of the chosen domains exactly as their own endpoints list them, answers
 * a call as the domain's endpoint does, and keeps the gateway's protections.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { combinedParts, createApp, domains } from "../app.js";
import { closeGates } from "../gates.js";

const VULNERABILITY = "99999999-9999-4999-8999-999999999999";

/** A stand-in bMS: answers every request with one vulnerability, and counts them. */
let bms: http.Server;
let bmsRequests: string[] = [];

beforeAll(async () => {
  bms = http.createServer((req, res) => {
    bmsRequests.push(`${req.method} ${req.url}`);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: VULNERABILITY, name: "CVE-1" }));
  });
  await new Promise<void>((resolve) => bms.listen(0, "127.0.0.1", resolve));
  const { port } = bms.address() as { port: number };
  vi.stubEnv("BCONNECT_BASE_URL", `http://127.0.0.1:${port}/bconnect`);
  vi.stubEnv("BCONNECT_API_KEY", "gateway-test-key");
  vi.stubEnv("BCONNECT_RELEASE", "26R1");
  vi.stubEnv("MCP_GATEWAY_RATE_LIMIT_ENABLED", "false");
  // As gateway.ts does before anything else: a .env or the environment saying true
  // must not open the gates on the combined endpoint either.
  vi.stubEnv("ALLOW_WRITE_OPERATIONS", "true");
  vi.stubEnv("ALLOW_SECRET_READ", "true");
  closeGates();
});
afterAll(async () => {
  bms.closeAllConnections();
  await new Promise<void>((resolve) => bms.close(() => resolve()));
  vi.unstubAllEnvs();
});
afterEach(() => { bmsRequests = []; });

/** createApp() with MCP_GATEWAY_COMBINED as given, on a random port. */
async function startApp(combined: string | undefined, env: Record<string, string> = {}) {
  vi.stubEnv("MCP_GATEWAY_COMBINED", combined);
  for (const [name, value] of Object.entries(env)) {vi.stubEnv(name, value);}
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const clients: Client[] = [];
afterEach(async () => { await Promise.all(clients.splice(0).map((c) => c.close())); });

async function connect(url: string): Promise<Client> {
  const client = new Client({ name: "combined-test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  clients.push(client);
  return client;
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) => fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
  body: JSON.stringify(body),
});

describe("POST /mcp off by default", () => {
  it.each([undefined, "", "  "])("MCP_GATEWAY_COMBINED=%j: /mcp is not served (404), the domain endpoints are", async (value) => {
    const gateway = await startApp(value);
    try {
      const res = await post(`${gateway.baseUrl}/mcp`, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
      expect((await (await connect(`${gateway.baseUrl}/groups/mcp`)).listTools()).tools.length).toBeGreaterThan(0);
    } finally {
      await gateway.close();
    }
  });
});

describe("POST /mcp with MCP_GATEWAY_COMBINED=all", () => {
  let gateway: Awaited<ReturnType<typeof startApp>>;
  beforeAll(async () => { gateway = await startApp("all"); });
  afterAll(async () => { await gateway.close(); });

  it("reports the gateway as the server", async () => {
    const client = await connect(`${gateway.baseUrl}/mcp`);
    expect(client.getServerVersion()?.name).toBe("bconnect-mcp-gateway");
  });

  it("lists the tools of every domain endpoint, in domain order, and nothing else", async () => {
    const expected = [];
    for (const domain of domains) {
      expected.push(...(await (await connect(`${gateway.baseUrl}/${domain}/mcp`)).listTools()).tools);
    }
    const tools = (await (await connect(`${gateway.baseUrl}/mcp`)).listTools()).tools;
    expect(tools).toEqual(expected);
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
  });

  it("lists no write tool and no secret read: the gates stay closed", async () => {
    const names = (await (await connect(`${gateway.baseUrl}/mcp`)).listTools()).tools.map((t) => t.name);
    expect(names).toContain("list_assets");
    expect(names).not.toContain("delete_asset");
    expect(names).not.toContain("create_job_instance");
  });

  it("answers a call as the domain's own endpoint does", async () => {
    const call = { name: "get_vulnerability", arguments: { vulnerabilityId: VULNERABILITY } };
    const own = await (await connect(`${gateway.baseUrl}/compliance/mcp`)).callTool(call) as CallToolResult;
    const combined = await (await connect(`${gateway.baseUrl}/mcp`)).callTool(call) as CallToolResult;
    expect(own.isError).not.toBe(true);
    expect(combined).toEqual(own);
    expect(bmsRequests).toEqual([
      `GET /bconnect/compliance/v2.0/Vulnerabilities/${VULNERABILITY}`,
      `GET /bconnect/compliance/v2.0/Vulnerabilities/${VULNERABILITY}`,
    ]);
  });

  it("refuses a write tool as the domain's own endpoint does, and sends nothing to bMS", async () => {
    const call = { name: "delete_asset", arguments: { id: VULNERABILITY } };
    const own = await (await connect(`${gateway.baseUrl}/assets/mcp`)).callTool(call);
    expect(JSON.stringify(own)).toContain("is disabled");
    expect(await (await connect(`${gateway.baseUrl}/mcp`)).callTool(call)).toEqual(own);
    expect(bmsRequests).toEqual([]);
  });

  it("an unknown tool is a JSON-RPC error, as on a domain endpoint", async () => {
    const body = { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "no_such_tool", arguments: {} } };
    const answer = async (path: string) => {
      const res = await post(`${gateway.baseUrl}${path}`, body);
      const text = await res.text();
      const data = text.split("\n").find((line) => line.startsWith("data: "));
      return JSON.parse(data ? data.slice(6) : text) as unknown;
    };
    const own = await answer("/assets/mcp");
    expect(own).toEqual({ jsonrpc: "2.0", id: 7, error: { code: -32601, message: "Unknown tool: no_such_tool" } });
    expect(await answer("/mcp")).toEqual(own);
  });

  it.each([
    ["GET", "Method Not Allowed. Use POST for MCP requests."],
    ["DELETE", "Method Not Allowed. Session management not supported in stateless mode."],
  ])("%s /mcp answers 405", async (method, error) => {
    const res = await fetch(`${gateway.baseUrl}/mcp`, { method });
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error });
  });

  it("refuses a host name that isn't allowed (403), as for a domain endpoint", async () => {
    // node:http, not fetch: fetch doesn't let a caller set Host.
    const status = (path: string) => new Promise<number | undefined>((resolve, reject) => {
      const req = http.request(`${gateway.baseUrl}${path}`, {
        method: "POST",
        headers: { Host: "evil.example", "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on("error", reject);
      req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    });
    expect(await status("/assets/mcp")).toBe(403);
    expect(await status("/mcp")).toBe(403);
  });
});

describe("POST /mcp with a list of domains", () => {
  it("lists only the chosen domains; a tool of another domain is unknown", async () => {
    const gateway = await startApp("groups, Compliance");
    try {
      const expected = [
        ...(await (await connect(`${gateway.baseUrl}/compliance/mcp`)).listTools()).tools,
        ...(await (await connect(`${gateway.baseUrl}/groups/mcp`)).listTools()).tools,
      ];
      const client = await connect(`${gateway.baseUrl}/mcp`);
      expect((await client.listTools()).tools).toEqual(expected);
      await expect(client.callTool({ name: "list_assets", arguments: {} })).rejects.toThrow("Unknown tool: list_assets");
    } finally {
      await gateway.close();
    }
  });
});

describe("POST /mcp keeps the gateway's limits", () => {
  it("the rate limit counts /mcp like a domain endpoint (429)", async () => {
    const gateway = await startApp("all", { MCP_GATEWAY_RATE_LIMIT_ENABLED: "true", MCP_GATEWAY_RATE_LIMIT_MAX: "1" });
    try {
      const body = { jsonrpc: "2.0", id: 1, method: "tools/list" };
      expect((await post(`${gateway.baseUrl}/mcp`, body)).status).toBe(200);
      expect((await post(`${gateway.baseUrl}/mcp`, body)).status).toBe(429);
    } finally {
      await gateway.close();
      vi.stubEnv("MCP_GATEWAY_RATE_LIMIT_ENABLED", "false");
    }
  });

  it("a body over MCP_GATEWAY_MAX_BODY gets 413", async () => {
    const gateway = await startApp("all", { MCP_GATEWAY_MAX_BODY: "1kb" });
    try {
      const res = await post(`${gateway.baseUrl}/mcp`, { jsonrpc: "2.0", id: 1, method: "tools/list", params: { pad: "x".repeat(2048) } });
      expect(res.status).toBe(413);
    } finally {
      await gateway.close();
      vi.stubEnv("MCP_GATEWAY_MAX_BODY", undefined);
    }
  });
});

describe("createApp with an invalid MCP_GATEWAY_COMBINED", () => {
  it("throws, so the gateway can't start with the endpoint half set up", () => {
    vi.stubEnv("MCP_GATEWAY_COMBINED", "assets,nope");
    expect(() => createApp()).toThrow(/MCP_GATEWAY_COMBINED="assets,nope" isn't valid/);
  });
});

describe("combinedParts", () => {
  it("builds a fresh server per chosen domain, and refuses a name that isn't a domain", () => {
    expect(combinedParts(["groups", "assets"]).map((p) => p.domain)).toEqual(["groups", "assets"]);
    expect(() => combinedParts(["constructor"])).toThrow("Unknown MCP domain 'constructor'");
  });
});
