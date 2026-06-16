import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/build/**"],
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
