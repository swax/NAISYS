#!/usr/bin/env node
/**
 * Merged coverage runner.
 *
 * Scope: Node.js processes only.
 *  - Includes: vitest workers, spawned hub/naisys/erp child processes, and the
 *    Playwright-managed erp server.
 *  - Excludes: code executing inside Chromium during Playwright UI tests
 *    (apps/erp/client, apps/supervisor/client) — browser-side coverage would
 *    require Playwright's page.coverage API and is not wired up here.
 *
 * Mode: --all, so unloaded source files count as 0% in the denominator
 * (whole-app coverage, not loaded-source coverage).
 */
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { resolve } from "path";

const repoRoot = resolve(import.meta.dirname, "..");
const rawDir = resolve(repoRoot, "coverage", "raw");
const reportDir = resolve(repoRoot, "coverage", "merged");

rmSync(rawDir, { recursive: true, force: true });
rmSync(reportDir, { recursive: true, force: true });
mkdirSync(rawDir, { recursive: true });

const env = {
  ...process.env,
  NODE_V8_COVERAGE: rawDir,
};

const run = (cmd, args, cwd = repoRoot) => {
  console.log(`\n$ ${cmd} ${args.join(" ")}    (cwd: ${cwd})`);
  const result = spawnSync(cmd, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return result.status ?? 1;
};

// Defer to turbo: any workspace with a `test` script runs.
// New test scripts get picked up automatically.
const failures = [];
const testCode = run("npx", ["turbo", "test"]);
if (testCode !== 0) {
  failures.push({ phase: "turbo test", code: testCode });
}

const reportCode = run("npx", [
  "c8",
  "report",
  "--all",
  "--exclude-after-remap",
  "--src=apps",
  "--src=packages",
  "--reporter=html",
  "--reporter=json-summary",
  "--reports-dir=" + reportDir,
  "--temp-directory=" + rawDir,
  "--include=**/src/**/*.ts",
  "--include=**/src/**/*.tsx",
  "--exclude=**/__tests__/**",
  "--exclude=**/tests/**",
  "--exclude=**/e2e/**",
  "--exclude=**/generated/**",
  "--exclude=**/*.d.ts",
  "--exclude=**/*.test.ts",
  "--exclude=**/*.spec.ts",
  "--exclude=**/dist/**",
  "--exclude=**/client-dist/**",
  "--exclude=**/node_modules/**",
  "--exclude=apps/*/client/**",
  "--exclude=packages/common-browser/**",
]);

const summaryPath = resolve(reportDir, "coverage-summary.json");
if (existsSync(summaryPath)) {
  const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
  const totals = new Map();

  for (const [path, data] of Object.entries(summary)) {
    if (path === "total") continue;
    const rel = path.startsWith(repoRoot + "/")
      ? path.slice(repoRoot.length + 1)
      : path;
    const idx = rel.indexOf("/src/");
    if (idx < 0) continue;
    const workspace = rel.slice(0, idx);
    const t = totals.get(workspace) ?? { covered: 0, total: 0 };
    t.covered += data.statements.covered;
    t.total += data.statements.total;
    totals.set(workspace, t);
  }

  const sorted = [...totals.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (sorted.length > 0) {
    const nameWidth = Math.max(...sorted.map(([n]) => n.length), 9);
    const sep = "=".repeat(nameWidth + 32);
    console.log("\n" + sep);
    console.log("Per-workspace statement coverage");
    console.log(sep);
    console.log("Workspace".padEnd(nameWidth) + " | Covered/Total       | Pct");
    console.log("-".repeat(nameWidth) + "-+-" + "-".repeat(20) + "-+-------");
    for (const [name, t] of sorted) {
      const ratio = `${t.covered}/${t.total}`;
      const pct = t.total ? `${(100 * t.covered / t.total).toFixed(2)}%` : "-";
      console.log(name.padEnd(nameWidth) + " | " + ratio.padEnd(20) + " | " + pct);
    }
    console.log(
      "\nScope: Node.js processes only — Chromium-side client code from\n" +
      "       Playwright UI tests is not measured. Unloaded source files\n" +
      "       count as 0% in the denominator (--all).",
    );
  }
}

if (failures.length > 0) {
  console.error("\nTest phase failures:");
  for (const f of failures) {
    console.error(`  ${f.phase}: exit ${f.code}`);
  }
}

console.log(`\nHTML report: ${reportDir}/index.html`);
console.log(`Raw v8 data: ${rawDir}`);

process.exit(failures.length > 0 || reportCode !== 0 ? 1 : 0);
