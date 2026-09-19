import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { createShellWrapper } from "../../command/shellWrapper.js";
import { createNaisysApiService } from "../../services/hub/naisysApiService.js";
import {
  getPlatformConfig,
  quoteShellLiteral,
} from "../../services/runtime/shellPlatform.js";
import { validateShellSyntax } from "../../services/runtime/shellSyntax.js";
import {
  createMockAgentConfig,
  createMockGlobalConfig,
  createMockOutputService,
} from "../mocks.js";

describe("shell syntax validation", () => {
  const platform = getPlatformConfig();
  test("rejects an unmatched quote and incomplete block", async () => {
    expect(
      await validateShellSyntax('echo "unterminated', platform),
    ).toBeTruthy();
    expect(await validateShellSyntax("if (", platform)).toBeTruthy();
  });
  test("parses without executing commands or command substitutions", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "naisys-parse-"));
    const marker = path.join(dir, "never-created").replace(/\\/g, "/");
    try {
      const body =
        process.platform === "win32"
          ? `Write-Output $(New-Item -ItemType File '${marker}')`
          : `echo $(touch '${marker}')`;
      expect(await validateShellSyntax(body, platform)).toBeUndefined();
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
  test.skipIf(process.platform === "win32")(
    "rejects an incomplete heredoc even if bash exits zero",
    async () => {
      expect(
        await validateShellSyntax("cat <<'EOF'\nhello", platform),
      ).toBeTruthy();
    },
  );
  test("persistent shell recovers immediately after malformed input and reports exit zero correctly", async () => {
    const shell = createShellWrapper(
      createMockGlobalConfig(),
      createMockAgentConfig(),
      createMockOutputService(),
      createNaisysApiService(),
    );
    try {
      expect(await shell.executeCommand('echo "unterminated')).toContain(
        "Command not executed",
      );
      expect(await shell.executeCommand("echo ready")).toBe("ready");
      const literal = "A$AP Rocky's thumbnail $(literal).jpg";
      expect(
        await shell.executeCommand(`echo ${quoteShellLiteral(literal)}`),
      ).toBe(literal);
      const result = await shell.executeCommand("exit 0");
      expect(result).toContain("exited with code 0");
      expect(result).not.toContain("killed");
    } finally {
      await shell.terminate();
    }
  }, 20_000);
});
