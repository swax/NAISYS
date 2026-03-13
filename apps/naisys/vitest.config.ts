import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30000,
    include: ["src/__tests__/**/*.test.ts"],
  },
});
