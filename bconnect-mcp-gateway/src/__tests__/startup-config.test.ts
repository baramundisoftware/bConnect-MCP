/**
 * bconnect-mcp-gateway — startup configuration validation (SEC-1).
 *
 * The finding this suite exists for: the gateway ran NONE of runServer's
 * startup guards. preload.ts sets VITEST so that importing thirteen server
 * modules does not start thirteen stdio transports, and `shouldAutoStart()`
 * gates on VITEST being undefined — so runServer never executed in the one
 * component that listens on a socket, and the http:// clear-text refusal, the
 * missing-credential exit and the 26R1 version gate were all silently absent.
 * A gateway pointed at an http:// bMS started happily and put the API key on
 * the wire in clear text with no warning and no opt-out.
 *
 * `runStartupChecks` is the whole sequence gateway.ts runs, with the reporting
 * and the probe injected — the same arrangement `evaluateBindPosture` uses, and
 * for the same reason: gateway.ts calls process.exit(), which cannot be
 * exercised from a test without taking the runner with it. The last suite here
 * asserts gateway.ts actually calls it, because "the check exists but nothing
 * invokes it" is precisely what SEC-1 was.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ConnectionProbe } from "@bconnect/mcp-core";

import {
  evaluateConnectivity,
  evaluateStartupConfig,
  runStartupChecks,
  type StartupProbeClient,
} from "../startup-config.js";

/** A credential-complete https:// environment — the shape that should start. */
const GOOD_ENV = {
  BCONNECT_BASE_URL: "https://bms.internal.example/bconnect",
  BCONNECT_API_KEY: "not-a-real-key-0123456789",
} satisfies NodeJS.ProcessEnv;

/** A client double that reports what a real one learned from its probe. */
function probeClient(probe: ConnectionProbe | undefined, reachable = true): StartupProbeClient {
  return {
    testConnection: async () => reachable,
    getConnectionProbe: () => probe,
  };
}

/** Collect every reported line by level. */
function sinks() {
  const lines = { error: [] as string[], warn: [] as string[], info: [] as string[] };
  return {
    lines,
    error: (l: string) => lines.error.push(l),
    warn: (l: string) => lines.warn.push(l),
    info: (l: string) => lines.info.push(l),
    all: () => [...lines.error, ...lines.warn, ...lines.info].join("\n"),
  };
}

// ─── The scheme refusal ──────────────────────────────────────────────────────

describe("SEC-1 — an http:// base URL is refused", () => {
  it("refuses to start when BCONNECT_BASE_URL uses http://", () => {
    const verdict = evaluateStartupConfig({
      ...GOOD_ENV,
      BCONNECT_BASE_URL: "http://bms.internal.example/bconnect",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/CLEAR ?TEXT/i);
  });

  it("names the opt-out in the refusal, so the way out is discoverable", () => {
    const verdict = evaluateStartupConfig({
      ...GOOD_ENV,
      BCONNECT_BASE_URL: "http://bms.internal.example/bconnect",
    });
    expect(verdict.detail.join("\n")).toContain("BCONNECT_ALLOW_INSECURE_HTTP=true");
  });

  it("proceeds — loudly — when BCONNECT_ALLOW_INSECURE_HTTP=true", () => {
    const verdict = evaluateStartupConfig({
      ...GOOD_ENV,
      BCONNECT_BASE_URL: "http://bms.internal.example/bconnect",
      BCONNECT_ALLOW_INSECURE_HTTP: "true",
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.warnings.join("\n")).toMatch(/CLEAR ?TEXT/i);
  });

  it("does not accept a value other than the literal 'true' as the opt-out", () => {
    for (const optOut of ["1", "yes", "TRUE", ""]) {
      const verdict = evaluateStartupConfig({
        ...GOOD_ENV,
        BCONNECT_BASE_URL: "http://bms.internal.example/bconnect",
        BCONNECT_ALLOW_INSECURE_HTTP: optOut,
      });
      expect(verdict.ok, `BCONNECT_ALLOW_INSECURE_HTTP='${optOut}' must not permit http://`).toBe(false);
    }
  });

  it("says nothing about the scheme for an https:// base URL", () => {
    const verdict = evaluateStartupConfig(GOOD_ENV);
    expect(verdict.ok).toBe(true);
    expect(verdict.warnings).toEqual([]);
  });

  it("matches the scheme case-insensitively — HTTP:// is still clear text", () => {
    const verdict = evaluateStartupConfig({
      ...GOOD_ENV,
      BCONNECT_BASE_URL: "HTTP://bms.internal.example/bconnect",
    });
    expect(verdict.ok).toBe(false);
  });
});

// ─── The credential refusals ─────────────────────────────────────────────────

describe("SEC-1 — the credential checks the stdio path performs", () => {
  it("refuses a missing BCONNECT_BASE_URL, with no placeholder fallback", () => {
    const verdict = evaluateStartupConfig({ BCONNECT_API_KEY: "not-a-real-key-0123456789" });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("BCONNECT_BASE_URL is required");
  });

  it("refuses when neither an API key nor a username/password pair is present", () => {
    const verdict = evaluateStartupConfig({ BCONNECT_BASE_URL: "https://bms.internal.example/bconnect" });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("BCONNECT_API_KEY");
  });

  it("refuses a half-configured username with no password", () => {
    const verdict = evaluateStartupConfig({
      BCONNECT_BASE_URL: "https://bms.internal.example/bconnect",
      BCONNECT_USERNAME: "svc-mcp",
    });
    expect(verdict.ok).toBe(false);
  });

  it("accepts a username/password pair", () => {
    const verdict = evaluateStartupConfig({
      BCONNECT_BASE_URL: "https://bms.internal.example/bconnect",
      BCONNECT_USERNAME: "svc-mcp",
      BCONNECT_PASSWORD: "not-a-real-password",
    });
    expect(verdict.ok).toBe(true);
  });
});

// ─── The 26R1 version gate (VER-1) ───────────────────────────────────────────

describe("SEC-1 — the 26R1 version gate docker-compose.gateway.yml advertises", () => {
  it("refuses a bMS below 26R1", async () => {
    const verdict = await evaluateConnectivity(
      probeClient({ outcome: "version", version: "25R2" }),
      GOOD_ENV.BCONNECT_BASE_URL,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.lines.map((l) => l.text).join("\n")).toContain(
      "requires baramundi Management Suite 26R1",
    );
  });

  it("starts against 26R1", async () => {
    const verdict = await evaluateConnectivity(
      probeClient({ outcome: "version", version: "26R1" }),
      GOOD_ENV.BCONNECT_BASE_URL,
    );
    expect(verdict.ok).toBe(true);
  });

  it("proceeds when the probe was skipped, and says the gate went with it", async () => {
    const verdict = await evaluateConnectivity(
      probeClient({ outcome: "skipped" }),
      GOOD_ENV.BCONNECT_BASE_URL,
    );
    expect(verdict.ok).toBe(true);
    const text = verdict.lines.map((l) => l.text).join("\n");
    expect(text).toMatch(/version gate is skipped/);
    // The skip path makes testConnection() true WITHOUT any request, and this
    // used to say "verified" anyway — the contradiction "API connectivity
    // verified." + "startup probe skipped" was live on every server log of the
    // reference deployment. The line must say what happened.
    expect(text).toContain("connectivity check SKIPPED");
    expect(text).toContain("nothing was verified");
    expect(text).not.toContain("API connectivity verified");
  });

  it("refuses when bConnect cannot be reached at all", async () => {
    const verdict = await evaluateConnectivity(
      probeClient(undefined, false),
      GOOD_ENV.BCONNECT_BASE_URL,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.lines.map((l) => l.text).join("\n")).toContain("cannot reach bConnect API");
  });
});

// ─── The sequence gateway.ts runs ────────────────────────────────────────────

describe("SEC-1 — runStartupChecks, end to end", () => {
  it("refuses http:// WITHOUT ever building a client, so nothing goes on the wire", async () => {
    const sink = sinks();
    const build = vi.fn(() => probeClient({ outcome: "version", version: "26R1" }));
    const result = await runStartupChecks({
      env: { ...GOOD_ENV, BCONNECT_BASE_URL: "http://bms.internal.example/bconnect" },
      error: sink.error,
      warn: sink.warn,
      info: sink.info,
      probeClient: build,
    });
    expect(result.ok).toBe(false);
    expect(sink.lines.error.join("\n")).toMatch(/CLEAR ?TEXT/i);
    // The credential is resolved when the client is built. A refused
    // configuration must not get that far.
    expect(build).not.toHaveBeenCalled();
  });

  it("proceeds with the opt-out set, and warns on the way past", async () => {
    const sink = sinks();
    const result = await runStartupChecks({
      env: {
        ...GOOD_ENV,
        BCONNECT_BASE_URL: "http://bms.internal.example/bconnect",
        BCONNECT_ALLOW_INSECURE_HTTP: "true",
      },
      error: sink.error,
      warn: sink.warn,
      info: sink.info,
      probeClient: () => probeClient({ outcome: "version", version: "26R1" }),
    });
    expect(result.ok).toBe(true);
    expect(sink.lines.warn.join("\n")).toMatch(/CLEAR ?TEXT/i);
    expect(sink.lines.error).toEqual([]);
  });

  it("refuses an old bMS through the same path", async () => {
    const sink = sinks();
    const result = await runStartupChecks({
      env: GOOD_ENV,
      error: sink.error,
      warn: sink.warn,
      info: sink.info,
      probeClient: () => probeClient({ outcome: "version", version: "25R2" }),
    });
    expect(result.ok).toBe(false);
    expect(sink.all()).toContain("requires baramundi Management Suite 26R1");
  });

  it("starts on a good configuration and reports the probe", async () => {
    const sink = sinks();
    const result = await runStartupChecks({
      env: GOOD_ENV,
      error: sink.error,
      warn: sink.warn,
      info: sink.info,
      probeClient: () => probeClient({ outcome: "version", version: "26R1" }),
    });
    expect(result.ok).toBe(true);
    expect(sink.lines.info.join("\n")).toContain("API connectivity verified");
  });

  it("skips the probe when no client can be built, rather than refusing", async () => {
    const sink = sinks();
    const result = await runStartupChecks({
      env: GOOD_ENV,
      error: sink.error,
      warn: sink.warn,
      info: sink.info,
      probeClient: () => undefined,
    });
    expect(result.ok).toBe(true);
  });

  it("evaluates no version gate for a client that cannot report a probe", async () => {
    const verdict = await evaluateConnectivity(
      { testConnection: async () => true },
      GOOD_ENV.BCONNECT_BASE_URL,
    );
    expect(verdict.ok).toBe(true);
  });
});

// ─── The wiring, which is what was actually missing ──────────────────────────
//
// Every assertion above passed against the pre-fix tree too, because the
// functions they exercise are the ones runServer already had. What SEC-1 was is
// that NOTHING IN THE GATEWAY CALLED THEM. gateway.ts is a top-level script
// with a process.exit() in it, so it is asserted as text — the same technique
// deployment.test.ts uses on the shipped compose file, for the same reason.

describe("SEC-1 — gateway.ts runs the checks before it binds", () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(resolve(HERE, "..", "gateway.ts"), "utf8");

  it("calls runStartupChecks", () => {
    expect(source).toMatch(/await runStartupChecks\(/);
  });

  it("hands it a real client to probe with", () => {
    expect(source).toMatch(/probeClient:/);
    expect(source).toMatch(/getClient/);
  });

  it("exits rather than binding when the checks refuse", () => {
    const refusal = /if\s*\(!startup\.ok\)\s*\{\s*process\.exit\(1\);/;
    expect(source).toMatch(refusal);
    // Order matters as much as presence: createApp() must come after.
    expect(source.search(refusal)).toBeLessThan(source.indexOf("createApp()"));
  });
});
