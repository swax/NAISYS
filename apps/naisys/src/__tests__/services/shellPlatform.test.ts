import { spawnSync, type SpawnSyncReturns } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { describe, expect, test } from "vitest";

import { getPlatformConfigFor } from "../../services/runtime/shellPlatform.js";

const bashTest = process.platform === "win32" ? test.skip : test;

describe("shellPlatform", () => {
  bashTest.each([
    {
      body: "echo script-ok",
      expectedStatus: 0,
      expectedHaltCount: 0,
      name: "successful sourced scripts",
    },
    {
      body: "echo before-failure\nfalse\necho after-failure",
      expectedStatus: 1,
      expectedHaltCount: 1,
      name: "failed sourced scripts",
    },
  ])("restores bash error traps after $name", (scenario) => {
    const result = runWithWrappedScript(
      scenario.body,
      (src) =>
        `source ${src}; echo source-status:$?; false; echo normal-failure-survived`,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`source-status:${scenario.expectedStatus}`);
    expect(result.stdout).toContain("normal-failure-survived");

    const haltCount =
      result.stderr.match(/NAISYS: script halted at exit/g)?.length ?? 0;
    expect(haltCount).toBe(scenario.expectedHaltCount);
  });

  bashTest.each([
    { body: "echo script-ok", name: "successful source" },
    { body: "false", name: "failed source" },
  ])("preserves parent's set -e after $name", (scenario) => {
    const result = runWithWrappedScript(
      scenario.body,
      (src) => `
        set -e
        source ${src} || true
        case $- in *e*) echo errexit-preserved ;; *) echo errexit-lost ;; esac
      `,
    );

    expect(result.stdout).toContain("errexit-preserved");
  });

  bashTest.each([
    { body: "echo script-ok", name: "successful source" },
    { body: "false", name: "failed source" },
  ])("preserves parent's ERR trap after $name", (scenario) => {
    const result = runWithWrappedScript(
      scenario.body,
      (src) => `
        trap 'echo PREV-ERR-FIRED' ERR
        source ${src} || true
        echo "trap-after: $(trap -p ERR)"
      `,
    );

    expect(result.stdout).toContain(
      "trap-after: trap -- 'echo PREV-ERR-FIRED' ERR",
    );
  });

  bashTest.each([
    { body: "echo script-ok", name: "successful source" },
    { body: "false", name: "failed source" },
  ])("preserves parent's RETURN trap after $name", (scenario) => {
    const result = runWithWrappedScript(
      scenario.body,
      (src) => `
        trap 'echo PREV-RETURN-FIRED' RETURN
        source ${src} || true
        echo "trap-after: $(trap -p RETURN)"
      `,
    );

    expect(result.stdout).toContain(
      "trap-after: trap -- 'echo PREV-RETURN-FIRED' RETURN",
    );
  });

  bashTest("leaves no ERR or RETURN trap when parent had none", () => {
    const result = runWithWrappedScript(
      "echo script-ok",
      (src) => `
        source ${src}
        echo "err-trap-after:[$(trap -p ERR)]"
        echo "return-trap-after:[$(trap -p RETURN)]"
      `,
    );

    expect(result.stdout).toContain("err-trap-after:[]");
    expect(result.stdout).toContain("return-trap-after:[]");
  });

  bashTest.each([
    { body: "echo script-ok", name: "successful source" },
    { body: "false", name: "failed source" },
  ])("leaks no __naisys_* variables after $name", (scenario) => {
    const result = runWithWrappedScript(
      scenario.body,
      (src) => `
        source ${src} || true
        echo "leaked-vars:[$(compgen -v | grep '^__naisys' || true)]"
      `,
    );

    expect(result.stdout).toContain("leaked-vars:[]");
  });
});

function runWithWrappedScript(
  body: string,
  parentSnippet: (sourcePath: string) => string,
): SpawnSyncReturns<string> {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "naisys-shell-"));
  const scriptPath = path.join(tempDir, "multiline-command.sh");
  const platformConfig = getPlatformConfigFor("linux");

  try {
    writeFileSync(
      scriptPath,
      `${platformConfig.scriptHeader}
${platformConfig.scriptSetError}
${body}
`,
    );

    return spawnSync(
      "bash",
      ["--noprofile", "--norc", "-c", parentSnippet(shellQuote(scriptPath))],
      { encoding: "utf8" },
    );
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
