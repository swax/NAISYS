import { beforeEach, describe, expect, test, vi } from "vitest";

const { execFileSync } = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFileSync,
}));

import {
  checkDependencies,
  pressKey,
  typeText,
} from "../../../computer-use/desktops/macosDesktop.js";

const META_FLAG = 0x100000;
const SHIFT_FLAG = 0x20000;

function expectSubstringsInOrder(text: string, parts: string[]) {
  let cursor = -1;
  for (const part of parts) {
    const next = text.indexOf(part, cursor + 1);
    expect(next).toBeGreaterThan(cursor);
    cursor = next;
  }
}

describe("macosDesktop keyboard input", () => {
  beforeEach(() => {
    execFileSync.mockClear();
  });

  test("checks cliclick and System Events dependencies", () => {
    checkDependencies();

    expect(execFileSync).toHaveBeenNthCalledWith(
      1,
      "cliclick",
      ["p:."],
      { stdio: "pipe", timeout: 3000 },
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      "osascript",
      ["-e", 'tell application "System Events" to get name'],
      { stdio: "pipe", timeout: 5000 },
    );
  });

  test("surfaces missing System Events automation permission", () => {
    execFileSync
      .mockImplementationOnce(() => Buffer.from(""))
      .mockImplementationOnce(() => {
        throw {
          stderr: Buffer.from(
            "execution error: Not authorized to send Apple events to System Events. (-1743)",
          ),
        };
      });

    expect(() => checkDependencies()).toThrow(
      "Automation permission missing for System Events",
    );
  });

  test("pastes typed text through pbcopy and System Events", () => {
    typeText("hello\nthere");

    expect(execFileSync).toHaveBeenNthCalledWith(
      1,
      "pbcopy",
      [],
      {
        input: "hello\nthere",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 5000,
      },
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      "osascript",
      [
        "-e",
        'tell application "System Events" to keystroke "v" using command down',
      ],
      { stdio: "pipe", timeout: 5000 },
    );
  });

  test("dispatches sequential chords with settle gaps", () => {
    pressKey("Down Down Right");

    expect(execFileSync).toHaveBeenCalledTimes(5);
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      "cliclick",
      ["w:50"],
      { stdio: "pipe", timeout: 10000 },
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      4,
      "cliclick",
      ["w:50"],
      { stdio: "pipe", timeout: 10000 },
    );

    const keyScripts = execFileSync.mock.calls
      .filter(([command]) => command === "osascript")
      .map(([, args]) => args[3]);

    expect(keyScripts).toHaveLength(3);
    expect(keyScripts[0]).toContain(
      "var d0=$.CGEventCreateKeyboardEvent(null,125,true);",
    );
    expect(keyScripts[1]).toContain(
      "var d0=$.CGEventCreateKeyboardEvent(null,125,true);",
    );
    expect(keyScripts[2]).toContain(
      "var d0=$.CGEventCreateKeyboardEvent(null,124,true);",
    );
    for (const script of keyScripts) {
      expect(script).toContain("$.NSThread.sleepForTimeInterval(0.100);");
    }
  });

  test("tracks modifier flags through keydown and keyup events", () => {
    pressKey("cmd+shift+a");

    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(execFileSync.mock.calls[0][0]).toBe("osascript");
    expect(execFileSync.mock.calls[0][1][0]).toBe("-l");
    expect(execFileSync.mock.calls[0][1][1]).toBe("JavaScript");
    expect(execFileSync.mock.calls[0][1][2]).toBe("-e");
    expect(execFileSync.mock.calls[0][2]).toEqual({
      stdio: "pipe",
      timeout: 10100,
    });

    const script = execFileSync.mock.calls[0][1][3];
    const metaShift = META_FLAG | SHIFT_FLAG;

    expectSubstringsInOrder(script, [
      "ObjC.import('CoreGraphics');",
      `var d0=$.CGEventCreateKeyboardEvent(null,55,true);$.CGEventSetFlags(d0,${META_FLAG});$.CGEventPost(0,d0);`,
      `var d1=$.CGEventCreateKeyboardEvent(null,56,true);$.CGEventSetFlags(d1,${metaShift});$.CGEventPost(0,d1);`,
      `var d2=$.CGEventCreateKeyboardEvent(null,0,true);$.CGEventSetFlags(d2,${metaShift});$.CGEventPost(0,d2);`,
      "$.NSThread.sleepForTimeInterval(0.100);",
      `var u0=$.CGEventCreateKeyboardEvent(null,0,false);$.CGEventSetFlags(u0,${metaShift});$.CGEventPost(0,u0);`,
      `var u1=$.CGEventCreateKeyboardEvent(null,56,false);$.CGEventSetFlags(u1,${META_FLAG});$.CGEventPost(0,u1);`,
      "var u2=$.CGEventCreateKeyboardEvent(null,55,false);$.CGEventSetFlags(u2,0);$.CGEventPost(0,u2);",
    ]);
  });

  test("rejects unsupported key tokens", () => {
    expect(() => pressKey("insert")).toThrow(
      'Unsupported key for macOS keypress: "insert"',
    );
    expect(execFileSync).not.toHaveBeenCalled();
  });
});
