import { beforeEach, describe, expect, test, vi } from "vitest";

const { execFileSync } = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFileSync,
}));

import { pressKey } from "../../computer-use/windowsDesktop.js";

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
    expect(args[2]).toContain("[NaisysInput]::keybd_event(0x5B,0,0");
    expect(args[2]).toContain("Start-Sleep -Milliseconds 50");
    expect(args[2]).toContain("[NaisysInput]::keybd_event(0x52,0,0");

    expect(args[2].indexOf("[NaisysInput]::keybd_event(0x5B,0,0")).toBeLessThan(
      args[2].indexOf("Start-Sleep -Milliseconds 50"),
    );
    expect(args[2].indexOf("Start-Sleep -Milliseconds 50")).toBeLessThan(
      args[2].indexOf("[NaisysInput]::keybd_event(0x52,0,0"),
    );
  });
});
