#!/usr/bin/env node
/**
 * Merged coverage runner.
 *
 * Scope:
 *  - Node.js processes (vitest workers, spawned hub/naisys/erp child
 *    processes, the Playwright-managed erp server) via c8 + V8 coverage.
 *  - Workspace Vitest coverage maps for packages whose tests execute source
 *    through Vite's module runner instead of c8-visible built files.
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
const workspaceIstanbulCoverageFiles = [
  resolve(repoRoot, "packages", "common", "coverage", "coverage-final.json"),
  resolve(
    repoRoot,
    "packages",
    "common-node",
    "coverage",
    "coverage-final.json",
  ),
];
const workspaceIstanbulCoverageDirs = [
  resolve(repoRoot, "packages", "common", "coverage"),
  resolve(repoRoot, "packages", "common-node", "coverage"),
];
const normalizedRepoRoot = repoRoot.replaceAll("\\", "/");

function toRepoRelativePath(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  const normalizedRoot = normalizedRepoRoot.toLowerCase() + "/";
  return normalized.toLowerCase().startsWith(normalizedRoot)
    ? normalized.slice(normalizedRepoRoot.length + 1)
    : normalized;
}

function workspaceForCoveragePath(filePath) {
  const rel = toRepoRelativePath(filePath);
  const idx = rel.indexOf("/src/");
  return idx < 0 ? undefined : rel.slice(0, idx);
}

function fileCoverageData(fileCoverage) {
  return fileCoverage.data ?? fileCoverage.toJSON();
}

function coveredLinesForFileCoverage(fileCoverage) {
  const data = fileCoverageData(fileCoverage);
  const lines = new Set();
  for (const [id, location] of Object.entries(data.statementMap ?? {})) {
    if ((data.s?.[id] ?? 0) <= 0) continue;
    const start = location.start?.line;
    const end = location.end?.line ?? start;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    for (let line = start; line <= end; line++) {
      lines.add(line);
    }
  }
  return lines;
}

function locationTouchesCoveredLine(location, coveredLines) {
  const start = location.start?.line;
  const end = location.end?.line ?? start;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  for (let line = start; line <= end; line++) {
    if (coveredLines.has(line)) return true;
  }
  return false;
}

function supplementCoverageMapWithCoveredLines(baseMap, coverageFinalPath) {
  if (!existsSync(coverageFinalPath)) return 0;

  const supplementMap = libCoverage.createCoverageMap(
    JSON.parse(readFileSync(coverageFinalPath, "utf-8")),
  );
  const baseFilesByNormalizedPath = new Map(
    baseMap.files().map((file) => [file.replaceAll("\\", "/"), file]),
  );

  let supplementedStatements = 0;
  for (const supplementFile of supplementMap.files()) {
    const baseFile = baseFilesByNormalizedPath.get(
      supplementFile.replaceAll("\\", "/"),
    );
    if (!baseFile) continue;

    const coveredLines = coveredLinesForFileCoverage(
      supplementMap.fileCoverageFor(supplementFile),
    );
    if (coveredLines.size === 0) continue;

    const baseCoverage = baseMap.fileCoverageFor(baseFile);
    const baseData = fileCoverageData(baseCoverage);
    for (const [id, location] of Object.entries(baseData.statementMap ?? {})) {
      if ((baseData.s?.[id] ?? 0) > 0) continue;
      if (!locationTouchesCoveredLine(location, coveredLines)) continue;
      baseData.s[id] = 1;
      supplementedStatements++;
    }
  }

  return supplementedStatements;
}

function summaryFromCoverageMap(map) {
  const summary = { total: map.getCoverageSummary().toJSON() };
  for (const file of map.files()) {
    summary[file] = map.fileCoverageFor(file).toSummary().toJSON();
  }
  return summary;
}

rmSync(rawDir, { recursive: true, force: true });
rmSync(clientRawDir, { recursive: true, force: true });
rmSync(reportDir, { recursive: true, force: true });
for (const dir of workspaceIstanbulCoverageDirs) {
  rmSync(dir, { recursive: true, force: true });
}
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
  "--reporter=json",
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
  let summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
  const coverageFinalPath = resolve(reportDir, "coverage-final.json");
  if (existsSync(coverageFinalPath)) {
    try {
      const map = libCoverage.createCoverageMap(
        JSON.parse(readFileSync(coverageFinalPath, "utf-8")),
      );
      let supplementedStatements = 0;
      for (const file of workspaceIstanbulCoverageFiles) {
        supplementedStatements += supplementCoverageMapWithCoveredLines(
          map,
          file,
        );
      }
      if (supplementedStatements > 0) {
        summary = summaryFromCoverageMap(map);
        writeFileSync(coverageFinalPath, JSON.stringify(map.toJSON(), null, 2));
        writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
        console.log(
          `Merged ${supplementedStatements} Vitest-covered statements into c8 summary.`,
        );
      }
    } catch (err) {
      console.warn(`Skipping workspace Vitest coverage merge: ${err.message}`);
    }
  }
  const totals = new Map();

  for (const [path, data] of Object.entries(summary)) {
    if (path === "total") continue;
    const workspace = workspaceForCoveragePath(path);
    if (!workspace) continue;
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
      const workspace = workspaceForCoveragePath(filePath);
      if (!workspace) continue;
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
      const pct = t.total
        ? `${((100 * t.covered) / t.total).toFixed(2)}%`
        : "-";
      console.log(
        name.padEnd(nameWidth) + " | " + ratio.padEnd(20) + " | " + pct,
      );
    }
    console.log(
      "\nScope: Node.js processes via c8, plus the supervisor client React\n" +
        "       code via vite-plugin-istanbul (Playwright dumps window.__coverage__),\n" +
        "       plus selected workspace Vitest coverage maps.\n" +
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
      ? `${((100 * totalCovered) / totalAll).toFixed(2)}%`
      : "-";
    const lines = [
      "# Coverage",
      "",
      "Statement coverage from `npm run coverage:full`. This file is",
      "regenerated on every coverage run; commit it to log progress.",
      "",
      "Scope: Node.js processes via c8 (vitest, hub/naisys/erp child processes,",
      "Playwright-managed erp server), selected workspace Vitest coverage maps,",
      "plus the supervisor + erp client React code via vite-plugin-istanbul.",
      "Unloaded files count as 0% for everything",
      "except `apps/supervisor/client` and `apps/erp/client`, where only",
      "modules loaded during a Playwright test contribute to the denominator.",
      "",
      `**Total: ${formatCount(totalCovered)} / ${formatCount(totalAll)} statements (${totalPct})**`,
      "",
      "| Workspace | Covered | Total | % |",
      "| --- | ---: | ---: | ---: |",
    ];
    for (const [name, t] of sorted) {
      const pct = t.total
        ? `${((100 * t.covered) / t.total).toFixed(2)}%`
        : "-";
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
