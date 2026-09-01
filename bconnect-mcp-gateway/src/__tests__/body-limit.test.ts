/**
 * bconnect-mcp-gateway — the body cap must not fail open (SC-1).
 *
 * The advisory is GHSA-v422-hmwv-36x6: body-parser resolves its `limit` option
 * with `bytes.parse()`, which returns null for an unusable string, and raw-body
 * then skips enforcement entirely (`if (limit !== null && received > limit)`).
 * The gateway used to hand `process.env.MCP_GATEWAY_MAX_BODY` to
 * `express.json({ limit })` unvalidated, so a bad value removed the cap that
 * SECURITY.md advertises.
 *
 * These tests are written to FAIL against that code. The two integration cases
 * at the bottom are the ones that matter: they drive real HTTP against a real
 * app and observe whether an oversized body is actually refused, rather than
 * asserting that a helper returns a number.
 *
 * ── Which values actually trigger it, measured not assumed ──────────────────
 * The first draft of this file asserted on `MCP_GATEWAY_MAX_BODY=""` and passed
 * against the UNFIXED gateway — a guard that cannot fail is not evidence, so it
 * was run down rather than kept. body-parser@2.2.2 resolves the option as
 *
 *     bytes.parse(options?.limit || '100kb')      // lib/utils.js:63-65
 *
 * and that `||` swallows the empty string, quietly substituting a 100kb cap.
 * So `""` fails CLOSED (tighter than documented, but capped).
 *
 * The value that actually removes the cap is one that is truthy but does not
 * begin with a digit, because `bytes.parse` then falls through to
 * `parseInt(val, 10)` -> NaN -> **null**, and raw-body's enforcement is written
 * `if (limit !== null && received > limit)`. Measured against the resolved
 * body-parser@2.2.2 / bytes@3.1.2:
 *
 *   '"1mb"' (quotes retained) -> null   *** CAP REMOVED ***
 *   "unlimited" / "none" / "off" / "max" -> null   *** CAP REMOVED ***
 *   " " / "\t"                -> null   *** CAP REMOVED ***
 *   ""                        -> 102400 (silently 100kb, not 1mb)
 *   "1mib" / "10m" / "1mb "   -> 1      (cap becomes ONE BYTE)
 *   "10 MB please"            -> 10     (leading digit is salvaged)
 *
 * The quoted case is the realistic deployment mistake: a docker-compose
 * `environment:` list entry written `- MCP_GATEWAY_MAX_BODY="1mb"` keeps the
 * quotes as part of the value, and the gateway then runs with no body cap at
 * all while SECURITY.md tells the operator it has one.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type express from "express";
import { createApp } from "../app.js";
import {
  parseByteSize,
  resolveMaxBodyBytes,
  DEFAULT_MAX_BODY_BYTES,
  MAX_ACCEPTED_BODY_BYTES,
} from "../body-limit.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function startApp(): Promise<{ baseUrl: string; app: express.Application; close: () => void }> {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  return { baseUrl: `http://127.0.0.1:${addr.port}`, app, close: (): void => { server.close(); } };
}

/** A syntactically valid JSON body of roughly `bytes` bytes. */
function jsonBodyOfSize(bytes: number): string {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", padding: "A".repeat(bytes) });
}

const MCP_HEADERS = {
  "Content-Type": "application/json",
  "Accept": "application/json, text/event-stream",
};

// ─── parseByteSize — the strict parser ───────────────────────────────────────

describe("parseByteSize", () => {
  it("accepts the documented spellings", () => {
    expect(parseByteSize("1mb")).toBe(1024 * 1024);
    expect(parseByteSize("512kb")).toBe(512 * 1024);
    expect(parseByteSize("10 MB")).toBe(10 * 1024 * 1024);
    expect(parseByteSize("1gb")).toBe(1024 * 1024 * 1024);
    expect(parseByteSize("2048")).toBe(2048); // bare byte count
    expect(parseByteSize("  1mb  ")).toBe(1024 * 1024); // surrounding space is not a typo
  });

  it("returns null — never a guess — for every spelling bytes.parse silently misreads", () => {
    // Each of these resolves to 1 byte under bytes.parse. Guessing here would
    // reproduce the same silent breakage one layer up.
    for (const spelling of ["1mib", "10m", "1 megabyte", "1MiB", "1gib", "5 kilobytes"]) {
      expect(parseByteSize(spelling), `${spelling} must not be guessed`).toBeNull();
    }
  });

  it("returns null for the values that DISABLE the cap under bytes.parse", () => {
    for (const bad of ["", "   ", "abc", "null", "undefined"]) {
      expect(parseByteSize(bad), `${JSON.stringify(bad)} must be rejected`).toBeNull();
    }
  });

  it("rejects non-positive and absurd sizes", () => {
    expect(parseByteSize("0")).toBeNull();
    expect(parseByteSize("-1mb")).toBeNull();
    expect(parseByteSize("0kb")).toBeNull();
    // A cap above the ceiling is indistinguishable from no cap.
    expect(parseByteSize(String(MAX_ACCEPTED_BODY_BYTES))).toBe(MAX_ACCEPTED_BODY_BYTES);
    expect(parseByteSize(String(MAX_ACCEPTED_BODY_BYTES + 1))).toBeNull();
    expect(parseByteSize("2gb")).toBeNull();
  });

  it("rejects a fractional byte count rather than rounding it", () => {
    expect(parseByteSize("1.5b")).toBeNull();
    expect(parseByteSize("0.5mb")).toBe(512 * 1024); // whole number of bytes — fine
  });
});

// ─── resolveMaxBodyBytes — fallback and the warning ──────────────────────────

describe("resolveMaxBodyBytes", () => {
  it("falls back to the documented default when unset, without warning", () => {
    const warnings: string[] = [];
    const logger = {
      error: (): void => {}, warn: (m: string): void => { warnings.push(m); },
      info: (): void => {}, debug: (): void => {},
    };
    expect(resolveMaxBodyBytes(undefined, logger)).toBe(DEFAULT_MAX_BODY_BYTES);
    expect(warnings).toEqual([]);
  });

  it("WARNS and falls back when the operator set something unusable", () => {
    // Silence here would be the whole defect: a deployer who typed a limit
    // believes they have one.
    for (const bad of ["", "abc", "1mib", "-1mb", "0"]) {
      const warnings: string[] = [];
      const logger = {
        error: (): void => {}, warn: (m: string): void => { warnings.push(m); },
        info: (): void => {}, debug: (): void => {},
      };
      expect(resolveMaxBodyBytes(bad, logger)).toBe(DEFAULT_MAX_BODY_BYTES);
      expect(warnings.length, `${JSON.stringify(bad)} must warn`).toBe(1);
      expect(warnings[0]).toMatch(/MCP_GATEWAY_MAX_BODY/);
    }
  });

  it("honours a valid operator value", () => {
    expect(resolveMaxBodyBytes("256kb")).toBe(256 * 1024);
  });
});

// ─── The integration proof: an oversized body is actually refused ────────────

describe("SC-1 — the gateway body cap holds against a bad MCP_GATEWAY_MAX_BODY", () => {
  const saved = process.env.MCP_GATEWAY_MAX_BODY;

  beforeEach(() => {
    // Keep the rate limiter out of the way; these send few but large requests.
    process.env.MCP_GATEWAY_RATE_LIMIT_ENABLED = "false";
  });

  afterEach(() => {
    if (saved === undefined) { delete process.env.MCP_GATEWAY_MAX_BODY; }
    else { process.env.MCP_GATEWAY_MAX_BODY = saved; }
    delete process.env.MCP_GATEWAY_RATE_LIMIT_ENABLED;
  });

  /**
   * THE test — every one of these values leaves the UNFIXED gateway with no
   * body cap whatsoever, so the 2 MB body is read in full and routed (404 for
   * the unknown domain) instead of refused with 413.
   *
   * These are not exotic. `'"1mb"'` is what a docker-compose `environment:`
   * list entry with quotes produces; `" "` is a trailing space on an otherwise
   * blank assignment; `"unlimited"` is an operator answering the question they
   * think is being asked.
   */
  it.each(['"1mb"', "unlimited", "none", " ", "abc"])(
    "refuses a 2 MB body when MCP_GATEWAY_MAX_BODY is %j (uncapped before the fix)",
    async (value) => {
      process.env.MCP_GATEWAY_MAX_BODY = value;
      const { baseUrl, close } = await startApp();
      try {
        const res = await fetch(`${baseUrl}/nosuchdomain/mcp`, {
          method: "POST",
          headers: MCP_HEADERS,
          body: jsonBodyOfSize(2 * 1024 * 1024),
        });
        expect(res.status).toBe(413);
      } finally {
        close();
      }
    },
  );

  /**
   * `""` fails closed rather than open (body-parser's `|| '100kb'`), but it
   * still silently disagrees with the documented 1mb default. Asserting the
   * documented behaviour keeps that from drifting back.
   */
  it("uses the documented 1mb default — not body-parser's 100kb — when set but empty", async () => {
    process.env.MCP_GATEWAY_MAX_BODY = "";
    const { baseUrl, close } = await startApp();
    try {
      const res = await fetch(`${baseUrl}/nosuchdomain/mcp`, {
        method: "POST", headers: MCP_HEADERS, body: jsonBodyOfSize(300 * 1024),
      });
      expect(res.status).toBe(404); // 300kb is under 1mb; body-parser would have 413'd at 100kb
    } finally {
      close();
    }
  });

  /**
   * The other direction of the same root cause. "1mib" resolves to ONE BYTE
   * under bytes.parse, so before the fix even a tiny legitimate request is
   * refused — the gateway is down and the reason is a typo nobody logged.
   */
  it("still serves a small request when MCP_GATEWAY_MAX_BODY is the 'mib' typo", async () => {
    process.env.MCP_GATEWAY_MAX_BODY = "1mib";
    const { baseUrl, close } = await startApp();
    try {
      const res = await fetch(`${baseUrl}/nosuchdomain/mcp`, {
        method: "POST",
        headers: MCP_HEADERS,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      });
      expect(res.status).toBe(404); // routed, not 413 — the body was accepted
    } finally {
      close();
    }
  });

  it("honours a valid explicit cap, in both directions", async () => {
    process.env.MCP_GATEWAY_MAX_BODY = "20kb";
    const { baseUrl, close } = await startApp();
    try {
      const under = await fetch(`${baseUrl}/nosuchdomain/mcp`, {
        method: "POST", headers: MCP_HEADERS, body: jsonBodyOfSize(1024),
      });
      expect(under.status).toBe(404);

      const over = await fetch(`${baseUrl}/nosuchdomain/mcp`, {
        method: "POST", headers: MCP_HEADERS, body: jsonBodyOfSize(64 * 1024),
      });
      expect(over.status).toBe(413);
    } finally {
      close();
    }
  });

  it("caps at the 1mb default when the var is unset", async () => {
    delete process.env.MCP_GATEWAY_MAX_BODY;
    const { baseUrl, close } = await startApp();
    try {
      const res = await fetch(`${baseUrl}/nosuchdomain/mcp`, {
        method: "POST", headers: MCP_HEADERS, body: jsonBodyOfSize(2 * 1024 * 1024),
      });
      expect(res.status).toBe(413);
    } finally {
      close();
    }
  });
});
