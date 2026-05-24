import { afterEach, describe, expect, test } from "vitest";

import { resolveHostAccessKey } from "../src/hub/hostAccessKey.js";

const originalHostAccessKey = process.env.HOST_ACCESS_KEY;

function restoreEnv() {
  if (originalHostAccessKey === undefined) {
    delete process.env.HOST_ACCESS_KEY;
  } else {
    process.env.HOST_ACCESS_KEY = originalHostAccessKey;
  }
}

describe("resolveHostAccessKey", () => {
  afterEach(restoreEnv);

  test("returns undefined when HOST_ACCESS_KEY is unset", () => {
    delete process.env.HOST_ACCESS_KEY;
    expect(resolveHostAccessKey()).toBeUndefined();
  });

  test("returns the HOST_ACCESS_KEY env value when set", () => {
    process.env.HOST_ACCESS_KEY = "env-key";
    expect(resolveHostAccessKey()).toBe("env-key");
  });
});
