/**
 * bconnect-mcp-gateway — Express app integration tests
 *
 * Tests createApp() end-to-end via real HTTP requests against a server
 * started on a random port. Uses Node 22 native fetch.
 *
 * The gateway has no built-in auth (ADR-0003) — authentication is the fronting
 * proxy's job — so requests carry no Authorization header and every request
 * routes straight through. What is tested here:
 *   - GET /health — status, shape
 *   - POST /:domain/mcp — 404 for unknown domain, valid MCP JSON-RPC response
 *   - GET /:domain/mcp  — 405 Method Not Allowed
 *   - DELETE /:domain/mcp — 405 Method Not Allowed
 *   - Domain routing resolves to the correct MCP server (serverInfo.name)
 *
 * The MCP server factories are NOT mocked — createServer() is safe to call
 * in tests because the startup connectivity check only runs inside main(),
 * which is guarded by `if (!process.env.VITEST)`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { createApp, domains } from "../app.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Start app on a random OS-assigned port, return base URL + cleanup fn. */
async function startApp(): Promise<{ baseUrl: string; close: () => void }> {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () => server.close(),
  };
}

/** Minimal valid MCP initialize request body. */
const MCP_INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
  },
};

/**
 * MCP-compliant headers for POST requests.
 * The SDK requires Accept to include both application/json and text/event-stream.
 */
const MCP_HEADERS = {
  "Content-Type": "application/json",
  "Accept": "application/json, text/event-stream",
};

/**
 * Parse the first JSON object out of an SSE response body.
 * SSE lines look like:
 *   event: message
 *   data: {"jsonrpc":"2.0",...}
 */
async function parseMcpResponse(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  // SSE — extract first data: line
  const text = await res.text();
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) {
      return JSON.parse(line.slice(6));
    }
  }
  throw new Error(`No data line found in SSE response:\n${text}`);
}

// ─── /health ─────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  let baseUrl: string;
  let close: () => void;

  beforeAll(async () => {
    ({ baseUrl, close } = await startApp());
  });
  afterAll(() => close());

  it("returns 200", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
  });

  it("returns status: ok", async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("ok");
  });

  it("returns count: 13", async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json() as Record<string, unknown>;
    expect(body.count).toBe(13);
  });

  it("lists all 13 domain names", async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json() as { servers: string[] };
    expect(body.servers).toHaveLength(13);
    expect(body.servers).toContain("endpoints");
    expect(body.servers).toContain("compliance");
    expect(body.servers).toContain("variables");
  });
});

// ─── POST /:domain/mcp — routing ─────────────────────────────────────────────

describe("POST /:domain/mcp — routing", () => {
  let baseUrl: string;
  let close: () => void;

  beforeAll(async () => {
    ({ baseUrl, close } = await startApp());
  });
  afterAll(() => close());

  it("returns 404 for an unknown domain", async () => {
    const res = await fetch(`${baseUrl}/nonexistent/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(MCP_INITIALIZE),
    });
    expect(res.status).toBe(404);
  });

  it("404 body lists available domains", async () => {
    const res = await fetch(`${baseUrl}/nonexistent/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(MCP_INITIALIZE),
    });
    const body = await res.json() as { available: string[] };
    expect(Array.isArray(body.available)).toBe(true);
    expect(body.available).toContain("endpoints");
  });

  it("returns a valid MCP JSON-RPC response for a known domain", async () => {
    const res = await fetch(`${baseUrl}/compliance/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(MCP_INITIALIZE),
    });
    // MCP SDK returns 200 with JSON-RPC response (may be SSE-wrapped)
    expect(res.status).toBe(200);
    const body = await parseMcpResponse(res) as Record<string, unknown>;
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    expect(body.result).toBeDefined();
  });

  it("all 13 domains respond to MCP initialize", async () => {
    for (const domain of domains) {
      const res = await fetch(`${baseUrl}/${domain}/mcp`, {
        method: "POST",
        headers: MCP_HEADERS,
        body: JSON.stringify({ ...MCP_INITIALIZE, id: domain }),
      });
      expect(res.status, `domain '${domain}' should return 200`).toBe(200);
      const body = await parseMcpResponse(res) as Record<string, unknown>;
      expect(body.jsonrpc, `domain '${domain}' should return jsonrpc 2.0`).toBe("2.0");
    }
  });
});

// ─── Method guards ────────────────────────────────────────────────────────────

describe("Method Not Allowed guards", () => {
  let baseUrl: string;
  let close: () => void;

  beforeAll(async () => {
    ({ baseUrl, close } = await startApp());
  });
  afterAll(() => close());

  it("GET /:domain/mcp returns 405", async () => {
    const res = await fetch(`${baseUrl}/endpoints/mcp`);
    expect(res.status).toBe(405);
  });

  it("DELETE /:domain/mcp returns 405", async () => {
    const res = await fetch(`${baseUrl}/endpoints/mcp`, { method: "DELETE" });
    expect(res.status).toBe(405);
  });

  it("GET /:domain/mcp body explains to use POST", async () => {
    const res = await fetch(`${baseUrl}/endpoints/mcp`);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/POST/i);
  });
});

// ─── Domain routing → serverInfo.name ─────────────────────────────────────────

describe("Domain routing resolves to the correct MCP server", () => {
  let baseUrl: string;
  let close: () => void;

  beforeAll(async () => {
    ({ baseUrl, close } = await startApp());
  });
  afterAll(() => close());

  it("endpoints domain → serverInfo.name bconnect-endpoints-mcp", async () => {
    const res = await fetch(`${baseUrl}/endpoints/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(MCP_INITIALIZE),
    });
    expect(res.status).toBe(200);
    const body = await parseMcpResponse(res) as { result?: { serverInfo?: { name?: string } } };
    expect(body.result?.serverInfo?.name).toBe("bconnect-endpoints-mcp");
  });

  it("compliance domain → serverInfo.name bconnect-compliance-mcp", async () => {
    const res = await fetch(`${baseUrl}/compliance/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(MCP_INITIALIZE),
    });
    expect(res.status).toBe(200);
    const body = await parseMcpResponse(res) as { result?: { serverInfo?: { name?: string } } };
    expect(body.result?.serverInfo?.name).toBe("bconnect-compliance-mcp");
  });
});
