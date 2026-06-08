import { defineConfig } from 'vitest/config';

// Mock-integration tier — exercises the BConnectClient against bConnect-Mock.
// Run separately from unit tests via `npm run test:mock`.
// Tests skip themselves when the mock is unreachable, so this config is also
// safe to invoke in CI where the mock is not running.
export default defineConfig({
  test: {
    include: ['src/__tests__/mock-integration/**/*.test.ts'],
    env: { NODE_ENV: 'test', VITEST: 'true' },
    testTimeout: 15000,
  },
});
