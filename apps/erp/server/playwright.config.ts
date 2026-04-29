import { defineConfig } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testNaisysFolder = path.join(__dirname, ".test-naisys");
const serverCommand =
  process.platform === "win32"
    ? "node --import tsx src/erpServer.ts"
    : "exec node --import tsx src/erpServer.ts";

export default defineConfig({
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  projects: [
    {
      name: "api",
      testDir: "./e2e/api",
    },
    {
      name: "ui",
      testDir: "./e2e/ui",
      use: {
        baseURL: "http://localhost:2202",
        headless: true,
      },
    },
  ],
  webServer: [
    {
      // Run via `exec node --import tsx` on POSIX so SIGTERM reaches node
      // directly and NODE_V8_COVERAGE flushes request-handler coverage on
      // shutdown. Windows cmd.exe has no `exec`, so run node directly there.
      // Why each piece:
      //   - `exec`: Playwright's webServer always spawns through a shell.
      //     Without `exec` the shell is the parent of node and intercepts
      //     the signal. `exec` replaces the shell with node.
      //   - `node --import tsx` (vs `npx tsx` or `npm run dev`): both
      //     wrappers spawn a child node and SIGKILL it without forwarding.
      //     Loading tsx as an import hook keeps it a single process.
      //   - Running src/ directly (vs dist/) means `npm test` works on a
      //     clean tree without a prior build step. The graceful-shutdown
      //     flush is what makes coverage work; src vs dist is irrelevant
      //     to it (c8 attributes both back to src/ via source maps).
      command: serverCommand,
      // Default Playwright kills with SIGKILL, which skips the server's
      // SIGTERM handler and the NODE_V8_COVERAGE on-exit flush. Send SIGTERM
      // and give it a few seconds to drain.
      gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
      port: 3302,
      env: {
        NAISYS_SKIP_DOTENV_CHECK: "1",
        NAISYS_FOLDER: testNaisysFolder,
        SUPERVISOR_AUTH: "false",
        SERVER_PORT: "3302",
        // Lift the auth login rate limit so parallel workers + multiple
        // spec files don't trip the 5/min limit during beforeAll.
        AUTH_LOGIN_RATE_LIMIT: "1000",
        ...(process.env.NODE_V8_COVERAGE
          ? { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE }
          : {}),
      },
      // Never reuse a leftover server when collecting coverage — a stale
      // process on :3302 may have been started without NODE_V8_COVERAGE,
      // and Playwright would silently skip launching the instrumented one.
      reuseExistingServer: !process.env.CI && !process.env.NODE_V8_COVERAGE,
    },
    {
      command: "npm run dev --prefix ../client",
      port: 2202,
      reuseExistingServer: !process.env.CI && !process.env.NODE_V8_COVERAGE,
    },
  ],
});
