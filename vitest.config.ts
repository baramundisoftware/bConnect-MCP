import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Note: MSW setup file DISABLED for E2E tests (they manage their own MSW lifecycle)
    // E2E tests in __tests__/e2e/ create their own MSW server instances
    // Integration tests should use setupFiles: ['./src/__tests__/setup/msw.ts']
    // setupFiles: ['./src/__tests__/setup/msw.ts'],  // Commented out to prevent conflicts with E2E tests
    // Set environment variables for tests (needed to disable HTTPS agent for MSW)
    env: {
      NODE_ENV: 'test',
      VITEST: 'true'
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/generated/**',        // Exclude OpenAPI-generated types
        'src/__tests__/**',        // Exclude test files themselves
        'src/__mocks__/**',        // Exclude mock data
        '**/*.d.ts',               // Exclude type definitions
        'build/**',                // Exclude build output
        'src/index.ts',            // Exclude MCP server entry point (Phase 2 E2E tests)
      ],
      thresholds: {
        statements: 60,            // 60% coverage target for API modules
        lines: 60,
        // Skip branch and function thresholds for Phase 1
      }
    }
  }
});
