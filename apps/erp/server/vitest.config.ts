import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/tests/**", "src/generated/**", "src/**/*.d.ts"],
      reportsDirectory: "./coverage",
    },
  },
});
