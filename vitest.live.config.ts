import { defineConfig } from 'vitest/config';

// Live tier: every server against a real bMS, read-only (__tests__/live/), plus
// the tier's self-tests. Opt-in: `npm run test:live`. The run fails when
// .env.local (or the file in BCONNECT_LIVE_ENV) is missing or sets no
// BCONNECT_BASE_URL. See docs/LIVE_BMS_TESTING.md.
export default defineConfig({
  test: {
    include: ['__tests__/live/**/*.test.ts'],
    env: { NODE_ENV: 'test', VITEST: 'true' },
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 120_000,
  },
});
