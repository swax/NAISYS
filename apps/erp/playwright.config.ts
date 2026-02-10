import { defineConfig } from "@playwright/test";
import path from "path";

const testDbPath = path.join(__dirname, "server/prisma/test.db");
const testDbUrl = `file:${testDbPath}`;

export default defineConfig({
  globalSetup: "./e2e/global-setup.ts",
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
  webServer: [
    {
      command: "npm run dev --workspace=server",
      port: 3002,
      env: { ERP_DATABASE_URL: testDbUrl },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev --workspace=client",
      port: 5173,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
