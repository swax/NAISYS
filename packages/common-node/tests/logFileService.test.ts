import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { tailLogFile } from "../src/hub/logFileService.js";

const tempFolders: string[] = [];

function makeTempFolder(): string {
  const folder = mkdtempSync(path.join(os.tmpdir(), "common-node-logs-"));
  tempFolders.push(folder);
  return folder;
}

describe("tailLogFile", () => {
  afterEach(() => {
    for (const folder of tempFolders.splice(0)) {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test("returns an empty result for a missing log file", async () => {
    await expect(
      tailLogFile(path.join(makeTempFolder(), "missing.log"), 10),
    ).resolves.toEqual({ entries: [], fileSize: 0 });
  });

  test("parses pino JSON lines, skips malformed lines, and slices the tail", async () => {
    const filePath = path.join(makeTempFolder(), "server.log");
    writeFileSync(
      filePath,
      [
        JSON.stringify({
          level: 30,
          time: 1,
          msg: "startup",
          pid: 123,
          hostname: "host",
        }),
        "not-json",
        JSON.stringify({
          level: 50,
          time: 2,
          msg: "failed",
          requestId: "req-1",
        }),
        JSON.stringify({ msg: "defaulted" }),
        "",
      ].join("\n"),
    );

    const result = await tailLogFile(filePath, 2);

    expect(result.fileSize).toBeGreaterThan(0);
    expect(result.entries).toEqual([
      {
        level: 50,
        time: 2,
        msg: "failed",
        detail: JSON.stringify({ requestId: "req-1" }),
      },
      {
        level: 30,
        time: 0,
        msg: "defaulted",
        detail: undefined,
      },
    ]);
  });

  test("filters entries below a minimum pino level", async () => {
    const filePath = path.join(makeTempFolder(), "server.log");
    writeFileSync(
      filePath,
      [
        JSON.stringify({ level: 20, time: 1, msg: "debug" }),
        JSON.stringify({ level: 30, time: 2, msg: "info" }),
        JSON.stringify({ level: 50, time: 3, msg: "error" }),
        "",
      ].join("\n"),
    );

    const result = await tailLogFile(filePath, 10, 40);

    expect(result.entries.map((entry) => entry.msg)).toEqual(["error"]);
  });

  test("drops a partial first line when reading only the end of a large log", async () => {
    const filePath = path.join(makeTempFolder(), "large.log");
    writeFileSync(
      filePath,
      [
        "x".repeat(270_000),
        JSON.stringify({ level: 30, time: 1, msg: "near-end-1" }),
        JSON.stringify({ level: 40, time: 2, msg: "near-end-2" }),
        "",
      ].join("\n"),
    );

    const result = await tailLogFile(filePath, 10);

    expect(result.entries.map((entry) => entry.msg)).toEqual([
      "near-end-1",
      "near-end-2",
    ]);
  });
});
