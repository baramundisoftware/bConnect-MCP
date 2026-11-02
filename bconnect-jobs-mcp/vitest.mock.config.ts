import { defineConfig } from 'vitest/config';

// Mock-integration tier — exercises the BConnectClient against bConnect-Mock.
// Run separately from unit tests via `npm run test:mock`.
// Without the mock the tests are reported skipped; MOCK_REQUIRED=true (set by
// scripts/mock-tier.mjs) fails the run instead (#336).
export default defineConfig({
  test: {
    include: ['src/__tests__/mock-integration/**/*.test.ts'],
    env: { NODE_ENV: 'test', VITEST: 'true' },
    testTimeout: 15000,
  },
});
