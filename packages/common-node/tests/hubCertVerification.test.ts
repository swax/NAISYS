import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  readHubAccessKeyFile,
  resolveHubAccessKey,
} from "../src/hub/hubCertVerification.js";

const originalHubAccessKey = process.env.HUB_ACCESS_KEY;
const originalNaisysFolder = process.env.NAISYS_FOLDER;
const tempFolders: string[] = [];

function restoreEnv() {
  if (originalHubAccessKey === undefined) {
    delete process.env.HUB_ACCESS_KEY;
  } else {
    process.env.HUB_ACCESS_KEY = originalHubAccessKey;
  }
  if (originalNaisysFolder === undefined) {
    delete process.env.NAISYS_FOLDER;
  } else {
    process.env.NAISYS_FOLDER = originalNaisysFolder;
  }
}

function makeTempFolder(): string {
  const folder = mkdtempSync(path.join(os.tmpdir(), "common-node-cert-"));
  tempFolders.push(folder);
  return folder;
}

describe("hub cert verification helpers", () => {
  afterEach(() => {
    restoreEnv();
    for (const folder of tempFolders.splice(0)) {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test("returns undefined when the hub access key file is absent", () => {
    process.env.NAISYS_FOLDER = makeTempFolder();

    expect(readHubAccessKeyFile()).toBeUndefined();
  });

  test("reads and trims the hub access key file", () => {
    const folder = makeTempFolder();
    const certFolder = path.join(folder, "cert");
    mkdirSync(certFolder);
    writeFileSync(path.join(certFolder, "hub-access-key"), " file-key \n");
    process.env.NAISYS_FOLDER = folder;

    expect(readHubAccessKeyFile()).toBe("file-key");
  });

  test("prefers HUB_ACCESS_KEY over the local cert file", () => {
    const folder = makeTempFolder();
    const certFolder = path.join(folder, "cert");
    mkdirSync(certFolder);
    writeFileSync(path.join(certFolder, "hub-access-key"), "file-key");
    process.env.NAISYS_FOLDER = folder;
    process.env.HUB_ACCESS_KEY = "env-key";

    expect(resolveHubAccessKey()).toBe("env-key");
  });

  test("falls back to the local cert file when HUB_ACCESS_KEY is unset", () => {
    const folder = makeTempFolder();
    const certFolder = path.join(folder, "cert");
    mkdirSync(certFolder);
    writeFileSync(path.join(certFolder, "hub-access-key"), "file-key");
    process.env.NAISYS_FOLDER = folder;
    delete process.env.HUB_ACCESS_KEY;

    expect(resolveHubAccessKey()).toBe("file-key");
  });
});
