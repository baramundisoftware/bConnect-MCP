import { defineConfig } from "vitest/config";

// Mock-integration tier for the gateway (#131): the combined endpoint against
// bConnect-Mock. Run separately from the unit tests via `npm run test:mock`.
// Without the mock the tests are reported skipped; MOCK_REQUIRED=true (set by
// scripts/mock-tier.mjs) fails the run instead (#336).
export default defineConfig({
  test: {
    include: ["src/__tests__/mock-integration/**/*.test.ts"],
    env: { NODE_ENV: "test", VITEST: "true" },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
