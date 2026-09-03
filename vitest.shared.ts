import { defineConfig, type UserConfig } from 'vitest/config';

/**
 * Shared vitest config factory for the 13 bconnect-*-mcp servers.
 *
 * Before this factory existed, every server carried a byte-identical copy of
 * this config (OPT-11 in EVAL-2026-08-02.md) — any future change (a new
 * exclude pattern, a compiler flag) required touching all 13 files, and
 * history shows that kind of 13-file edit gets applied unevenly.
 *
 * `thresholds` is intentionally NOT defaulted to the aspirational 60% target
 * here. That number is declared in every server's config but was never
 * enforced by CI (QA-2/QA-5 in the eval), so measured coverage had silently
 * drifted to single digits in some servers while a fictional 60% sat in the
 * file. Each server now passes its own CURRENT measured floor explicitly —
 * see the coverageRatchet comment in each per-server vitest.config.ts.
 * Raise a server's number only after you've added tests that justify it.
 * The mock-integration tier does NOT govern these floors — see the measured
 * note beside coverage.exclude below, which retired that claim on 2026-08-19.
 */
/**
 * The per-test timeout, for EVERY vitest run in this repo.
 *
 * ── Why it is not vitest's 5,000 ms default ─────────────────────────────────
 * Three tests were found failing on load rather than on anything they assert.
 * `v11-audit > every named v2.0 candidate is a tool the suite actually
 * advertises` turned a gate run RED at 5,300 ms; its sibling ran 3,207 ms on
 * the same run; `composite-time-budget` came in at 4,930 ms — 70 ms inside the
 * limit. An intermittently-red gate is how a real failure gets waved through,
 * and it already did once: commit `a4e1ff5` landed against a red suite.
 *
 * ── What the measurement actually said, which is not what was expected ──────
 * Ranked over THREE dedicated full-suite runs (2,405 tests), the worst
 * unpinned test reaches 1,466 ms — 29% of the default — and run-to-run spread
 * is 1.0-1.5x. On a quiet machine NOTHING is close to the limit, and an audit
 * that ranked one quiet run would have reported the suite healthy and stopped.
 *
 * The variance is not inside the suite. It is the MACHINE: the test that
 * failed at 5,300 ms maxes at 1,625 ms across the three dedicated runs, a
 * 3.26x load multiplier, because that gate shared the box with other work.
 * Apply that measured multiplier to the quiet figures and two currently
 * unpinned tests enter the danger zone —
 * `suite-tool-names > has no colliding tool name` at ~4,780 ms (96% of the
 * default) and `security-posture-time-budget` at ~3,940 ms.
 *
 * That is why this is one global number and not more per-test pins. The
 * multiplier applies to every test equally, so pinning the ones observed to
 * fail is whack-a-mole against a property of the host.
 *
 * ── The precedent, from this repo's own coverage floor ──────────────────────
 * The root config already reasons this way about a value that moves for
 * reasons unrelated to what it measures: "a floor set close to either figure
 * would be flaky, and a flaky floor gets disabled". Same disease. 30,000 ms is
 * ~11x the worst quiet observation and ~3.6x the worst loaded estimate, which
 * puts it beyond where host load can reach.
 *
 * This does NOT weaken a performance check, because vitest's timeout was never
 * one — it is a hang detector. Actual time budgets in this suite are asserted
 * explicitly through `BCONNECT_COMPOSITE_BUDGET_MS` and are unaffected.
 *
 * ── Why it lives here and is imported by the ROOT config too ────────────────
 * The root `vitest.config.ts` is hand-written and does NOT call the factory
 * below, and `npm test` runs at the root. Setting a timeout in only one of
 * them would reproduce the `unstubEnvs` defect that file documents: a setting
 * present in one config, absent in the run that actually matters. One exported
 * constant, imported by both, makes divergence impossible rather than merely
 * guarded against.
 */
export const TEST_TIMEOUT_MS = 30_000;

export function createServerVitestConfig(
  thresholds: { statements: number; lines: number },
  overrides: UserConfig = {}
): UserConfig {
  return defineConfig({
    test: {
      // See TEST_TIMEOUT_MS above. Not vitest's 5 s default, because three
      // tests were measured failing on host load rather than on their subject.
      testTimeout: TEST_TIMEOUT_MS,
      // Exclude mock-integration tier — those tests run against a live mock
      // and are invoked via the dedicated `test:mock` script
      // (vitest.mock.config.ts).
      exclude: ['**/node_modules/**', '**/build/**', '**/mock-integration/**'],
      env: {
        NODE_ENV: 'test',
        VITEST: 'true',
      },
      // FOLLOW-UPS.md P2-2: `vi.stubEnv` is used across 20+ test files in every
      // server, and none of them restored the env var by hand in every case —
      // some did, most relied on this. Without it, a stub from one test file
      // can leak into the next file that runs in the same worker. This runs
      // `vi.unstubAllEnvs()` after every test automatically; for the tests that
      // already save/restore by hand it is redundant, not harmful.
      unstubEnvs: true,
      // ── What these floors do NOT depend on, measured 2026-08-19 ───────────
      // Twelve per-server configs used to say the real target returns "once
      // the mock-integration tier (where the module logic lives) is wired into
      // CI". The module logic does not live there, and the floors were never
      // blocked on that wiring.
      //
      // Measured across all sixteen workspaces: EVERY one has exactly ONE
      // mock-tier file, the ones passing their floors and the ones failing
      // alike. The workspaces with high module coverage get it from the
      // DEFAULT tier — jobs 96.3%, compliance 94.13%, endpoints 86.26%. What
      // tracked module coverage was default-tier test-file count: 20-22 files
      // gave 86-96%, 4-6 files gave 10-20%. The mock tier was covering the
      // modules nowhere.
      //
      // Demonstrated rather than argued: software went 41.97% -> 89.01% and
      // universaldynamicgroups 46.55% -> 98.27%, both with their modules at
      // 100%, using a fake AxiosInstance and no mock server at all.
      // bConnect-Mock is an external HTTP service on port 13433 that this
      // repository does not contain; no floor may depend on it.
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        exclude: [
          'node_modules/',
          'src/generated/**', // Exclude OpenAPI-generated types
          'src/__tests__/**', // Exclude test files themselves
          'src/__mocks__/**', // Exclude mock data
          '**/*.d.ts', // Exclude type definitions
          'build/**', // Exclude build output
          'src/index.ts', // Exclude MCP server entry point (Phase 2 E2E tests)
          // Vitest's own config files are not source. They were being counted
          // as 0%-covered source in every workspace. Measured on assets: 4
          // statements of 327, worth 0.7 points (56.57 -> 57.27) — small, and
          // correct regardless of size, since a config file is not source.
          // Removing 0%-covered files can only raise a percentage, so no
          // workspace can newly fail because of this.
          '**/vitest.config.ts',
          '**/vitest.mock.config.ts',
          '**/vitest.shared.ts',
        ],
        thresholds,
      },
      ...overrides.test,
    },
    ...overrides,
  });
}
