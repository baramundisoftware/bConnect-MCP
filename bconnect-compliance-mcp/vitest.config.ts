import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
