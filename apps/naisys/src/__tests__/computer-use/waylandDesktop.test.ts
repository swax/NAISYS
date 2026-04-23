import { beforeEach, describe, expect, test, vi } from "vitest";

const { execFileSync } = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFileSync,
}));

import { pressKey } from "../../computer-use/waylandDesktop.js";

describe("waylandDesktop keyboard input", () => {
  beforeEach(() => {
    execFileSync.mockClear();
  });

  test("dispatches sequential chords as separate ydotool invocations", () => {
    pressKey("Down Down Right");

    expect(execFileSync).toHaveBeenNthCalledWith(
      1,
      "ydotool",
      ["key", "Down"],
      { stdio: "pipe", timeout: 10000 },
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      "ydotool",
      ["key", "Down"],
      { stdio: "pipe", timeout: 10000 },
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      3,
      "ydotool",
      ["key", "Right"],
      { stdio: "pipe", timeout: 10000 },
    );
  });

  test("normalizes lowercase aliases into Linux key names", () => {
    pressKey("up enter pgdn meta+l");

    expect(execFileSync).toHaveBeenNthCalledWith(1, "ydotool", ["key", "Up"], {
      stdio: "pipe",
      timeout: 10000,
    });
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      "ydotool",
      ["key", "Return"],
      { stdio: "pipe", timeout: 10000 },
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      3,
      "ydotool",
      ["key", "Page_Down"],
      { stdio: "pipe", timeout: 10000 },
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      4,
      "ydotool",
      ["key", "super+l"],
      { stdio: "pipe", timeout: 10000 },
    );
  });
});
