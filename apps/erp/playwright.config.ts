import { defineConfig } from "@playwright/test";

export default defineConfig({
  projects: [
    {
      name: "api",
      testDir: "./e2e/api",
    },
    {
      name: "ui",
      testDir: "./e2e/ui",
      use: {
        baseURL: "http://localhost:5173",
        headless: true,
      },
    },
  ],
});
