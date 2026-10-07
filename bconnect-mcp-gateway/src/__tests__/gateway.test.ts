/**
 * bconnect-mcp-gateway — the entry point (gateway.ts)
 *
 * gateway.ts runs at import: it closes the write and secret gates, checks
 * BCONNECT_RELEASE, reads *_FILE secrets, detects the bMS release (#159),
 * refuses a non-loopback bind without MCP_ALLOW_NO_AUTH=true, then listens. Each test imports it afresh with
 * createApp() replaced by a stub, so nothing listens; process.exit throws, so
 * a refused start stops the import where the real process would stop.
 */

import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const listen = vi.fn((_port: number, _bind: string, onListening: () => void) => { onListening(); });

vi.mock("../app.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../app.js")>();
  return { ...actual, createApp: () => ({ listen }) };
});

class Exit extends Error {
  constructor(readonly code: number) { super(`exit ${code}`); }
}

/** Every variable gateway.ts reads, cleared, so the host's environment can't leak in. */
const READ = [
  "ALLOW_WRITE_OPERATIONS", "ALLOW_SECRET_READ", "BCONNECT_RELEASE", "BCONNECT_PRETTY_JSON",
  "BCONNECT_USERNAME", "BCONNECT_PASSWORD", "BCONNECT_API_KEY",
  "BCONNECT_USERNAME_FILE", "BCONNECT_PASSWORD_FILE", "BCONNECT_API_KEY_FILE",
  "MCP_GATEWAY_PORT", "MCP_GATEWAY_BIND", "MCP_ALLOW_NO_AUTH", "MCP_GATEWAY_ALLOWED_HOSTS",
  "LOG_LEVEL", "LOG_FORMAT", "BCONNECT_BASE_URL", "BCONNECT_SKIP_CONNECTIVITY_CHECK", "BCONNECT_ALLOW_INSECURE_HTTP",
];

/** The bMS the gateway's service credential reaches in the detection tests. */
let managementServer: () => Response = () => HttpResponse.json({ name: "bMS", version: "25.2.0.0" });
const bms = setupServer(http.get("https://bms.gateway.test/bconnect/servermanagement/v2.0/ManagementServer", () => managementServer()));

let lines: string[];

beforeEach(() => {
  vi.resetModules();
  listen.mockClear();
  for (const name of READ) {vi.stubEnv(name, undefined);}
  vi.stubEnv("LOG_FORMAT", "json");
  lines = [];
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => { lines.push(chunk); return true; }) as never);
  vi.spyOn(process, "exit").mockImplementation(((code: number) => { throw new Exit(code); }) as never);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const start = () => import("../gateway.js");
// Log lines only: anything else on stderr (a Node warning) is not the gateway's.
const logged = () => lines.filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as { level: string; msg: string } & Record<string, unknown>);

describe("gateway entry point: release detection (#159)", () => {
  beforeEach(() => {
    managementServer = () => HttpResponse.json({ name: "bMS", version: "25.2.0.0" });
    bms.listen({ onUnhandledRequest: "error" });
  });
  afterEach(() => { bms.close(); });
  const withService = () => {
    vi.stubEnv("BCONNECT_BASE_URL", "https://bms.gateway.test/bconnect");
    vi.stubEnv("BCONNECT_API_KEY", "service-key");
  };

  it("detects the release with the service credential before it listens", async () => {
    withService();
    vi.stubEnv("BCONNECT_RELEASE", "26R1");
    const { selectedRelease } = await import("@bconnect/mcp-core");
    await start();
    const msgs = logged().map((m) => m.msg);
    const detected = msgs.indexOf("bMS 25.2.0.0 → release 25R2; BCONNECT_RELEASE=26R1 is ignored");
    expect(detected).toBeGreaterThan(-1);
    expect(detected).toBeLessThan(msgs.indexOf("listening"));
    expect(selectedRelease()).toBe("25R2");
  });

  it("starts with the setting and a warning when the version can't be read", async () => {
    withService();
    vi.stubEnv("BCONNECT_RELEASE", "25R2");
    managementServer = () => HttpResponse.json({ title: "Forbidden" }, { status: 403 });
    await start();
    expect(listen).toHaveBeenCalledOnce();
    expect(logged().find((m) => m.level === "warn" && /could not detect the bMS release/.test(m.msg))?.msg).toMatch(/using 25R2 \(from BCONNECT_RELEASE\)/);
  });

  it("starts with a warning when there is no service credential to read it with", async () => {
    await start();
    expect(listen).toHaveBeenCalledOnce();
    expect(logged().some((m) => m.level === "warn" && /could not detect the bMS release/.test(m.msg))).toBe(true);
  });

  it("sends nothing with BCONNECT_SKIP_CONNECTIVITY_CHECK=true", async () => {
    withService();
    vi.stubEnv("BCONNECT_SKIP_CONNECTIVITY_CHECK", "true");
    managementServer = () => { throw new Error("must not be called"); };
    await start();
    expect(logged().some((m) => /release detection skipped/.test(m.msg))).toBe(true);
  });
});

describe("gateway entry point", () => {
  it("listens on 127.0.0.1:3001 by default and says so", async () => {
    await start();
    expect(listen).toHaveBeenCalledOnce();
    expect(listen.mock.calls[0].slice(0, 2)).toEqual([3001, "127.0.0.1"]);
    const msgs = logged();
    expect(msgs.find((m) => m.msg === "listening")).toMatchObject({ url: "http://127.0.0.1:3001", servers: 13 });
    expect(msgs.find((m) => m.msg === "allowed host names")?.hosts).toMatch(/localhost/);
    expect(msgs.some((m) => m.level === "warn" && /no built-in auth/.test(m.msg))).toBe(true);
  });

  it("takes the port and bind from MCP_GATEWAY_PORT and MCP_GATEWAY_BIND", async () => {
    vi.stubEnv("MCP_GATEWAY_PORT", "4123");
    vi.stubEnv("MCP_GATEWAY_BIND", "::1");
    await start();
    expect(listen.mock.calls[0].slice(0, 2)).toEqual([4123, "::1"]);
  });

  it("keeps the write and secret gates off, and warns when they were set", async () => {
    vi.stubEnv("ALLOW_WRITE_OPERATIONS", "true");
    vi.stubEnv("ALLOW_SECRET_READ", "true");
    await start();
    expect(process.env.ALLOW_WRITE_OPERATIONS).toBe("");
    expect(process.env.ALLOW_SECRET_READ).toBe("");
    expect(logged().find((m) => /write tools and secret reads stay off/.test(m.msg))).toMatchObject({
      level: "warn", settings: "ALLOW_WRITE_OPERATIONS,ALLOW_SECRET_READ",
    });
  });

  it("does not warn about gates nobody set", async () => {
    await start();
    expect(logged().some((m) => /stay off/.test(m.msg))).toBe(false);
  });

  it("names an MCP_GATEWAY_ALLOWED_HOSTS entry it ignores", async () => {
    vi.stubEnv("MCP_GATEWAY_ALLOWED_HOSTS", "mcp.example.test,*.example.test");
    await start();
    expect(logged().find((m) => /entry ignored/.test(m.msg))).toMatchObject({ level: "warn", entry: '"*.example.test"' });
    expect(logged().find((m) => m.msg === "allowed host names")?.hosts).toMatch(/mcp\.example\.test/);
  });

  it("stops with exit 1 on an invalid BCONNECT_RELEASE, before listening", async () => {
    vi.stubEnv("BCONNECT_RELEASE", "26r1");
    await expect(start()).rejects.toThrow(Exit);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(listen).not.toHaveBeenCalled();
    expect(logged().find((m) => m.level === "error")?.msg).toMatch(/BCONNECT_RELEASE "26r1" isn't valid/);
  });

  it("stops with exit 1 on an invalid BCONNECT_PRETTY_JSON, before listening", async () => {
    vi.stubEnv("BCONNECT_PRETTY_JSON", "yes");
    await expect(start()).rejects.toThrow(Exit);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(listen).not.toHaveBeenCalled();
    expect(logged().find((m) => m.level === "error")?.msg).toMatch(/BCONNECT_PRETTY_JSON "yes" isn't valid/);
  });

  it("starts with BCONNECT_PRETTY_JSON=true", async () => {
    vi.stubEnv("BCONNECT_PRETTY_JSON", "true");
    await start();
    expect(listen).toHaveBeenCalledOnce();
  });

  it("reads a *_FILE secret into its variable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gateway-secret-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "password");
    writeFileSync(file, "from-file\n");
    vi.stubEnv("BCONNECT_PASSWORD_FILE", file);
    await start();
    expect(process.env.BCONNECT_PASSWORD).toBe("from-file");
    expect(listen).toHaveBeenCalledOnce();
  });

  it("stops with exit 1 when a *_FILE secret can't be read, without its contents or path in the message", async () => {
    vi.stubEnv("BCONNECT_API_KEY_FILE", join(tmpdir(), "gateway-no-such-secret"));
    await expect(start()).rejects.toThrow(Exit);
    expect(listen).not.toHaveBeenCalled();
    expect(logged().find((m) => m.level === "error")?.msg).toBe("cannot read a *_FILE secret referenced in the environment");
  });

  it.each(["0.0.0.0", "192.0.2.10"])("refuses to bind %s without MCP_ALLOW_NO_AUTH=true", async (bind) => {
    vi.stubEnv("MCP_GATEWAY_BIND", bind);
    await expect(start()).rejects.toThrow(Exit);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(listen).not.toHaveBeenCalled();
    expect(logged().find((m) => m.level === "error")).toMatchObject({ msg: expect.stringMatching(/^Refusing to start: non-loopback bind/), bind });
  });

  it("binds a non-loopback address when MCP_ALLOW_NO_AUTH=true asserts a proxy in front", async () => {
    vi.stubEnv("MCP_GATEWAY_BIND", "0.0.0.0");
    vi.stubEnv("MCP_ALLOW_NO_AUTH", "true");
    await start();
    expect(listen.mock.calls[0].slice(0, 2)).toEqual([3001, "0.0.0.0"]);
  });
});
