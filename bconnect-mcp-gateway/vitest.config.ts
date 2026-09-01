import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/build/**"],
    env: {
      NODE_ENV: "test",
      VITEST: "true",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "build/**", "src/__tests__/**", "**/*.d.ts"],
      // Coverage ratchet (REL-4 / QA-1). The gateway is the only component in
      // the suite that listens on a socket, and it was the only workspace with
      // no enforced floor anywhere: all 13 servers pin one through
      // createServerVitestConfig, but this config had no `thresholds` key at
      // all, and both coverage loops iterate `bconnect-*-mcp` — a glob this
      // workspace's name never matches. So a regression here would have failed
      // nothing.
      //
      // Pinned to the CURRENT measured floor, not an aspirational number.
      // Measured with `npx vitest run --coverage` on 2026-08-04: 88.68%
      // statements / 91.01% branches / 95.23% functions / 88.68% lines, with
      // gateway.ts and preload.ts at 0 (a top-level script with process.exit()
      // in it and a two-line preload; what gateway.ts decides is tested through
      // startup-config.ts, and that it WIRES those decisions is asserted as
      // text in startup-config.test.ts). Floor set ~3 points under, the same
      // rule the servers follow: raise it only behind tests that justify it.
      thresholds: { statements: 85, lines: 85, branches: 87, functions: 92 },
    },
  },
});
