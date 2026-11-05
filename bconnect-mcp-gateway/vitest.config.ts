import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The mock-integration tier runs on its own: `npm run test:mock` (vitest.mock.config.ts).
    exclude: ["**/node_modules/**", "**/build/**", "**/mock-integration/**"],
    env: {
      NODE_ENV: "test",
      VITEST: "true",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "build/**", "src/__tests__/**", "**/*.d.ts"],
    },
  },
});
