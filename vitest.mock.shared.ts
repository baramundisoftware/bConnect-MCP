import { fileURLToPath } from 'node:url';
import { defineConfig, type UserConfig } from 'vitest/config';

/**
 * Shared mock-integration vitest config factory for the bconnect-*-mcp servers.
 * Was previously a byte-identical file in each server (OPT-11 in
 * EVAL-2026-08-02.md). Exercises the BConnectClient against a bConnect mock.
 * Run separately from unit tests via `npm run test:mock`.
 *
 * SKIP BEHAVIOUR, and why it is no longer unconditional (2026-08-22). The tests
 * skip themselves when the mock is unreachable, so this config stays safe to
 * invoke where no mock runs. But "skipped" and "passed" exited identically —
 * `vitest run` returns 0 for a file whose every test skipped — so a CI job
 * whose mock never started reported success. `BCONNECT_MOCK_REQUIRED=true`
 * makes that state a hard failure instead; see vitest.mock.globalsetup.ts.
 */
const GLOBAL_SETUP = fileURLToPath(new URL('./vitest.mock.globalsetup.ts', import.meta.url));

export function createServerVitestMockConfig(overrides: UserConfig = {}): UserConfig {
  return defineConfig({
    test: {
      include: ['src/__tests__/mock-integration/**/*.test.ts'],
      env: { NODE_ENV: 'test', VITEST: 'true' },
      testTimeout: 15000,
      globalSetup: [GLOBAL_SETUP],
      ...overrides.test,
    },
    ...overrides,
  });
}
