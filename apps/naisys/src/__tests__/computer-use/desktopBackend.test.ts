import { describe, expect, test } from "vitest";

import { selectDesktopBackend } from "../../computer-use/desktopBackend.js";

describe("desktop backend selection", () => {
  const wsl = {
    WSL_DISTRO_NAME: "Ubuntu",
    DISPLAY: ":0",
    WAYLAND_DISPLAY: "wayland-0",
  };

  test("preserves Windows desktop control for WSL unless explicitly overridden", () => {
    expect(selectDesktopBackend("linux", wsl)).toBe("windows");
    expect(
      selectDesktopBackend("linux", { ...wsl, NAISYS_DESKTOP_BACKEND: "auto" }),
    ).toBe("windows");
  });

  test("targets a virtual X11 display despite inherited WSLg variables", () => {
    expect(
      selectDesktopBackend("linux", {
        ...wsl,
        DISPLAY: ":2",
        XDG_SESSION_TYPE: "wayland",
        NAISYS_DESKTOP_BACKEND: "x11",
      }),
    ).toBe("x11");
  });

  test("supports explicitly selecting Wayland in WSL", () => {
    expect(
      selectDesktopBackend("linux", {
        ...wsl,
        NAISYS_DESKTOP_BACKEND: "wayland",
      }),
    ).toBe("wayland");
  });

  test.each([
    ["win32", {}, "windows"],
    ["darwin", {}, "macos"],
    ["linux", { DISPLAY: ":2" }, "x11"],
    ["linux", { WAYLAND_DISPLAY: "wayland-0" }, "wayland"],
    ["linux", {}, null],
  ] as const)(
    "preserves automatic selection for %s with %j",
    (platform, env, expected) => {
      expect(selectDesktopBackend(platform, env)).toBe(expected);
    },
  );

  test("rejects invalid or unavailable explicit targets instead of controlling a different desktop", () => {
    expect(() =>
      selectDesktopBackend("linux", { ...wsl, NAISYS_DESKTOP_BACKEND: "typo" }),
    ).toThrow("Unknown NAISYS_DESKTOP_BACKEND");
    expect(() =>
      selectDesktopBackend("linux", { NAISYS_DESKTOP_BACKEND: "x11" }),
    ).toThrow("requires DISPLAY");
    expect(() =>
      selectDesktopBackend("linux", { NAISYS_DESKTOP_BACKEND: "wayland" }),
    ).toThrow("requires WAYLAND_DISPLAY");
    expect(() =>
      selectDesktopBackend("win32", {
        DISPLAY: ":2",
        NAISYS_DESKTOP_BACKEND: "x11",
      }),
    ).toThrow("requires Linux");
    expect(() =>
      selectDesktopBackend("linux", { NAISYS_DESKTOP_BACKEND: "windows" }),
    ).toThrow("requires Windows or WSL");
    expect(() =>
      selectDesktopBackend("linux", { NAISYS_DESKTOP_BACKEND: "macos" }),
    ).toThrow("requires macOS");
  });
});
