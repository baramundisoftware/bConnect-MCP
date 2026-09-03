/**
 * bconnect-mcp-gateway — Express app integration tests
 *
 * Tests createApp() end-to-end via real HTTP requests against a server
 * started on a random port. Uses Node 22 native fetch.
 *
 * Most suites here run with MCP_GATEWAY_AUTH_TOKEN unset, which is the loopback
 * developer shape: no token configured, every request routes straight through.
 * The SEC-7 suite at the bottom sets one and proves both directions — no token
 * is refused, the right token works, end to end over real HTTP.
 *
 * What is tested here:
 *   - GET /health — status, shape
 *   - POST /:domain/mcp — 404 for unknown domain, valid MCP JSON-RPC response
 *   - GET /:domain/mcp  — 405 Method Not Allowed
 *   - DELETE /:domain/mcp — 405 Method Not Allowed
 *   - Domain routing resolves to the correct MCP server (serverInfo.name)
 *   - SEC-7 bearer-token auth, both ways
 *
 * The MCP server factories are NOT mocked — createServer() is safe to call
 * in tests because the startup connectivity check only runs inside main(),
 * which is guarded by `if (!process.env.VITEST)`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import http from "node:http";
import type express from "express";
import { createApp, domains } from "../app.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Start app on a random OS-assigned port, return base URL + cleanup fn. */
async function startApp(): Promise<{ baseUrl: string; app: express.Application; close: () => void }> {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    app,
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

  // SEC-10 — /health used to answer any caller with the full domain list and a
  // count. That is a map of the surface, and of the product, handed to an
  // unauthenticated scanner on the only component that listens on a socket. A
  // liveness probe needs "is it answering"; the list is behind the token now
  // (see the SEC-10 suite below).
  it("tells an unauthenticated caller nothing but that it is alive", async () => {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["status"]);
  });

  it("does not enumerate the mounted domains", async () => {
    const res = await fetch(`${baseUrl}/health`);
    const text = await res.text();
    for (const domain of domains) {
      expect(text, `/health must not name '${domain}'`).not.toContain(domain);
    }
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

  it("insights domain → serverInfo.name bconnect-insights-mcp", async () => {
    // The cross-module composite server. Worth its own case rather than
    // trusting the registry listing: appearing in `domains` proves the key
    // exists, not that the factory imports, constructs and answers — and this
    // is the one server whose dependency is a `file:` link the gateway did not
    // previously carry.
    const res = await fetch(`${baseUrl}/insights/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(MCP_INITIALIZE),
    });
    expect(res.status).toBe(200);
    const body = await parseMcpResponse(res) as { result?: { serverInfo?: { name?: string } } };
    expect(body.result?.serverInfo?.name).toBe("bconnect-insights-mcp");
  });

  it("every mounted domain answers initialize with its own server name", async () => {
    // The generalisation, so a fifteenth server cannot mount as a name that
    // routes to somebody else's factory — a copy-paste in the registry is
    // otherwise invisible until someone calls the wrong domain in production.
    for (const domain of domains) {
      const res = await fetch(`${baseUrl}/${domain}/mcp`, {
        method: "POST",
        headers: MCP_HEADERS,
        body: JSON.stringify(MCP_INITIALIZE),
      });
      expect(res.status, `${domain} did not answer initialize`).toBe(200);
      const body = await parseMcpResponse(res) as { result?: { serverInfo?: { name?: string } } };
      expect(body.result?.serverInfo?.name, `${domain} routed to the wrong server`).toBe(
        `bconnect-${domain}-mcp`,
      );
    }
  }, 60_000);
});

// ─── SEC-9 · DNS-rebinding / Origin protection ───────────────────────────────

describe("SEC-9 — Host and Origin protection", () => {
  let baseUrl: string;
  let close: () => void;

  beforeAll(async () => {
    ({ baseUrl, close } = await startApp());
  });
  afterAll(() => close());

  // fetch() refuses to set Host (a forbidden header name), so this one goes out
  // over raw http.request — which is also what an attacker's tooling would do.
  it("rejects a POST whose Host header names another site (DNS rebinding)", async () => {
    const { port } = new URL(baseUrl);
    const status = await new Promise<number>((resolve, reject) => {
      const request = http.request(
        {
          host: "127.0.0.1",
          port: Number(port),
          path: "/endpoints/mcp",
          method: "POST",
          headers: { ...MCP_HEADERS, Host: "attacker.example.com" },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.on("error", reject);
      request.end(JSON.stringify(MCP_INITIALIZE));
    });
    expect(status).toBe(403);
  });

  it("rejects a POST carrying a browser Origin", async () => {
    const res = await fetch(`${baseUrl}/endpoints/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, Origin: "https://evil.example" },
      body: JSON.stringify(MCP_INITIALIZE),
    });
    expect(res.status).toBe(403);
  });

  it("still answers a normal request with no Origin", async () => {
    const res = await fetch(`${baseUrl}/endpoints/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(MCP_INITIALIZE),
    });
    expect(res.status).toBe(200);
  });
});

// ─── SEC-7 · built-in bearer-token authentication ────────────────────────────
//
// The finding: the shipped compose set MCP_ALLOW_NO_AUTH=true and the Dockerfile
// set MCP_GATEWAY_BIND=0.0.0.0, so the artifact disarmed its own fail-closed
// guard and there was nothing left to test here. There is now.

describe("SEC-7 — bearer-token auth, end to end", () => {
  // Generated per run, not a literal: a token checked into a test file is a
  // token someone eventually pastes into a deployment.
  const TOKEN = randomBytes(32).toString("base64url");
  const OLD_TOKEN = randomBytes(32).toString("base64url");
  let baseUrl: string;
  let close: () => void;

  beforeAll(async () => {
    // Both tokens configured: the second one is the rotation window.
    process.env.MCP_GATEWAY_AUTH_TOKEN = `${TOKEN},${OLD_TOKEN}`;
    ({ baseUrl, close } = await startApp());
  });
  afterAll(() => {
    close();
    delete process.env.MCP_GATEWAY_AUTH_TOKEN;
  });

  it("refuses an MCP request with NO token — 401", async () => {
    const res = await fetch(`${baseUrl}/endpoints/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(MCP_INITIALIZE),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer /);
  });

  it("refuses a WRONG token — 401", async () => {
    const res = await fetch(`${baseUrl}/endpoints/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${randomBytes(32).toString("base64url")}` },
      body: JSON.stringify(MCP_INITIALIZE),
    });
    expect(res.status).toBe(401);
  });

  it("serves a real MCP session with the CORRECT token — 200", async () => {
    const res = await fetch(`${baseUrl}/endpoints/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(MCP_INITIALIZE),
    });
    expect(res.status).toBe(200);
    const body = await parseMcpResponse(res) as { result?: { serverInfo?: { name?: string } } };
    expect(body.result?.serverInfo?.name).toBe("bconnect-endpoints-mcp");
  });

  it("accepts the previous token during a rotation window", async () => {
    const res = await fetch(`${baseUrl}/compliance/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${OLD_TOKEN}` },
      body: JSON.stringify(MCP_INITIALIZE),
    });
    expect(res.status).toBe(200);
  });

  it("leaves /health reachable so container probes keep working", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect((await res.json() as { status: string }).status).toBe("ok");
  });

  it("serves the domain list on /health only to a caller carrying the token", async () => {
    const anonymous = await (await fetch(`${baseUrl}/health`)).json() as { servers?: string[] };
    expect(anonymous.servers).toBeUndefined();

    const authenticated = await (await fetch(`${baseUrl}/health`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })).json() as { servers?: string[]; count?: number };
    // The count is asserted against the registry rather than a literal: this
    // test is about WHO may read the domain list, not how many domains exist,
    // and a literal here failed the day a fourteenth server mounted — noise in
    // an auth test. `domains` is the same registry the endpoint serves, so a
    // domain that fails to mount still shows up as a mismatch.
    expect(authenticated.count).toBe(domains.length);
    expect(authenticated.servers).toContain("endpoints");
    expect(authenticated.servers).toContain("insights");
  });

  it("does not accept a wrong token as a way to read the domain list", async () => {
    const res = await fetch(`${baseUrl}/health`, {
      headers: { Authorization: `Bearer ${randomBytes(32).toString("base64url")}` },
    });
    // Still 200 — /health is a probe, not a guarded route — but it says nothing.
    expect(res.status).toBe(200);
    expect((await res.json() as { servers?: string[] }).servers).toBeUndefined();
  });

  it("does not leak the token in the refusal body", async () => {
    const res = await fetch(`${baseUrl}/endpoints/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(MCP_INITIALIZE),
    });
    expect(await res.text()).not.toContain(TOKEN);
  });

  it("refuses before routing — an unknown domain 401s rather than 404s", async () => {
    // Ordering matters: a 404 listing every domain would be a free map of the
    // surface for a caller that has not authenticated.
    const res = await fetch(`${baseUrl}/nonexistent/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(MCP_INITIALIZE),
    });
    expect(res.status).toBe(401);
  });
});

// ─── SEC-2 · a malformed body never returns a stack trace ────────────────────
//
// The finding: express.json() was mounted ahead of the auth middleware and no
// error handler was registered, so a caller with NO Authorization header could
// post '{ this is not json' and receive Express's default 400 — an HTML body
// carrying the SyntaxError, nine frames of node_modules internals and absolute
// filesystem paths including the gateway's own build directory. NODE_ENV=production
// suppresses that, so the Docker image was covered and the shipped Windows
// launcher, which never sets NODE_ENV, was not. These tests run with NODE_ENV=test
// (vitest.config.ts) — i.e. in the configuration that used to leak.

describe("SEC-2 — body-parser failures do not disclose internals", () => {
  let baseUrl: string;
  let close: () => void;

  beforeAll(async () => {
    ({ baseUrl, close } = await startApp());
  });
  afterAll(() => close());

  /** Everything a stack trace would put in a response body. */
  function expectNoInternals(text: string): void {
    expect(text).not.toMatch(/SyntaxError/);
    expect(text).not.toMatch(/node_modules/);
    expect(text).not.toMatch(/body-parser/);
    expect(text).not.toMatch(/\bat\s+\w+\s+\(/);      // a stack frame
    expect(text).not.toMatch(/[A-Za-z]:\\|\/home\/|\/Users\//); // an absolute path
  }

  it("answers malformed JSON with a JSON-RPC parse error, not a stack", async () => {
    const res = await fetch(`${baseUrl}/endpoints/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: "{ this is not json",
    });
    expect(res.status).toBe(400);
    const text = await res.text();
    expectNoInternals(text);
    expect(JSON.parse(text)).toMatchObject({ jsonrpc: "2.0", error: { code: -32700 } });
  });

  it("answers an oversized body the same way", async () => {
    const res = await fetch(`${baseUrl}/endpoints/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify({ padding: "x".repeat(2 * 1024 * 1024) }),
    });
    expect(res.status).toBe(413);
    const text = await res.text();
    expectNoInternals(text);
    expect(JSON.parse(text)).toMatchObject({ jsonrpc: "2.0", error: { code: -32600 } });
  });

  it("does not name the route or the domain back to the caller", async () => {
    const res = await fetch(`${baseUrl}/endpoints/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: "{",
    });
    expect(await res.text()).not.toContain("endpoints");
  });
});

describe("SEC-2 — an unauthenticated caller cannot reach the parser at all", () => {
  const TOKEN = randomBytes(32).toString("base64url");
  let baseUrl: string;
  let close: () => void;

  beforeAll(async () => {
    process.env.MCP_GATEWAY_AUTH_TOKEN = TOKEN;
    ({ baseUrl, close } = await startApp());
  });
  afterAll(() => {
    close();
    delete process.env.MCP_GATEWAY_AUTH_TOKEN;
  });

  it("401s a malformed body rather than 400ing it", async () => {
    // The ordering assertion: auth is mounted ahead of express.json(), so the
    // request is refused before a byte of it is parsed. A 400 here would mean
    // the parser ran for a caller that had not authenticated.
    const res = await fetch(`${baseUrl}/endpoints/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: "{ this is not json",
    });
    expect(res.status).toBe(401);
  });

  it("401s an oversized body rather than 413ing it", async () => {
    const res = await fetch(`${baseUrl}/endpoints/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify({ padding: "x".repeat(2 * 1024 * 1024) }),
    });
    expect(res.status).toBe(401);
  });
});

// ─── SEC-4 · the limiter decides before the parser works ─────────────────────
//
// The finding, measured: five unauthenticated 2 MB POSTs against
// MCP_GATEWAY_RATE_LIMIT_MAX=3 all returned 413 with NO rate-limit headers at
// all — body-parser's error short-circuited to the error handler before the
// limiter was ever reached, so an unauthenticated caller could make the gateway
// parse unbounded large bodies for free.

describe("SEC-4 — oversized bodies are metered", () => {
  let baseUrl: string;
  let close: () => void;

  beforeAll(async () => {
    process.env.MCP_GATEWAY_RATE_LIMIT_MAX = "3";
    ({ baseUrl, close } = await startApp());
  });
  afterAll(() => {
    close();
    delete process.env.MCP_GATEWAY_RATE_LIMIT_MAX;
  });

  it("charges a rejected 2 MB POST against the caller's budget", async () => {
    const big = JSON.stringify({ padding: "x".repeat(2 * 1024 * 1024) });
    const remaining: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/endpoints/mcp`, {
        method: "POST",
        headers: MCP_HEADERS,
        body: big,
      });
      remaining.push(res.headers.get("x-ratelimit-remaining") ?? "absent");
      if (i === 4) { expect(res.status).toBe(429); }
    }
    // Every request was seen by the limiter, and the budget ran out.
    expect(remaining).toEqual(["2", "1", "0", "0", "0"]);
  });
});

// ─── PER-15 · the MCP server (and its bConnect client) is pooled, not rebuilt ──

describe("PER-15 — sequential requests reuse a pooled server", () => {
  let baseUrl: string;
  let app: express.Application;
  let close: () => void;

  beforeAll(async () => {
    ({ baseUrl, app, close } = await startApp());
  });
  afterAll(() => close());

  it("returns the server to the pool after the response closes", async () => {
    const stats = app.locals.serverPoolStats as () => Record<string, number>;
    expect(stats().variables ?? 0).toBe(0);

    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/variables/mcp`, {
        method: "POST",
        headers: MCP_HEADERS,
        body: JSON.stringify({ ...MCP_INITIALIZE, id: i }),
      });
      expect(res.status).toBe(200);
      await parseMcpResponse(res);
    }

    // Release happens on the response's close event, after transport.close().
    for (let i = 0; i < 50 && (stats().variables ?? 0) === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // Three sequential requests, at most one idle server: each one was reused.
    expect(stats().variables).toBe(1);
  });
});
