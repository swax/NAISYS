import { defineConfig } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testNaisysFolder = path.join(__dirname, ".test-naisys");

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
        baseURL: "http://localhost:3202",
        headless: true,
      },
    },
  ],
  webServer: [
    {
      command: "npm run dev",
      port: 3201,
      env: { NAISYS_FOLDER: testNaisysFolder },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run dev --prefix ../client",
      port: 3202,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
