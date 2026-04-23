import { describe, expect, test } from "vitest";

import {
  DISABLE_RESTART_WRAPPER_ENV,
  getExitCodeForSignal,
  getRestartWrapperSignals,
  isRestartWrapperActive,
  RESTART_WRAPPER_ACTIVE_ENV,
  RESTART_WRAPPER_CHILD_ENV,
  shouldUseRestartWrapper,
} from "../../services/restartManager.js";

describe("restartManager", () => {
  test("does not use the restart wrapper for standalone runs", () => {
    expect(shouldUseRestartWrapper(["node", "naisys"], {})).toBe(false);
  });

  test("uses the restart wrapper for remote hub runs", () => {
    expect(
      shouldUseRestartWrapper(["node", "naisys", "--hub=https://x"], {}),
    ).toBe(true);
  });

  test("uses the restart wrapper for integrated hub runs", () => {
    expect(
      shouldUseRestartWrapper(["node", "naisys", "--integrated-hub"], {}),
    ).toBe(true);
  });

  test("does not use the restart wrapper when auto-update is disabled", () => {
    expect(
      shouldUseRestartWrapper(
        ["node", "naisys", "--hub=https://x", "--no-auto-update"],
        {},
      ),
    ).toBe(false);
  });

  test("does not nest the restart wrapper inside the wrapper child", () => {
    expect(
      shouldUseRestartWrapper(["node", "naisys", "--hub=https://x"], {
        [RESTART_WRAPPER_CHILD_ENV]: "1",
      }),
    ).toBe(false);
  });

  test("does not use the restart wrapper under PM2", () => {
    expect(
      shouldUseRestartWrapper(["node", "naisys", "--hub=https://x"], {
        pm_id: "0",
      }),
    ).toBe(false);
  });

  test("allows explicitly disabling the restart wrapper", () => {
    expect(
      shouldUseRestartWrapper(["node", "naisys", "--hub=https://x"], {
        [DISABLE_RESTART_WRAPPER_ENV]: "1",
      }),
    ).toBe(false);
  });

  test("detects when the wrapper is active for managed restarts", () => {
    expect(
      isRestartWrapperActive({
        [RESTART_WRAPPER_ACTIVE_ENV]: "1",
      }),
    ).toBe(true);
  });

  test("forwards SIGHUP only on non-Windows platforms", () => {
    expect(getRestartWrapperSignals("linux")).toEqual([
      "SIGINT",
      "SIGTERM",
      "SIGHUP",
    ]);
    expect(getRestartWrapperSignals("darwin")).toEqual([
      "SIGINT",
      "SIGTERM",
      "SIGHUP",
    ]);
    expect(getRestartWrapperSignals("win32")).toEqual(["SIGINT", "SIGTERM"]);
  });

  test("maps common signal exits to conventional shell exit codes", () => {
    expect(getExitCodeForSignal("SIGINT")).toBe(130);
    expect(getExitCodeForSignal("SIGHUP")).toBe(129);
    expect(getExitCodeForSignal("SIGTERM")).toBe(143);
    expect(getExitCodeForSignal("SIGUSR1")).toBe(1);
    expect(getExitCodeForSignal(null)).toBe(1);
  });
});
