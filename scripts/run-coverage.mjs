#!/usr/bin/env node
/**
 * Merged coverage runner.
 *
 * Scope:
 *  - Node.js processes (vitest workers, spawned hub/naisys/erp child
 *    processes, the Playwright-managed erp server) via c8 + V8 coverage.
 *  - Supervisor + erp client React code running in Chromium during
 *    Playwright UI tests, via vite-plugin-istanbul. Tests dump
 *    `window.__coverage__` to `coverage/client-raw/` and we merge those
 *    numbers into the per-workspace summary below.
 *
 * Mode: --all, so unloaded source files count as 0% in the denominator
 * (whole-app coverage, not loaded-source coverage).
 */
import { spawnSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import libCoverage from "istanbul-lib-coverage";
import { resolve } from "path";

const repoRoot = resolve(import.meta.dirname, "..");
const rawDir = resolve(repoRoot, "coverage", "raw");
const clientRawDir = resolve(repoRoot, "coverage", "client-raw");
const reportDir = resolve(repoRoot, "coverage", "merged");

rmSync(rawDir, { recursive: true, force: true });
rmSync(clientRawDir, { recursive: true, force: true });
rmSync(reportDir, { recursive: true, force: true });
mkdirSync(rawDir, { recursive: true });

const env = {
  ...process.env,
  NODE_V8_COVERAGE: rawDir,
  COVERAGE: "1",
  COVERAGE_CLIENT_RAW_DIR: clientRawDir,
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

const failures = [];

// Rebuild the supervisor + erp client bundles with COVERAGE=1 so that
// vite-plugin-istanbul instruments the React code served to Chromium
// during Playwright tests. --force bypasses turbo's build cache, since
// the env var change isn't yet part of the cache key.
const clientBuildCode = run("npx", [
  "turbo",
  "build",
  "bundle",
  "--filter=@naisys/supervisor",
  "--filter=@naisys/erp",
  "--force",
]);
if (clientBuildCode !== 0) {
  failures.push({ phase: "turbo build (instrumented)", code: clientBuildCode });
}

// Defer to turbo: any workspace with a `test` script runs.
// New test scripts get picked up automatically.
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

const coverageRunSucceeded = failures.length === 0 && reportCode === 0;
const summaryPath = resolve(reportDir, "coverage-summary.json");
if (coverageRunSucceeded && existsSync(summaryPath)) {
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

  // Merge browser-side coverage from vite-plugin-istanbul dumps. Each
  // Playwright test writes window.__coverage__ to coverage/client-raw/.
  if (existsSync(clientRawDir)) {
    const map = libCoverage.createCoverageMap({});
    for (const file of readdirSync(clientRawDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const data = JSON.parse(
          readFileSync(resolve(clientRawDir, file), "utf-8"),
        );
        map.merge(data);
      } catch (err) {
        console.warn(
          `Skipping unreadable client coverage file ${file}: ${err.message}`,
        );
      }
    }
    for (const filePath of map.files()) {
      const rel = filePath.startsWith(repoRoot + "/")
        ? filePath.slice(repoRoot.length + 1)
        : filePath;
      const idx = rel.indexOf("/src/");
      if (idx < 0) continue;
      const workspace = rel.slice(0, idx);
      const fileSummary = map.fileCoverageFor(filePath).toSummary();
      const t = totals.get(workspace) ?? { covered: 0, total: 0 };
      t.covered += fileSummary.statements.covered;
      t.total += fileSummary.statements.total;
      totals.set(workspace, t);
    }
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
      "\nScope: Node.js processes via c8, plus the supervisor client React\n" +
      "       code via vite-plugin-istanbul (Playwright dumps window.__coverage__).\n" +
      "       For the client, only files actually loaded during a Playwright\n" +
      "       test contribute to the denominator. Other workspaces use --all,\n" +
      "       so unloaded files count as 0%.",
    );

    // Write a checked-in snapshot. Git history of this file is the coverage
    // progress log. No timestamp — keeps unchanged runs as no-op diffs.
    const formatCount = (value) => value.toLocaleString("en-US");
    let totalCovered = 0;
    let totalAll = 0;
    for (const t of totals.values()) {
      totalCovered += t.covered;
      totalAll += t.total;
    }
    const totalPct = totalAll
      ? `${(100 * totalCovered / totalAll).toFixed(2)}%`
      : "-";
    const lines = [
      "# Coverage",
      "",
      "Statement coverage from `npm run coverage:full`. This file is",
      "regenerated on every coverage run; commit it to log progress.",
      "",
      "Scope: Node.js processes via c8 (vitest, hub/naisys/erp child processes,",
      "Playwright-managed erp server) plus the supervisor + erp client React",
      "code via vite-plugin-istanbul. Unloaded files count as 0% for everything",
      "except `apps/supervisor/client` and `apps/erp/client`, where only",
      "modules loaded during a Playwright test contribute to the denominator.",
      "",
      `**Total: ${formatCount(totalCovered)} / ${formatCount(totalAll)} statements (${totalPct})**`,
      "",
      "| Workspace | Covered | Total | % |",
      "| --- | ---: | ---: | ---: |",
    ];
    for (const [name, t] of sorted) {
      const pct = t.total ? `${(100 * t.covered / t.total).toFixed(2)}%` : "-";
      lines.push(
        `| ${name} | ${formatCount(t.covered)} | ${formatCount(t.total)} | ${pct} |`,
      );
    }
    lines.push("");
    writeFileSync(resolve(repoRoot, "COVERAGE.md"), lines.join("\n"));
  }
} else if (!coverageRunSucceeded) {
  console.log("\nSkipping COVERAGE.md update because coverage run failed.");
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
