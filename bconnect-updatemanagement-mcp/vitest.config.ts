import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude mock-integration tier — those tests run against a live mock and
    // are invoked via the dedicated `test:mock` script (vitest.mock.config.ts).
    exclude: ['**/node_modules/**', '**/build/**', '**/mock-integration/**'],
    env: {
      NODE_ENV: 'test',
      VITEST: 'true'
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/generated/**',
        'src/__tests__/**',
        '**/*.d.ts',
        'build/**',
        'src/index.ts',
      ],
      thresholds: {
        statements: 60,
        lines: 60,
      }
    }
  }
});
