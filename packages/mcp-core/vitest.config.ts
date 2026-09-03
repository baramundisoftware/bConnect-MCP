import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Coverage floor for the shared kernel.
 *
 * ── Why this file did not exist, and why that mattered ──────────────────────
 * Every one of the 13 servers pins a measured floor through
 * `createServerVitestConfig`, and the gateway pins its own. `packages/mcp-core`
 * had no vitest config at all — so it was the one workspace with no floor
 * anywhere, by the same silent mechanism that hid the gateway: both coverage
 * loops iterate `bconnect-*-mcp`, and neither `packages/mcp-core` nor
 * `bconnect-mcp-gateway` is a name that glob can produce. Nobody excluded it.
 *
 * It is also the workspace where an uncovered line costs the most: path-guard,
 * security-routes, parameter-redaction, serialize-outbound-trust, absent-data
 * and count-only all live here, and all 13 servers link against them, so a
 * regression here is a regression everywhere at once.
 *
 * ── The number was measuring the wrong tree. CORRECTED 2026-08-19. ──────────
 * This header used to explain a floor of 17 against a measured 19.68%, and the
 * explanation was wrong in a way that mattered:
 *
 *   "The tests here import `@bconnect/mcp-core`, which package.json `main`
 *    resolves to `build/` — so what executes is the compiled output and what is
 *    reported is the source it maps back to."
 *
 * The first half was true and the second was not. Execution was NOT attributed
 * back to source. Measured in isolation: `__tests__/paginate.test.ts` runs seven
 * tests straight through `paginateAll` and reported `src/paginate.ts` at **0%**,
 * lines 89-178 uncovered. What the report showed was source files loaded through
 * the barrel and never credited with the work their compiled twins did.
 *
 * The `resolve.alias` below points the package specifier at `src/index.ts`, so
 * the 24 test files instrument the TypeScript they are actually testing. Same
 * 525 tests, all passing, and the measurement stops being an artefact:
 *
 *                    before        after
 *   statements       27.68%        73.87%
 *   branches         94 total      1,088 total
 *
 * The old header called 94 branches "not a credible count of this code's
 * branching" and declined to pin a floor against it. That judgement was right;
 * this was the cause, and it is fixed. `path-guard.ts` reads 92.24% rather than
 * 13.79%, and `result-trust.ts` 77% rather than 14.7% — the kernel was always
 * far better tested than the number said.
 *
 * ── What this alias does and does not change ────────────────────────────────
 * It applies to THIS package's own suite only. The 13 servers still import
 * `@bconnect/mcp-core` unaliased, so their suites continue to exercise the
 * compiled `build/` output — the shipped artefact is still covered, by more
 * tests than run here. What changes is that this package's own tests no longer
 * need a rebuild to see a source edit, which removes the "rebuild, then run"
 * trap for this one workspace.
 *
 * ── The floor ───────────────────────────────────────────────────────────────
 * A floor is a ratchet, not a wish: pinned a few points under measured, the same
 * rule the servers follow. Raise it behind tests that justify it. Branches are
 * pinned now too, conservatively, because the count finally means something.
 *
 * Genuinely thin, and the honest list: `response-cache.ts` 0.72%,
 * `bulk-operations.ts` 3.12%, `v11-client.ts` 14.64%, `cache-provenance.ts` 15%,
 * `date-age.ts` 28.57%, `job-state.ts` 50%, `absent-data.ts` 52.77%. Those are
 * exercised through the servers' own suites, which this per-package run does not
 * see — a reason to read the number carefully, not a reason to raise it without
 * tests.
 */
export default defineConfig({
  resolve: {
    alias: {
      // Point the package specifier at SOURCE for this suite. Without it the
      // tests execute `build/` and the coverage report describes files nothing
      // ran. See the header.
      '@bconnect/mcp-core': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/build/**'],
    env: {
      NODE_ENV: 'test',
      VITEST: 'true',
    },
    // Same reason as vitest.shared.ts: `vi.stubEnv` is used across these
    // suites and a stub can otherwise leak into the next file in the worker.
    unstubEnvs: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'build/**', // compiled output; the alias above means src is what runs
        '__tests__/**', // the tests themselves
        '**/*.d.ts',
        'src/index.ts', // a barrel of `export *` with no behaviour of its own
        // This file. The shared config excludes vitest configs for the 13
        // servers; this package does not use createServerVitestConfig, so it
        // inherited nothing and was counting its own config as 0% source.
        'vitest.config.ts',
      ],
      thresholds: { statements: 70, lines: 70, branches: 80 },
    },
  },
});
