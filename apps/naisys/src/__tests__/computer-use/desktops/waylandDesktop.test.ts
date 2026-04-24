import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { execFileSync } = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFileSync,
}));

import { pressKey } from "../../../computer-use/desktops/waylandDesktop.js";

describe("waylandDesktop keyboard input", () => {
  beforeEach(() => {
    execFileSync.mockClear();
    vi.spyOn(Atomics, "wait").mockReturnValue("timed-out");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("dispatches sequential chords as held keydown/keyup invocations", () => {
    pressKey("Down Down Right");

    const keyCalls = execFileSync.mock.calls
      .map(([, args]) => args)
      .filter((args) => args[0] === "keydown" || args[0] === "keyup");

    expect(keyCalls).toEqual([
      ["keydown", "Down"],
      ["keyup", "Down"],
      ["keydown", "Down"],
      ["keyup", "Down"],
      ["keydown", "Right"],
      ["keyup", "Right"],
    ]);
    expect(Atomics.wait).toHaveBeenCalledWith(
      expect.any(Int32Array),
      0,
      0,
      100,
    );
    expect(Atomics.wait).toHaveBeenCalledWith(
      expect.any(Int32Array),
      0,
      0,
      50,
    );
  });

  test("normalizes lowercase aliases into Linux key names", () => {
    pressKey("up enter pgdn meta+l");

    const downKeys = execFileSync.mock.calls
      .map(([, args]) => args)
      .filter((args) => args[0] === "keydown")
      .map((args) => args[1]);

    expect(downKeys).toEqual(["Up", "Return", "Page_Down", "super", "l"]);
  });
});
