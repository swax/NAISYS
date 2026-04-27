import { beforeEach, describe, expect, test, vi } from "vitest";

const { execFileSync } = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFileSync,
}));

import { pressKey } from "../../../computer-use/desktops/windowsDesktop.js";

describe("windowsDesktop keyboard input", () => {
  beforeEach(() => {
    execFileSync.mockClear();
  });

  test("keeps a settle delay between meta-down and the rest of the chord", () => {
    pressKey("win+r");

    expect(execFileSync).toHaveBeenCalledTimes(1);

    const [command, args] = execFileSync.mock.calls[0];
    expect(command).toBe("powershell.exe");
    expect(args[0]).toBe("-NoProfile");
    expect(args[1]).toBe("-Command");
    expect(args[2]).toContain(
      "[NaisysInput]::keybd_event(0x5B,[byte]([NaisysInput]::MapVirtualKey(0x5B,0) -band 0xFF),1",
    );
    expect(args[2]).toContain("Start-Sleep -Milliseconds 50");
    expect(args[2]).toContain(
      "[NaisysInput]::keybd_event(0x52,[byte]([NaisysInput]::MapVirtualKey(0x52,0) -band 0xFF),0",
    );
    expect(args[2]).toContain("Start-Sleep -Milliseconds 100");

    expect(args[2].indexOf("[NaisysInput]::keybd_event(0x5B")).toBeLessThan(
      args[2].indexOf("Start-Sleep -Milliseconds 50"),
    );
    expect(args[2].indexOf("Start-Sleep -Milliseconds 50")).toBeLessThan(
      args[2].indexOf("[NaisysInput]::keybd_event(0x52"),
    );
    expect(args[2].indexOf("Start-Sleep -Milliseconds 100")).toBeLessThan(
      args[2].indexOf(
        "[NaisysInput]::keybd_event(0x52,[byte]([NaisysInput]::MapVirtualKey(0x52,0) -band 0xFF),2",
      ),
    );
    expect(execFileSync.mock.calls[0][2]).toEqual({
      stdio: "pipe",
      timeout: 10100,
    });
  });

  test("marks arrow key events as extended and releases with keyup flag", () => {
    pressKey("right");

    const script = execFileSync.mock.calls[0][1][2];
    expect(script).toContain(
      "[NaisysInput]::keybd_event(0x27,[byte]([NaisysInput]::MapVirtualKey(0x27,0) -band 0xFF),1",
    );
    expect(script).toContain(
      "[NaisysInput]::keybd_event(0x27,[byte]([NaisysInput]::MapVirtualKey(0x27,0) -band 0xFF),3",
    );
  });
});
