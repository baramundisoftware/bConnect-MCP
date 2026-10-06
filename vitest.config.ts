import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The shipped workspaces whose code coverage measures: the shared core, the 13
// servers and the gateway. The template is not shipped. `bconnect-*-mcp`
// matches the 13 servers only (the gateway ends in `-gateway`), so the gateway
// and the core are named on their own. `__tests__/coverage-config.guard.test.ts`
// fails when a workspace on disk is missing here or has no floor below.
export const COVERAGE_INCLUDE = [
  'packages/mcp-core/src/**/*.ts',
  'bconnect-*-mcp/src/**/*.ts',
  'bconnect-mcp-gateway/src/**/*.ts',
];

export default defineConfig({
  resolve: {
    // Servers import the core by package name, which resolves to its BUILD.
    // Run through that, core code never counts towards coverage. In this
    // (unit) run the name points at the core's source instead, so every test
    // exercises the same copy and the report shows it. Child-process tests
    // start built servers with node and are not affected.
    // Exact match only: a string key would also rewrite `@bconnect/mcp-core/x`.
    alias: [
      {
        find: /^@bconnect\/mcp-core$/,
        replacement: fileURLToPath(new URL('./packages/mcp-core/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    // Exclude mock-integration tier — those tests run against a live mock and
    // are invoked via the per-server `test:mock` script (vitest.mock.config.ts).
    // Each server has its own opt-in entry point; root `npm test` is unit-tier only.
    // The live tier talks to a real bMS: `npm run test:live` only. Its self-tests
    // (__tests__/live/*.selftest.test.ts) need no bMS and run here.
    exclude: ['**/node_modules/**', '**/build/**', '**/mock-integration/**', '__tests__/live/bms-live.test.ts'],
    // Note: MSW setup file DISABLED for E2E tests (they manage their own MSW lifecycle)
    // E2E tests in __tests__/e2e/ create their own MSW server instances
    // Integration tests should use setupFiles: ['./src/__tests__/setup/msw.ts']
    // setupFiles: ['./src/__tests__/setup/msw.ts'],  // Commented out to prevent conflicts with E2E tests
    // Set environment variables for tests (needed to disable HTTPS agent for MSW)
    env: {
      NODE_ENV: 'test',
      VITEST: 'true'
    },
    // `npm run test:coverage`: one run over every shipped workspace, entry
    // points included. CI runs it and fails below a floor.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      include: COVERAGE_INCLUDE,
      exclude: [
        '**/__tests__/**',         // Tests themselves
        '**/generated/**',         // OpenAPI-generated types
        '**/*.d.ts',
      ],
      // Floors, in %. Each workspace's is 2 points under what it achieved when
      // it was set (measured value in the comment). Raise a floor when coverage
      // rises; lower one only with a reason in the PR. The total counts every
      // file, including those matched by a workspace glob.
      thresholds: {
        lines: 94, // 96.14
        branches: 83, // 85.95
        'packages/mcp-core/src/**': { lines: 88, branches: 83 }, // 90.85 / 85.62
        'bconnect-mcp-gateway/src/**': { lines: 76, branches: 71 }, // 78.23 / 73.75
        'bconnect-activedirectory-mcp/src/**': { lines: 98, branches: 81 }, // 100 / 83.10
        'bconnect-assets-mcp/src/**': { lines: 98, branches: 84 }, // 100 / 86.73
        'bconnect-compliance-mcp/src/**': { lines: 98, branches: 88 }, // 100 / 90.70
        'bconnect-defensecontrol-mcp/src/**': { lines: 95, branches: 89 }, // 97.26 / 91.67
        'bconnect-endpoints-mcp/src/**': { lines: 96, branches: 89 }, // 98.24 / 91.08
        'bconnect-groups-mcp/src/**': { lines: 98, branches: 65 }, // 100 / 67.31
        'bconnect-jobs-mcp/src/**': { lines: 97, branches: 78 }, // 99.10 / 80.77
        'bconnect-operatingsystems-mcp/src/**': { lines: 98, branches: 91 }, // 100 / 93.75
        'bconnect-servermanagement-mcp/src/**': { lines: 98, branches: 94 }, // 100 / 96.51
        'bconnect-software-mcp/src/**': { lines: 98, branches: 91 }, // 100 / 93.24
        'bconnect-universaldynamicgroups-mcp/src/**': { lines: 98, branches: 86 }, // 100 / 88.89
        'bconnect-updatemanagement-mcp/src/**': { lines: 98, branches: 91 }, // 100 / 93.75
        'bconnect-variables-mcp/src/**': { lines: 98, branches: 91 }, // 100 / 93.48
      },
    },
  },
});
