import { describe, expect, test } from "vitest";

import { buildClientConfig } from "../src/config/globalConfigLoader.js";

describe("host-local configuration", () => {
  test("does not distribute the hub's desktop backend to other hosts", () => {
    const config = buildClientConfig({
      NAISYS_DESKTOP_BACKEND: "x11",
      SHARED_SETTING: "shared",
    });
    expect(config.variableMap).toEqual({ SHARED_SETTING: "shared" });
    expect(config.shellVariableMap).toEqual({ SHARED_SETTING: "shared" });
  });
});
