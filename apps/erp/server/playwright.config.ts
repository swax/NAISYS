import { defineConfig } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.join(__dirname, "prisma/test.db");
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
      command: "npm run dev",
      port: 3002,
      env: { ERP_DATABASE_URL: testDbUrl },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev --prefix ../client",
      port: 5173,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
