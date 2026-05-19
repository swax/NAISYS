import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { expandNaisysFolder } from "../src/env/expandEnv.js";
import { parseEnvFile } from "../src/loaders/setupWizard.js";

const originalNaisysFolder = process.env.NAISYS_FOLDER;
const tempFolders: string[] = [];

function restoreNaisysFolder() {
  if (originalNaisysFolder === undefined) {
    delete process.env.NAISYS_FOLDER;
  } else {
    process.env.NAISYS_FOLDER = originalNaisysFolder;
  }
}

function makeTempFolder(): string {
  const folder = mkdtempSync(path.join(os.tmpdir(), "common-node-env-"));
  tempFolders.push(folder);
  return folder;
}

describe("environment helpers", () => {
  afterEach(() => {
    restoreNaisysFolder();
    for (const folder of tempFolders.splice(0)) {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test("expands a leading tilde in NAISYS_FOLDER", () => {
    process.env.NAISYS_FOLDER = "~/naisys-data";

    expandNaisysFolder();

    expect(process.env.NAISYS_FOLDER).toBe(
      path.join(os.homedir(), "naisys-data"),
    );
  });

  test("leaves unset and non-tilde NAISYS_FOLDER values unchanged", () => {
    delete process.env.NAISYS_FOLDER;
    expandNaisysFolder();
    expect(process.env.NAISYS_FOLDER).toBeUndefined();

    process.env.NAISYS_FOLDER = "/var/lib/naisys";
    expandNaisysFolder();
    expect(process.env.NAISYS_FOLDER).toBe("/var/lib/naisys");
  });

  test("parses .env assignments, quotes, comments, and empty values", () => {
    const folder = makeTempFolder();
    const filePath = path.join(folder, ".env");
    writeFileSync(
      filePath,
      [
        "# ignored",
        "PLAIN=value",
        "SPACED = trimmed ",
        'DOUBLE_QUOTED="value # kept"',
        "SINGLE_QUOTED='also kept'",
        "INLINE=before # removed",
        "EMPTY=",
        "NO_EQUALS",
        "",
      ].join("\n"),
    );

    expect(parseEnvFile(filePath)).toEqual({
      PLAIN: "value",
      SPACED: "trimmed",
      DOUBLE_QUOTED: "value # kept",
      SINGLE_QUOTED: "also kept",
      INLINE: "before",
      EMPTY: "",
    });
  });

  test("returns an empty object for a missing .env file", () => {
    expect(parseEnvFile(path.join(makeTempFolder(), "missing.env"))).toEqual(
      {},
    );
  });
});
