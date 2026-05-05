#!/usr/bin/env node
const { execSync } = require("child_process");
const path = require("path");

if (process.platform !== "win32") {
  try {
    execSync("chmod +x ./bin/*");
  } catch {
    // best-effort
  }
}

// playwright-core's "exports" field blocks subpath imports of cli.js, so
// resolve via package.json (which is exported) and join.
try {
  const pkgJsonPath = require.resolve("playwright-core/package.json");
  const cliPath = path.join(path.dirname(pkgJsonPath), "cli.js");
  execSync(`node ${JSON.stringify(cliPath)} install chromium`, {
    stdio: "inherit",
  });
} catch (e) {
  const msg = e && e.message ? e.message : String(e);
  console.warn(
    `[naisys] Playwright chromium install skipped/failed: ${msg}\n` +
      `        ns-browser will not work until chromium is downloaded.\n` +
      `        On Linux you may also need system libs (requires sudo, run interactively):\n` +
      `          sudo node "$(node -p "require.resolve('playwright-core/package.json')")"/../cli.js install-deps chromium`,
  );
}
