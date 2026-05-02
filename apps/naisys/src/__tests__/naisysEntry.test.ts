import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  calls,
  dotenvConfig,
  mainLoaded,
  runWithRestartWrapper,
  shouldUseRestartWrapper,
} = vi.hoisted(() => ({
  calls: [] as string[],
  dotenvConfig: vi.fn(() => {
    calls.push("dotenv");
    return {};
  }),
  mainLoaded: vi.fn(() => {
    calls.push("main");
  }),
  runWithRestartWrapper: vi.fn(async () => {
    calls.push("wrapper");
    return 0;
  }),
  shouldUseRestartWrapper: vi.fn(() => {
    calls.push("guard");
    return false;
  }),
}));

vi.mock("dotenv", () => ({
  default: {
    config: dotenvConfig,
  },
}));

vi.mock("../services/restartManager.js", () => ({
  runWithRestartWrapper,
  shouldUseRestartWrapper,
}));

vi.mock("../naisysMain.js", () => {
  mainLoaded();
  return {};
});

describe("naisys entrypoint", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    calls.length = 0;
    dotenvConfig.mockClear();
    mainLoaded.mockClear();
    shouldUseRestartWrapper.mockReset();
    shouldUseRestartWrapper.mockImplementation(() => {
      calls.push("guard");
      return false;
    });
    runWithRestartWrapper.mockReset();
    runWithRestartWrapper.mockImplementation(async () => {
      calls.push("wrapper");
      return 0;
    });
  });

  test("loads dotenv before deciding whether to use the restart wrapper", async () => {
    await import("../naisys.js");

    expect(calls).toEqual(["dotenv", "guard", "main"]);
    expect(dotenvConfig).toHaveBeenCalledWith({ quiet: true });
    expect(shouldUseRestartWrapper).toHaveBeenCalledOnce();
    expect(mainLoaded).toHaveBeenCalledOnce();
  });

  test("does not import the heavy app module in wrapper-parent mode", async () => {
    shouldUseRestartWrapper.mockImplementation(() => {
      calls.push("guard");
      return true;
    });
    runWithRestartWrapper.mockImplementation(async () => {
      calls.push("wrapper");
      return 75;
    });
    vi.spyOn(process, "exit").mockImplementation((code) => {
      calls.push(`exit:${code}`);
      throw new Error("process.exit");
    });

    await expect(import("../naisys.js")).rejects.toThrow("process.exit");

    expect(calls).toEqual(["dotenv", "guard", "wrapper", "exit:75"]);
    expect(dotenvConfig).toHaveBeenCalledWith({ quiet: true });
    expect(mainLoaded).not.toHaveBeenCalled();
  });
});
