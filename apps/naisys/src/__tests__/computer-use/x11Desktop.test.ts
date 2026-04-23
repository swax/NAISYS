import { beforeEach, describe, expect, test, vi } from "vitest";

const { execFileSync } = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFileSync,
}));

import { pressKey, typeText } from "../../computer-use/x11Desktop.js";

describe("x11Desktop keyboard input", () => {
  beforeEach(() => {
    execFileSync.mockClear();
  });

  test("adds settle gaps between sequential key chords", () => {
    pressKey("Down Down Right");

    expect(execFileSync).toHaveBeenCalledWith(
      "xdotool",
      [
        "key",
        "--clearmodifiers",
        "--delay",
        "50",
        "Down",
        "sleep",
        "0.05",
        "key",
        "--clearmodifiers",
        "--delay",
        "50",
        "Down",
        "sleep",
        "0.05",
        "key",
        "--clearmodifiers",
        "--delay",
        "50",
        "Right",
      ],
      { stdio: "pipe", timeout: 10000 },
    );
  });

  test("keeps modifier chords within a single key command", () => {
    pressKey("ctrl+shift+t");

    expect(execFileSync).toHaveBeenCalledWith(
      "xdotool",
      ["key", "--clearmodifiers", "--delay", "50", "ctrl+shift+t"],
      { stdio: "pipe", timeout: 10000 },
    );
  });

  test("normalizes lowercase aliases into X11 key names", () => {
    pressKey("up enter pgdn meta+l");

    expect(execFileSync).toHaveBeenCalledWith(
      "xdotool",
      [
        "key",
        "--clearmodifiers",
        "--delay",
        "50",
        "Up",
        "sleep",
        "0.05",
        "key",
        "--clearmodifiers",
        "--delay",
        "50",
        "Return",
        "sleep",
        "0.05",
        "key",
        "--clearmodifiers",
        "--delay",
        "50",
        "Page_Down",
        "sleep",
        "0.05",
        "key",
        "--clearmodifiers",
        "--delay",
        "50",
        "super+l",
      ],
      { stdio: "pipe", timeout: 10000 },
    );
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
