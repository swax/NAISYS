import { beforeEach, describe, expect, test, vi } from "vitest";

const { execFileSync } = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFileSync,
}));

import { pressKey, typeText } from "../../../computer-use/desktops/x11Desktop.js";

describe("x11Desktop keyboard input", () => {
  beforeEach(() => {
    execFileSync.mockClear();
  });

  test("adds settle gaps between sequential key chords", () => {
    pressKey("Down Down Right");

    expect(execFileSync).toHaveBeenNthCalledWith(
      1,
      "xdotool",
      [
        "keydown",
        "--clearmodifiers",
        "Down",
        "sleep",
        "0.1",
        "keyup",
        "--clearmodifiers",
        "Down",
      ],
      { stdio: "pipe", timeout: 10100 },
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      "xdotool",
      ["sleep", "0.05"],
      { stdio: "pipe", timeout: 10000 },
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      3,
      "xdotool",
      [
        "keydown",
        "--clearmodifiers",
        "Down",
        "sleep",
        "0.1",
        "keyup",
        "--clearmodifiers",
        "Down",
      ],
      { stdio: "pipe", timeout: 10100 },
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      4,
      "xdotool",
      ["sleep", "0.05"],
      { stdio: "pipe", timeout: 10000 },
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      5,
      "xdotool",
      [
        "keydown",
        "--clearmodifiers",
        "Right",
        "sleep",
        "0.1",
        "keyup",
        "--clearmodifiers",
        "Right",
      ],
      { stdio: "pipe", timeout: 10100 },
    );
  });

  test("keeps modifier chords within a single key command", () => {
    pressKey("ctrl+shift+t");

    expect(execFileSync).toHaveBeenCalledWith(
      "xdotool",
      [
        "keydown",
        "--clearmodifiers",
        "ctrl+shift+t",
        "sleep",
        "0.1",
        "keyup",
        "--clearmodifiers",
        "ctrl+shift+t",
      ],
      { stdio: "pipe", timeout: 10100 },
    );
  });

  test("normalizes lowercase aliases into X11 key names", () => {
    pressKey("up enter pgdn meta+l");

    const keyCalls = execFileSync.mock.calls
      .map(([, args]) => args)
      .filter((args) => args[0] === "keydown");

    expect(keyCalls.map((args) => args[2])).toEqual([
      "Up",
      "Return",
      "Page_Down",
      "super+l",
    ]);
    for (const args of keyCalls) {
      expect(args).toEqual([
        "keydown",
        "--clearmodifiers",
        args[2],
        "sleep",
        "0.1",
        "keyup",
        "--clearmodifiers",
        args[2],
      ]);
    }
  });

  test("uses a slower text delay and ignores empty text", () => {
    typeText("");
    expect(execFileSync).not.toHaveBeenCalled();

    typeText("hello");

    expect(execFileSync).toHaveBeenCalledWith(
      "xdotool",
      ["type", "--clearmodifiers", "--delay", "40", "hello"],
      { stdio: "pipe", timeout: 10000 },
    );
  });
});
