import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      enabled: process.env.COVERAGE === "1",
      provider: "v8",
      reporter: ["json", "json-summary", "text"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
      reportsDirectory: "./coverage",
    },
  },
});
