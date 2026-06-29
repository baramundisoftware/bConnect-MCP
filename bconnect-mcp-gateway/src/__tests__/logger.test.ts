/**
 * bconnect-mcp-gateway — structured logger + access log (audit M4).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { Request, Response } from "express";

import { createLogger } from "../logger.js";
import { createAccessLogMiddleware } from "../access-log.js";
import { hashToken } from "../auth.js";

/** Capture stderr writes during fn(). */
function captureStderr(fn: () => void): string[] {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  try { fn(); } finally { spy.mockRestore(); }
  return lines;
}

afterEach(() => {
  delete process.env.LOG_LEVEL;
  delete process.env.LOG_FORMAT;
});

describe("createLogger", () => {
  it("emits JSON lines with ts/level/msg/fields when LOG_FORMAT=json", () => {
    process.env.LOG_FORMAT = "json";
    const log = createLogger();
    const [line] = captureStderr(() => log.info("hello", { a: 1 }));
    const obj = JSON.parse(line);
    expect(obj.level).toBe("info");
    expect(obj.msg).toBe("hello");
    expect(obj.a).toBe(1);
    expect(typeof obj.ts).toBe("string");
  });

  it("emits human-readable text by default", () => {
    const log = createLogger();
    const [line] = captureStderr(() => log.warn("careful", { x: "y" }));
    expect(line).toContain("WARN careful");
    expect(line).toContain("x=y");
  });

  it("filters below the configured LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "warn";
    const log = createLogger();
    const out = captureStderr(() => { log.info("skip me"); log.debug("skip me too"); log.error("keep"); });
    expect(out.join("")).not.toContain("skip me");
    expect(out.join("")).toContain("keep");
  });
});

describe("createAccessLogMiddleware", () => {
  function makeReqRes(path: string, authToken?: string) {
    const handlers: Record<string, () => void> = {};
    const req = { method: "POST", path, ip: "127.0.0.1" } as unknown as Request;
    const res = {
      statusCode: 200,
      locals: (authToken ? { authToken } : {}) as Record<string, unknown>,
      on(event: string, cb: () => void) { handlers[event] = cb; return res; },
    } as unknown as Response;
    return { req, res, finish: () => handlers["finish"]?.() };
  }

  it("logs a request with status, duration and a NON-raw caller id", () => {
    process.env.LOG_FORMAT = "json";
    const log = createLogger();
    const mw = createAccessLogMiddleware(log);
    const { req, res, finish } = makeReqRes("/endpoints/mcp", "tok_secret_value");
    const out = captureStderr(() => { mw(req, res, vi.fn()); finish(); });
    const obj = JSON.parse(out[0]);
    expect(obj.msg).toBe("request");
    expect(obj.status).toBe(200);
    expect(obj.method).toBe("POST");
    expect(typeof obj.durationMs).toBe("number");
    // caller is a hash prefix, never the raw token
    expect(obj.caller).toBe(`tok:${hashToken("tok_secret_value").slice(0, 12)}`);
    expect(out.join("")).not.toContain("tok_secret_value");
  });

  it("falls back to IP when there is no token", () => {
    process.env.LOG_FORMAT = "json";
    const mw = createAccessLogMiddleware(createLogger());
    const { req, res, finish } = makeReqRes("/endpoints/mcp");
    const out = captureStderr(() => { mw(req, res, vi.fn()); finish(); });
    expect(JSON.parse(out[0]).caller).toBe("127.0.0.1");
  });

  it("logs /health at debug (suppressed at default info level)", () => {
    const mw = createAccessLogMiddleware(createLogger()); // default level=info
    const { req, res, finish } = makeReqRes("/health");
    const out = captureStderr(() => { mw(req, res, vi.fn()); finish(); });
    expect(out.join("")).toBe(""); // health request not logged at info
  });
});
