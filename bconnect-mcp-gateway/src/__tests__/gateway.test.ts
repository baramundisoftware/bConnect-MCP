/**
 * bconnect-mcp-gateway — the entry point (gateway.ts)
 *
 * gateway.ts runs at import: it closes the write and secret gates, checks
 * BCONNECT_RELEASE and MCP_GATEWAY_MAX_BODY, reads *_FILE secrets, refuses a
 * missing or insecure service credential (#330), detects the bMS release (#159),
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

// A real .env in the checkout must not reach these tests; the call itself is checked below.
const loadEnv = vi.fn();
// combinedTools as in core, unless a test makes it refuse (two domains sharing a tool name).
let combinedToolsRefusal: Error | undefined;
vi.mock("@bconnect/mcp-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bconnect/mcp-core")>();
  return {
    ...actual,
    loadEnvOnce: loadEnv,
    combinedTools: (...args: Parameters<typeof actual.combinedTools>) =>
      combinedToolsRefusal ? Promise.reject(combinedToolsRefusal) : actual.combinedTools(...args),
  };
});

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
  "MCP_GATEWAY_PORT", "MCP_GATEWAY_BIND", "MCP_ALLOW_NO_AUTH", "MCP_GATEWAY_ALLOWED_HOSTS", "MCP_GATEWAY_MAX_BODY", "MCP_GATEWAY_TRUST_PROXY", "MCP_GATEWAY_COMBINED",
  "LOG_LEVEL", "LOG_FORMAT", "BCONNECT_BASE_URL", "BCONNECT_SKIP_CONNECTIVITY_CHECK", "BCONNECT_ALLOW_INSECURE_HTTP",
];

/** The bMS the gateway's service credential reaches in the detection tests. */
let managementServer: () => Response = () => HttpResponse.json({ name: "bMS", version: "25.2.0.0" });
const bms = setupServer(http.get("https://bms.gateway.test/bconnect/servermanagement/v2.0/ManagementServer", () => managementServer()));

let lines: string[];

beforeEach(() => {
  vi.resetModules();
  combinedToolsRefusal = undefined;
  listen.mockClear();
  loadEnv.mockClear();
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
const withService = () => {
  vi.stubEnv("BCONNECT_BASE_URL", "https://bms.gateway.test/bconnect");
  vi.stubEnv("BCONNECT_API_KEY", "service-key");
};
// Log lines only: anything else on stderr (a Node warning) is not the gateway's.
const logged = () => lines.filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as { level: string; msg: string } & Record<string, unknown>);

describe("gateway entry point: release detection (#159)", () => {
  beforeEach(() => {
    managementServer = () => HttpResponse.json({ name: "bMS", version: "25.2.0.0" });
    bms.listen({ onUnhandledRequest: "error" });
  });
  afterEach(() => { bms.close(); });

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

  it("loads .env before it reads the settings and detects", async () => {
    withService();
    await start();
    expect(loadEnv).toHaveBeenCalledOnce();
  });

  it("detects after the bind check: a refused bind sends nothing", async () => {
    withService();
    vi.stubEnv("MCP_GATEWAY_BIND", "0.0.0.0");
    managementServer = () => { throw new Error("must not be called"); };
    await expect(start()).rejects.toThrow("exit 1");
    expect(logged().some((m) => /bMS|release detection/.test(m.msg))).toBe(false);
  });

  it("its servers list the tools of the detected release (one core for all)", async () => {
    withService();
    await start();
    const { createServer } = await import("bconnect-universaldynamicgroups-mcp");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "gateway-test", version: "0" });
    await Promise.all([createServer().server.connect(a), client.connect(b)]);
    // Universal dynamic groups don't exist in 25R2: the detected release hides all 6 tools.
    expect((await client.listTools()).tools).toEqual([]);
    await client.close();
  });

  it("starts with the setting and a warning when the version can't be read", async () => {
    withService();
    vi.stubEnv("BCONNECT_RELEASE", "25R2");
    managementServer = () => HttpResponse.json({ title: "Forbidden" }, { status: 403 });
    await start();
    expect(listen).toHaveBeenCalledOnce();
    expect(logged().find((m) => m.level === "warn" && /could not detect the bMS release/.test(m.msg))?.msg).toMatch(/using 25R2 \(from BCONNECT_RELEASE\)/);
  });

  it("starts with a warning when bMS can't be reached (no restart loop, #330)", async () => {
    withService();
    managementServer = () => HttpResponse.error();
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

describe("gateway entry point: refuses to start without a usable service credential (#330)", () => {
  beforeEach(() => {
    managementServer = () => { throw new Error("must not be called"); };
    bms.listen({ onUnhandledRequest: "error" });
  });
  afterEach(() => { bms.close(); });

  /** The start stops with exit 1 before listening or calling bMS, with one error line. */
  async function refused(): Promise<string> {
    await expect(start()).rejects.toThrow(Exit);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(listen).not.toHaveBeenCalled();
    const errors = logged().filter((m) => m.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].msg).not.toContain("\n");
    return errors[0].msg;
  }

  it("without BCONNECT_BASE_URL", async () => {
    vi.stubEnv("BCONNECT_API_KEY", "service-key");
    expect(await refused()).toMatch(/^BCONNECT_BASE_URL isn't set/);
  });

  it.each([
    ["nothing", {}],
    ["a username only", { BCONNECT_USERNAME: "svc" }],
    ["a password only", { BCONNECT_PASSWORD: "secret" }],
  ])("with %s as the credential", async (_name, credential: Record<string, string>) => {
    vi.stubEnv("BCONNECT_BASE_URL", "https://bms.gateway.test/bconnect");
    for (const [name, value] of Object.entries(credential)) {vi.stubEnv(name, value);}
    expect(await refused()).toBe("Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required");
  });

  it("with an http:// base URL that isn't loopback", async () => {
    withService();
    vi.stubEnv("BCONNECT_BASE_URL", "http://bms.gateway.test/bconnect");
    expect(await refused()).toMatch(/uses http:\/\/ for bms\.gateway\.test, which would send the bConnect credentials unencrypted/);
  });

  it("with a base URL that isn't a URL", async () => {
    withService();
    vi.stubEnv("BCONNECT_BASE_URL", "bms.gateway.test");
    expect(await refused()).toMatch(/^BCONNECT_BASE_URL must be an https:\/\/ URL/);
  });

  it("starts with a credential from *_FILE secrets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gateway-secret-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(join(dir, "key"), "service-key\n");
    vi.stubEnv("BCONNECT_BASE_URL", "https://bms.gateway.test/bconnect");
    vi.stubEnv("BCONNECT_API_KEY_FILE", join(dir, "key"));
    vi.stubEnv("BCONNECT_SKIP_CONNECTIVITY_CHECK", "true");
    await start();
    expect(listen).toHaveBeenCalledOnce();
  });

  it.each(["true", "0", "proxy.example.com", "10.0.0.0/33"])("with MCP_GATEWAY_TRUST_PROXY=%s (#331)", async (value) => {
    withService();
    vi.stubEnv("MCP_GATEWAY_TRUST_PROXY", value);
    expect((await refused()).startsWith(`MCP_GATEWAY_TRUST_PROXY=${JSON.stringify(value)} isn't valid. `)).toBe(true);
  });

  it.each([
    [",", "it names no domain"],
    ["all,assets", "all stands alone"],
    ["assets,nope", '"nope" is not a domain'],
  ])("with MCP_GATEWAY_COMBINED=%s (#131)", async (value, reason) => {
    withService();
    vi.stubEnv("MCP_GATEWAY_COMBINED", value);
    expect((await refused()).startsWith(`MCP_GATEWAY_COMBINED=${JSON.stringify(value)} isn't valid: ${reason}. Use all, or domain names`)).toBe(true);
  });

  it.each(["1m", "10mib", "1.5mb", "-1kb", "1 gb", "lots", "0", "1023", "101mb"])("with MCP_GATEWAY_MAX_BODY=%s", async (value) => {
    withService();
    vi.stubEnv("MCP_GATEWAY_MAX_BODY", value);
    expect(await refused()).toBe(
      `MCP_GATEWAY_MAX_BODY=${JSON.stringify(value)} isn't valid. ` +
        "Use a whole number of bytes, kb or mb (for example 512kb or 2mb), from 1kb to 100mb.",
    );
  });
});

describe("gateway entry point", () => {
  beforeEach(() => {
    withService();
    vi.stubEnv("BCONNECT_SKIP_CONNECTIVITY_CHECK", "true");
  });

  it("listens on 127.0.0.1:3001 by default and says so", async () => {
    await start();
    expect(listen).toHaveBeenCalledOnce();
    expect(listen.mock.calls[0].slice(0, 2)).toEqual([3001, "127.0.0.1"]);
    const msgs = logged();
    expect(msgs.find((m) => m.msg === "listening")).toMatchObject({ url: "http://127.0.0.1:3001", servers: 13 });
    expect(msgs.find((m) => m.msg === "allowed host names")?.hosts).toMatch(/localhost/);
    expect(msgs.some((m) => m.level === "warn" && /no built-in auth/.test(m.msg))).toBe(true);
  });

  it("says where it takes the client address from: the connection by default (#331)", async () => {
    await start();
    expect(logged().find((m) => m.msg === "client address")).toMatchObject({ level: "info", from: "connection" });
  });

  it.each([
    ["1", "X-Forwarded-For via 1 proxy hop(s)"],
    ["10.0.0.5,10.0.0.0/8", "X-Forwarded-For via 10.0.0.5,10.0.0.0/8"],
  ])("with MCP_GATEWAY_TRUST_PROXY=%s it says which proxy it trusts", async (value, from) => {
    vi.stubEnv("MCP_GATEWAY_TRUST_PROXY", value);
    await start();
    expect(logged().find((m) => m.msg === "client address")?.from).toBe(from);
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
    vi.stubEnv("BCONNECT_PASSWORD_FILE", join(tmpdir(), "gateway-no-such-secret"));
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

  it("says the combined endpoint is off when MCP_GATEWAY_COMBINED is unset (#131)", async () => {
    await start();
    expect(logged().find((m) => m.msg.startsWith("combined endpoint"))).toMatchObject({
      level: "info", msg: "combined endpoint off (MCP_GATEWAY_COMBINED unset)", path: "/mcp",
    });
  });

  it("with MCP_GATEWAY_COMBINED=all it checks the tool names and says which domains /mcp offers (#131)", async () => {
    vi.stubEnv("MCP_GATEWAY_COMBINED", "all");
    vi.stubEnv("BCONNECT_RELEASE", "26R1");
    await start();
    expect(listen).toHaveBeenCalledOnce();
    const { domains } = await import("../app.js");
    const line = logged().find((m) => m.msg.startsWith("combined endpoint"));
    expect(line).toMatchObject({ level: "info", msg: "combined endpoint on (MCP_GATEWAY_COMBINED)", path: "/mcp", domains: domains.join(",") });
    expect(line?.tools).toBeGreaterThan(50);
  });

  it("with a list it names only the chosen domains (#131)", async () => {
    vi.stubEnv("MCP_GATEWAY_COMBINED", "groups,compliance");
    await start();
    expect(logged().find((m) => m.msg.startsWith("combined endpoint"))).toMatchObject({ domains: "compliance,groups" });
  });

  it("stops with exit 1 before listening when two chosen domains share a tool name (#131)", async () => {
    vi.stubEnv("MCP_GATEWAY_COMBINED", "all");
    combinedToolsRefusal = new Error("tool 'x' is offered by both 'a' and 'b'; the combined endpoint needs unique tool names");
    await expect(start()).rejects.toThrow(Exit);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(listen).not.toHaveBeenCalled();
    expect(logged().find((m) => m.level === "error")?.msg).toBe(
      "MCP_GATEWAY_COMBINED: tool 'x' is offered by both 'a' and 'b'; the combined endpoint needs unique tool names",
    );
  });
});
