/**
 * The standalone HTTP transport's Host/Origin guard (ARCH-4).
 *
 * The defect: `runServer`'s http branch built its transport with
 * `{ sessionIdGenerator: undefined }` and mounted no middleware, so a request
 * with any Host and any Origin was served. The SDK defaults
 * `enableDnsRebindingProtection` to false, and skips each check whose list is
 * empty — so "turn the flag on" alone is not a fix, and is the shape the
 * gateway's own second layer is stuck in (AUD-architect-1).
 *
 * Two properties are pinned here, and the second is the one that is easy to
 * lose: the guard must be enforcing WITH NO CONFIGURATION AT ALL, and the
 * options handed to the SDK must never be the empty lists it silently ignores.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createHttpGuardMiddleware,
  httpGuardStartupLine,
  normalizeHostHeader,
  resolveHttpGuardConfig,
  sdkTransportOptions,
  type GuardRequestLike,
  type GuardResponseLike,
} from "../src/http-host-guard.js";

function call(
  env: NodeJS.ProcessEnv,
  headers: Record<string, string | undefined>,
  bind = "127.0.0.1"
): { status: number | null; body: string | undefined; passed: boolean } {
  const result = { status: null as number | null, body: undefined as string | undefined, passed: false };
  const res: GuardResponseLike = {
    writeHead: (status) => {
      result.status = status;
      return { end: (body?: string) => (result.body = body) };
    },
  };
  const req = { headers } as GuardRequestLike;
  createHttpGuardMiddleware(resolveHttpGuardConfig(env, bind))(req, res, () => {
    result.passed = true;
  });
  return result;
}

describe("with nothing configured — the default posture", () => {
  it("serves a loopback request", () => {
    expect(call({}, { host: "127.0.0.1:3000" }).passed).toBe(true);
    expect(call({}, { host: "localhost:3000" }).passed).toBe(true);
    expect(call({}, { host: "[::1]:3000" }).passed).toBe(true);
    // No Host header at all is not a browser; it is also not something a real
    // HTTP/1.1 client sends, and it must not skip the check.
    expect(call({}, {}).passed).toBe(false);
  });

  it("refuses a forged Host — the DNS-rebinding case", () => {
    // The attack: a page the operator visits resolves its own name to
    // 127.0.0.1 and POSTs here. Host is what the browser will not let it fake.
    const out = call({}, { host: "evil.example.com:3000" });
    expect(out.passed).toBe(false);
    expect(out.status).toBe(403);
    expect(out.body).toMatch(/Forbidden Host 'evil\.example\.com:3000'/);
    expect(JSON.parse(out.body ?? "{}").jsonrpc).toBe("2.0");
  });

  it("refuses ANY Origin, because an Origin means a browser sent it", () => {
    const out = call({}, { host: "127.0.0.1:3000", origin: "https://evil.example" });
    expect(out.passed).toBe(false);
    expect(out.status).toBe(403);
    expect(out.body).toMatch(/Forbidden Origin 'https:\/\/evil\.example'/);
    expect(out.body).toMatch(/MCP_ALLOWED_ORIGINS/);
  });

  it("hands the SDK non-empty lists, so its own check is not decorative", () => {
    // An empty allowedHosts/allowedOrigins is skipped by the SDK
    // (webStandardStreamableHttp.js:145,154), so a transport configured with
    // `enableDnsRebindingProtection: true` and nothing else validates nothing.
    const options = sdkTransportOptions(resolveHttpGuardConfig({}, "127.0.0.1"), 3000);
    expect(options.enableDnsRebindingProtection).toBe(true);
    expect(options.allowedHosts).toEqual(
      expect.arrayContaining(["127.0.0.1", "127.0.0.1:3000", "localhost:3000", "[::1]:3000"])
    );
    expect(options.allowedHosts?.length).toBeGreaterThan(0);
  });
});

describe("the Host check is port-insensitive, as the gateway's is", () => {
  it("matches whatever port the client connected to", () => {
    // The port is not a security boundary — the attacker page targets our port
    // either way — and an operator writes a hostname, not a hostname:port.
    const env = { MCP_ALLOWED_HOSTS: "mcp.internal.example" };
    expect(call(env, { host: "mcp.internal.example" }).passed).toBe(true);
    expect(call(env, { host: "mcp.internal.example:3000" }).passed).toBe(true);
    expect(call(env, { host: "MCP.Internal.Example:8080" }).passed).toBe(true);
    expect(call(env, { host: "other.example:3000" }).passed).toBe(false);
  });

  it("normalizes IPv6 literals and leaves bare ones alone", () => {
    expect(normalizeHostHeader("[::1]:3000")).toBe("::1");
    expect(normalizeHostHeader("[::1]")).toBe("::1");
    expect(normalizeHostHeader("::1")).toBe("::1");
    expect(normalizeHostHeader("Localhost:3000")).toBe("localhost");
  });

  it("covers a non-loopback bind, which is only reachable with MCP_ALLOW_NO_AUTH", () => {
    expect(call({}, { host: "10.1.2.3:3000" }, "10.1.2.3").passed).toBe(true);
    expect(call({}, { host: "evil.example:3000" }, "10.1.2.3").passed).toBe(false);
  });
});

describe("the explicit opt-outs", () => {
  it('MCP_ALLOWED_ORIGINS names an origin, and only that one', () => {
    const env = { MCP_ALLOWED_ORIGINS: "https://studio.internal.example" };
    expect(call(env, { host: "127.0.0.1:3000", origin: "https://studio.internal.example" }).passed).toBe(true);
    expect(call(env, { host: "127.0.0.1:3000", origin: "https://evil.example" }).passed).toBe(false);
    expect(sdkTransportOptions(resolveHttpGuardConfig(env), 3000).allowedOrigins).toEqual([
      "https://studio.internal.example",
    ]);
  });

  it('"*" disables a check for an operator who fronted this with their own proxy', () => {
    expect(call({ MCP_ALLOWED_HOSTS: "*" }, { host: "anything.example" }).passed).toBe(true);
    expect(
      call({ MCP_ALLOWED_ORIGINS: "*" }, { host: "127.0.0.1:3000", origin: "https://any.example" }).passed
    ).toBe(true);
    // Both off is the only configuration that turns the SDK layer off too —
    // there is nothing left for it to enforce.
    expect(
      sdkTransportOptions(resolveHttpGuardConfig({ MCP_ALLOWED_HOSTS: "*", MCP_ALLOWED_ORIGINS: "*" }), 3000)
    ).toEqual({ enableDnsRebindingProtection: false });
  });

  it("states the resolved policy in one startup line", () => {
    expect(httpGuardStartupLine("bconnect-jobs-mcp", resolveHttpGuardConfig({}))).toMatch(
      /Host allowlist \[127\.0\.0\.1, localhost, ::1\]; Origin allowlist: none — every browser Origin is refused/
    );
  });
});

describe("the mounted middleware is what runServer actually installs", () => {
  it("is a three-argument express middleware that calls next() on a good request", () => {
    const next = vi.fn();
    const res = { writeHead: vi.fn(() => ({ end: vi.fn() })) };
    createHttpGuardMiddleware(resolveHttpGuardConfig({}))(
      { headers: { host: "localhost:3000" } },
      res as unknown as GuardResponseLike,
      next
    );
    expect(next).toHaveBeenCalledOnce();
    expect(res.writeHead).not.toHaveBeenCalled();
  });
});
