import { compareSemver } from "@naisys/common";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, test } from "vitest";

import { getInstallPath } from "../../services/runtime/pathService.js";

describe("pathService", () => {
  // getInstallPath uses relative arithmetic on import.meta.url. Any reorg
  // that changes the file's depth without updating the relative path
  // silently breaks every caller (updateService, hubClientConfig, globalConfig).
  // The downstream symptom is a non-semver version string crashing semver.compare
  // on startup — easier to catch here at the source.
  test("getInstallPath resolves to the naisys package root", () => {
    const packageJsonPath = path.join(getInstallPath(), "package.json");
    expect(existsSync(packageJsonPath)).toBe(true);

    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    expect(pkg.name).toBe("naisys");
    expect(() => compareSemver(pkg.version, "0.0.0")).not.toThrow();
  });
});
