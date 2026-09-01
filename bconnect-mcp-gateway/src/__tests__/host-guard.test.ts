/**
 * bconnect-mcp-gateway — DNS-rebinding / Origin protection (SEC-9).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { Request, Response } from "express";

import {
  createHostGuardMiddleware,
  normalizeHost,
  resolveHostGuardConfig,
  sdkTransportOptions,
} from "../host-guard.js";

function makeReq(headers: Record<string, string> = {}, path = "/endpoints/mcp"): Request {
  return { path, headers } as unknown as Request;
}

function makeRes() {
  const stub = {
    _status: 0,
    _body: null as unknown,
    status(code: number) { stub._status = code; return stub; },
    json(body: unknown) { stub._body = body; return stub; },
  };
  return stub as unknown as Response & { _status: number; _body: unknown };
}

afterEach(() => {
  delete process.env.MCP_GATEWAY_ALLOWED_HOSTS;
  delete process.env.MCP_GATEWAY_ALLOWED_ORIGINS;
  delete process.env.MCP_GATEWAY_BIND;
});

describe("normalizeHost", () => {
  it("strips the port", () => {
    expect(normalizeHost("127.0.0.1:3001")).toBe("127.0.0.1");
    expect(normalizeHost("Localhost:54321")).toBe("localhost");
  });

  it("unwraps a bracketed IPv6 literal with and without a port", () => {
    expect(normalizeHost("[::1]:3001")).toBe("::1");
    expect(normalizeHost("[::1]")).toBe("::1");
  });

  it("leaves a bare hostname alone", () => {
    expect(normalizeHost("mcp.example.com")).toBe("mcp.example.com");
  });
});

describe("Host check", () => {
  it("rejects a rebound Host on the default loopback bind", () => {
    const mw = createHostGuardMiddleware();
    const res = makeRes();
    const next = vi.fn();
    mw(makeReq({ host: "attacker.example.com" }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });

  it("allows loopback Hosts on any port", () => {
    const mw = createHostGuardMiddleware();
    for (const host of ["127.0.0.1:3001", "localhost:54321", "[::1]:3001"]) {
      const next = vi.fn();
      mw(makeReq({ host }), makeRes(), next);
      expect(next, `host '${host}' should pass`).toHaveBeenCalledOnce();
    }
  });

  it("rejects a request with no Host header at all", () => {
    const mw = createHostGuardMiddleware();
    const res = makeRes();
    mw(makeReq({}), res, vi.fn());
    expect(res._status).toBe(403);
  });

  // SEC-10 — /health was exempt from the Host check outright, so a raw socket
  // sending `Host: evil.example.com` was answered. What the exemption was FOR
  // is a probe addressing the container by its own address, which nobody can
  // put in an allowlist in advance; that case still works, and only that case.
  it("lets a container probe reach /health by IP address", () => {
    const mw = createHostGuardMiddleware();
    for (const host of ["10.1.2.3:3001", "172.17.0.4", "[fd00::4]:3001"]) {
      const next = vi.fn();
      mw(makeReq({ host }, "/health"), makeRes(), next);
      expect(next, `probe by address '${host}' should pass`).toHaveBeenCalledOnce();
    }
  });

  it("rejects a forged HOSTNAME on /health — it is not exempt any more", () => {
    const mw = createHostGuardMiddleware();
    const res = makeRes();
    mw(makeReq({ host: "evil.example.com" }, "/health"), res, vi.fn());
    expect(res._status).toBe(403);
  });

  it("keeps the address carve-out to /health — /<domain>/mcp stays strict", () => {
    const mw = createHostGuardMiddleware();
    const res = makeRes();
    mw(makeReq({ host: "10.1.2.3:3001" }, "/endpoints/mcp"), res, vi.fn());
    expect(res._status).toBe(403);
  });

  it("honours an explicit MCP_GATEWAY_ALLOWED_HOSTS list", () => {
    process.env.MCP_GATEWAY_ALLOWED_HOSTS = "mcp.example.com";
    const mw = createHostGuardMiddleware();
    const okNext = vi.fn();
    mw(makeReq({ host: "mcp.example.com:443" }), makeRes(), okNext);
    expect(okNext).toHaveBeenCalledOnce();
    const res = makeRes();
    mw(makeReq({ host: "127.0.0.1:3001" }), res, vi.fn());
    expect(res._status).toBe(403); // explicit list replaces the loopback default
  });

  it("does not enforce a guessed Host list on a non-loopback bind", () => {
    // The documented shape: bound 0.0.0.0 behind a proxy that rewrites Host to
    // a public name the gateway cannot predict. Enforcing there would break it.
    process.env.MCP_GATEWAY_BIND = "0.0.0.0";
    expect(resolveHostGuardConfig().allowedHosts).toEqual([]);
    const next = vi.fn();
    createHostGuardMiddleware()(makeReq({ host: "mcp.example.com" }), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("Origin check", () => {
  it("rejects any Origin by default — the gateway is not a browser API", () => {
    const mw = createHostGuardMiddleware();
    const res = makeRes();
    mw(makeReq({ host: "127.0.0.1:3001", origin: "https://evil.example" }), res, vi.fn());
    expect(res._status).toBe(403);
  });

  it("allows a request with no Origin header (every non-browser client)", () => {
    const next = vi.fn();
    createHostGuardMiddleware()(makeReq({ host: "127.0.0.1:3001" }), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("honours MCP_GATEWAY_ALLOWED_ORIGINS", () => {
    process.env.MCP_GATEWAY_ALLOWED_ORIGINS = "https://console.example";
    const mw = createHostGuardMiddleware();
    const next = vi.fn();
    mw(makeReq({ host: "127.0.0.1:3001", origin: "https://console.example" }), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
    const res = makeRes();
    mw(makeReq({ host: "127.0.0.1:3001", origin: "https://evil.example" }), res, vi.fn());
    expect(res._status).toBe(403);
  });

  it("is disabled by MCP_GATEWAY_ALLOWED_ORIGINS=*", () => {
    process.env.MCP_GATEWAY_ALLOWED_ORIGINS = "*";
    const next = vi.fn();
    createHostGuardMiddleware()(
      makeReq({ host: "127.0.0.1:3001", origin: "https://anything.example" }),
      makeRes(),
      next,
    );
    expect(next).toHaveBeenCalledOnce();
  });
});

// ─── AUD-architect-1 · the SDK layer must not claim a check it skips ─────────
//
// app.ts passed `enableDnsRebindingProtection: true` alongside an allowedOrigins
// list it spread only when non-empty — and the default IS empty. The SDK skips a
// check whose list is empty, so the "second layer" the code advertised did
// nothing in exactly the configuration everybody runs. Proven at the time by
// constructing the transport with the gateway's own defaults and calling
// validateRequestHeaders with host evil.example.com / origin
// https://evil.example.com: undefined, no check.

describe("sdkTransportOptions", () => {
  it("reports the protection OFF when nothing is configured, rather than claiming it", () => {
    expect(sdkTransportOptions(resolveHostGuardConfig())).toEqual({
      enableDnsRebindingProtection: false,
    });
  });

  it("turns it on, with the list, once origins are named", () => {
    process.env.MCP_GATEWAY_ALLOWED_ORIGINS = "https://console.example";
    expect(sdkTransportOptions(resolveHostGuardConfig())).toEqual({
      enableDnsRebindingProtection: true,
      allowedOrigins: ["https://console.example"],
    });
  });

  it("reports it OFF for MCP_GATEWAY_ALLOWED_ORIGINS=* — the operator disabled it", () => {
    process.env.MCP_GATEWAY_ALLOWED_ORIGINS = "*";
    expect(sdkTransportOptions(resolveHostGuardConfig())).toEqual({
      enableDnsRebindingProtection: false,
    });
  });

  it("never passes allowedHosts — the SDK compares the port and does not know it", () => {
    process.env.MCP_GATEWAY_ALLOWED_ORIGINS = "https://console.example";
    // `docker run -p 3005:3001` makes the caller's Host port 3005 and the
    // process's 3001; a verbatim list would 403 a legitimate caller. The
    // middleware above owns the Host decision, port-insensitively.
    expect(sdkTransportOptions(resolveHostGuardConfig())).not.toHaveProperty("allowedHosts");
  });
});
