/**
 * bconnect-groups-mcp — unified bootstrap (finding OPT-32)
 *
 * Three properties, none of which this server had before the change and none of
 * which any of the 89 pre-existing test files asserted:
 *
 *  1. `createServer()` hands back the memoised client provider, so the startup
 *     connectivity check and tool dispatch cannot use different clients. Before,
 *     it returned `{ server }` and the hand-written main() built a throwaway.
 *  2. The startup probe calls `testConnection()` on *that* instance. Asserted by
 *     object identity, not by counting calls.
 *  3. BCONNECT_BASE_URL has no default. The old bootstrap fell back to
 *     `https://bms.example.com:443/bconnect` and would have transmitted real
 *     credentials to it; the check must fail before any client is constructed.
 *
 * No network: the probe is stubbed and the failure paths all exit before a
 * transport is opened.
 */

import { describe, it, expect, vi } from "vitest";
import { runServer, shouldAutoStart, rejectUnauthorizedFromEnv, parsePort } from "@bconnect/mcp-core";
import { createServer } from "../index.js";

const CREDS = {
  baseUrl: "https://bootstrap.invalid/bconnect",
  username: "u",
  password: "p",
};

/** `exit` must not return; throwing is how a test observes it. */
class Exited extends Error {
  constructor(readonly code: number) {
    super(`exit(${code})`);
  }
}
const exit = ((code: number) => {
  throw new Exited(code);
}) as (code: number) => never;

function harness(): { lines: string[]; log: (line: string) => void } {
  const lines: string[] = [];
  return { lines, log: (line: string) => lines.push(line) };
}

describe("bconnect-groups-mcp bootstrap", () => {
  it("exposes the memoised client provider from createServer", () => {
    const handle = createServer(CREDS);
    expect(typeof handle.getClient).toBe("function");
    // Memoised: the same instance, not a fresh client per call. This is the
    // property that made the rate limiter's sliding window survive (finding B8).
    expect(handle.getClient()).toBe(handle.getClient());
  });

  it("probes the client tool dispatch will use, by identity", async () => {
    const { lines, log } = harness();
    let probed: unknown;

    await expect(
      runServer({
        name: "bconnect-groups-mcp",
        createServer: (credentials) => {
          const handle = createServer(credentials);
          probed = handle.getClient();
          // False, so runServer exits before opening a transport. A resolved
          // `true` would connect StdioServerTransport to the test process.
          vi.spyOn(probed as { testConnection: () => Promise<boolean> }, "testConnection")
            .mockResolvedValue(false);
          return handle;
        },
        env: {
          BCONNECT_BASE_URL: "https://bootstrap.invalid/bconnect",
          BCONNECT_USERNAME: "u",
          BCONNECT_PASSWORD: "p",
        },
        log,
        exit,
        skipDotenv: true,
      })
    ).rejects.toBeInstanceOf(Exited);

    expect((probed as { testConnection: unknown }).testConnection).toHaveBeenCalledTimes(1);
    expect(lines.join("\n")).toContain("cannot reach bConnect API at https://bootstrap.invalid/bconnect");
  });

  it("refuses to start with no BCONNECT_BASE_URL rather than defaulting to bms.example.com", async () => {
    const { lines, log } = harness();
    let built = false;

    await expect(
      runServer({
        name: "bconnect-groups-mcp",
        createServer: () => {
          built = true;
          return createServer(CREDS);
        },
        env: { BCONNECT_USERNAME: "u", BCONNECT_PASSWORD: "p" },
        log,
        exit,
        skipDotenv: true,
      })
    ).rejects.toBeInstanceOf(Exited);

    // The point of the finding: nothing is constructed, so nothing is transmitted.
    expect(built).toBe(false);
    expect(lines.join("\n")).toContain("BCONNECT_BASE_URL is required and has no default");
    expect(lines.join("\n")).not.toContain("bms.example.com");
  });

  it("exits 1 on missing credentials instead of throwing a stack trace", async () => {
    const { lines, log } = harness();
    await expect(
      runServer({
        name: "bconnect-groups-mcp",
        createServer: () => createServer(CREDS),
        env: { BCONNECT_BASE_URL: "https://bootstrap.invalid/bconnect" },
        log,
        exit,
        skipDotenv: true,
      })
    ).rejects.toMatchObject({ code: 1 });

    expect(lines[0]).toBe(
      "bconnect-groups-mcp: Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required"
    );
  });

  it("uses the shared guards rather than this server's old inline forms", () => {
    // Difference 5: `VITEST=0` used to defeat `!process.env.VITEST` and dial out
    // mid-suite. Difference 4: two env knobs, one resolver.
    expect(shouldAutoStart({ VITEST: "0" } as NodeJS.ProcessEnv)).toBe(false);
    expect(shouldAutoStart({} as NodeJS.ProcessEnv)).toBe(true);
    expect(rejectUnauthorizedFromEnv({ NODE_TLS_REJECT_UNAUTHORIZED: "0" } as NodeJS.ProcessEnv)).toBe(false);
    expect(rejectUnauthorizedFromEnv({ BCONNECT_REJECT_UNAUTHORIZED: "false" } as NodeJS.ProcessEnv)).toBe(false);
    expect(rejectUnauthorizedFromEnv({} as NodeJS.ProcessEnv)).toBe(true);
    // `parseInt("http")` is NaN and `listen(NaN)` binds an arbitrary free port.
    expect(parsePort("http")).toBeNull();
    expect(parsePort(undefined)).toBe(3000);
  });
});
