/**
 * Computer interaction service.
 * Handles screenshots, mouse/keyboard actions, and display config.
 */

import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";

import { AgentConfig } from "../agent/agentConfig.js";
import { DesktopAction, DesktopConfig } from "../llm/vendors/vendorTypes.js";
import { OutputService } from "../utils/output.js";

// --- Screenshot capture ---

async function captureScreenshot(): Promise<{
  base64: string;
  width: number;
  height: number;
}> {
  const tmpFile = path.join(os.tmpdir(), `naisys-desktop-${Date.now()}.png`);

  try {
    if (process.platform === "win32") {
      // SetProcessDPIAware ensures we capture at native resolution on scaled displays.
      // GetCursorInfo + DrawIconEx draws the actual cursor onto the screenshot
      // (CopyFromScreen doesn't capture the cursor).
      const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ScreenCapture {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CURSORINFO pci);
  [DllImport("user32.dll")] public static extern bool DrawIconEx(IntPtr hdc, int x, int y, IntPtr hIcon, int w, int h, uint step, IntPtr brush, uint flags);
  public const uint DI_NORMAL = 3;
}
[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
[StructLayout(LayoutKind.Sequential)] public struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT ptScreenPos; }
"@
[ScreenCapture]::SetProcessDPIAware()
$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$b = New-Object System.Drawing.Bitmap($s.Width, $s.Height)
$g = [System.Drawing.Graphics]::FromImage($b)
try {
  $g.CopyFromScreen($s.Left, $s.Top, 0, 0, $s.Size)
  $ci = New-Object CURSORINFO
  $ci.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf([type][CURSORINFO])
  if ([ScreenCapture]::GetCursorInfo([ref]$ci)) {
    $hdc = $g.GetHdc()
    [ScreenCapture]::DrawIconEx($hdc, $ci.ptScreenPos.X - $s.Left, $ci.ptScreenPos.Y - $s.Top, $ci.hCursor, 0, 0, 0, [IntPtr]::Zero, [ScreenCapture]::DI_NORMAL)
    $g.ReleaseHdc($hdc)
  }
  $b.Save('${tmpFile}', [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $g.Dispose()
  $b.Dispose()
}
`.trim();

      execFileSync("powershell.exe", ["-NoProfile", "-Command", psScript], {
        stdio: "pipe",
      });
    } else {
      try {
        execFileSync("scrot", [tmpFile], { stdio: "pipe" });
      } catch {
        execFileSync("import", ["-window", "root", tmpFile], {
          stdio: "pipe",
        });
      }
    }

    const buffer = fs.readFileSync(tmpFile);
    const metadata = await sharp(buffer).metadata();

    return {
      base64: buffer.toString("base64"),
      width: metadata.width || 1920,
      height: metadata.height || 1080,
    };
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore cleanup errors */
    }
  }
}

// --- Action execution ---

function runPowerShell(command: string) {
  execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
    stdio: "pipe",
  });
}

const PS_INPUT_TYPE = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class NaisysInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, int d, IntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public const uint LEFTDOWN=2, LEFTUP=4, RIGHTDOWN=8, RIGHTUP=16, MIDDLEDOWN=32, MIDDLEUP=64, WHEEL=0x800;
  public const uint KEYEVENTF_KEYUP=2;
}
"@
[NaisysInput]::SetProcessDPIAware()
`.trim();

function mouseClick(x: number, y: number, button: "left" | "right" | "middle") {
  if (process.platform === "win32") {
    const down =
      button === "right"
        ? "RIGHTDOWN"
        : button === "middle"
          ? "MIDDLEDOWN"
          : "LEFTDOWN";
    const up =
      button === "right"
        ? "RIGHTUP"
        : button === "middle"
          ? "MIDDLEUP"
          : "LEFTUP";
    runPowerShell(
      `${PS_INPUT_TYPE}; [NaisysInput]::SetCursorPos(${x},${y}); Start-Sleep -Milliseconds 50; [NaisysInput]::mouse_event([NaisysInput]::${down},0,0,0,[IntPtr]::Zero); [NaisysInput]::mouse_event([NaisysInput]::${up},0,0,0,[IntPtr]::Zero)`,
    );
  } else {
    const btn = button === "right" ? "3" : button === "middle" ? "2" : "1";
    execFileSync("xdotool", ["mousemove", String(x), String(y), "click", btn]);
  }
}

function mouseDoubleClick(x: number, y: number) {
  if (process.platform === "win32") {
    runPowerShell(
      `${PS_INPUT_TYPE}; [NaisysInput]::SetCursorPos(${x},${y}); Start-Sleep -Milliseconds 50; [NaisysInput]::mouse_event([NaisysInput]::LEFTDOWN,0,0,0,[IntPtr]::Zero); [NaisysInput]::mouse_event([NaisysInput]::LEFTUP,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 50; [NaisysInput]::mouse_event([NaisysInput]::LEFTDOWN,0,0,0,[IntPtr]::Zero); [NaisysInput]::mouse_event([NaisysInput]::LEFTUP,0,0,0,[IntPtr]::Zero)`,
    );
  } else {
    execFileSync("xdotool", [
      "mousemove",
      String(x),
      String(y),
      "click",
      "--repeat",
      "2",
      "1",
    ]);
  }
}

function mouseMove(x: number, y: number) {
  if (process.platform === "win32") {
    runPowerShell(`${PS_INPUT_TYPE}; [NaisysInput]::SetCursorPos(${x},${y})`);
  } else {
    execFileSync("xdotool", ["mousemove", String(x), String(y)]);
  }
}

function mouseDrag(startX: number, startY: number, endX: number, endY: number) {
  if (process.platform === "win32") {
    runPowerShell(
      `${PS_INPUT_TYPE}; [NaisysInput]::SetCursorPos(${startX},${startY}); Start-Sleep -Milliseconds 50; [NaisysInput]::mouse_event([NaisysInput]::LEFTDOWN,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 50; [NaisysInput]::SetCursorPos(${endX},${endY}); Start-Sleep -Milliseconds 50; [NaisysInput]::mouse_event([NaisysInput]::LEFTUP,0,0,0,[IntPtr]::Zero)`,
    );
  } else {
    execFileSync("xdotool", [
      "mousemove",
      String(startX),
      String(startY),
      "mousedown",
      "1",
      "mousemove",
      String(endX),
      String(endY),
      "mouseup",
      "1",
    ]);
  }
}

function typeText(text: string) {
  if (process.platform === "win32") {
    runPowerShell(
      `Set-Clipboard -Value '${text.replace(/'/g, "''")}'; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')`,
    );
  } else {
    execFileSync("xdotool", ["type", "--clearmodifiers", text]);
  }
}

/** Map a key name to a Windows virtual-key code (hex string) for keybd_event */
function winVirtualKey(key: string): string {
  switch (key) {
    case "ctrl":
    case "control":
      return "0xA2";
    case "alt":
      return "0xA4";
    case "shift":
      return "0xA0";
    case "enter":
    case "return":
      return "0x0D";
    case "tab":
      return "0x09";
    case "escape":
    case "esc":
      return "0x1B";
    case "backspace":
      return "0x08";
    case "delete":
      return "0x2E";
    case "space":
      return "0x20";
    case "up":
      return "0x26";
    case "down":
      return "0x28";
    case "left":
      return "0x25";
    case "right":
      return "0x27";
    case "home":
      return "0x24";
    case "end":
      return "0x23";
    case "pageup":
    case "page_up":
      return "0x21";
    case "pagedown":
    case "page_down":
      return "0x22";
    default:
      if (key.startsWith("f") && key.length <= 3) {
        const n = parseInt(key.slice(1));
        return `0x${(0x6f + n).toString(16).toUpperCase()}`; // F1=0x70 …
      }
      // Single character — use its uppercase ASCII code (A=0x41, I=0x49, …)
      return `0x${key.toUpperCase().charCodeAt(0).toString(16).toUpperCase()}`;
  }
}

function pressKey(keyCombo: string) {
  if (process.platform === "win32") {
    const keys = keyCombo.split("+").map((k) => k.trim().toLowerCase());
    const hasWin = keys.some((k) => k === "win" || k === "super");

    if (hasWin) {
      // SendKeys has no Windows-key modifier — use keybd_event (VK_LWIN = 0x5B)
      const otherKeys = keys.filter((k) => k !== "win" && k !== "super");
      const presses = otherKeys.map(
        (k) =>
          `[NaisysInput]::keybd_event(${winVirtualKey(k)},0,0,[IntPtr]::Zero)`,
      );
      const releases = [...otherKeys].reverse().map(
        (k) =>
          `[NaisysInput]::keybd_event(${winVirtualKey(k)},0,[NaisysInput]::KEYEVENTF_KEYUP,[IntPtr]::Zero)`,
      );
      runPowerShell(
        [
          PS_INPUT_TYPE,
          `[NaisysInput]::keybd_event(0x5B,0,0,[IntPtr]::Zero)`,
          `Start-Sleep -Milliseconds 50`,
          ...presses,
          ...releases,
          `[NaisysInput]::keybd_event(0x5B,0,[NaisysInput]::KEYEVENTF_KEYUP,[IntPtr]::Zero)`,
        ].join("; "),
      );
      return;
    }

    const sendKeysStr = keys
      .map((key) => {
        switch (key) {
          case "ctrl":
          case "control":
            return "^";
          case "alt":
            return "%";
          case "shift":
            return "+";
          case "enter":
          case "return":
            return "{ENTER}";
          case "tab":
            return "{TAB}";
          case "escape":
          case "esc":
            return "{ESC}";
          case "backspace":
            return "{BACKSPACE}";
          case "delete":
            return "{DELETE}";
          case "space":
            return " ";
          case "up":
            return "{UP}";
          case "down":
            return "{DOWN}";
          case "left":
            return "{LEFT}";
          case "right":
            return "{RIGHT}";
          case "home":
            return "{HOME}";
          case "end":
            return "{END}";
          case "pageup":
          case "page_up":
            return "{PGUP}";
          case "pagedown":
          case "page_down":
            return "{PGDN}";
          default:
            if (key.startsWith("f") && key.length <= 3) {
              return `{${key.toUpperCase()}}`;
            }
            return key;
        }
      })
      .join("");
    runPowerShell(
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${sendKeysStr}')`,
    );
  } else {
    execFileSync("xdotool", ["key", keyCombo]);
  }
}

function mouseScroll(x: number, y: number, direction: string, amount: number) {
  if (process.platform === "win32") {
    const delta = direction === "up" ? 120 * amount : -120 * amount;
    runPowerShell(
      `${PS_INPUT_TYPE}; [NaisysInput]::SetCursorPos(${x},${y}); [NaisysInput]::mouse_event([NaisysInput]::WHEEL,0,0,${delta},[IntPtr]::Zero)`,
    );
  } else {
    const btn = direction === "up" ? "4" : "5";
    execFileSync("xdotool", [
      "mousemove",
      String(x),
      String(y),
      "click",
      "--repeat",
      String(amount),
      btn,
    ]);
  }
}

async function executeSingleAction(
  action: Record<string, unknown>,
): Promise<void> {
  const coord = action.coordinate as number[] | undefined;

  switch (action.action) {
    case "left_click":
      mouseClick(coord![0], coord![1], "left");
      break;
    case "right_click":
      mouseClick(coord![0], coord![1], "right");
      break;
    case "middle_click":
      mouseClick(coord![0], coord![1], "middle");
      break;
    case "double_click":
      mouseDoubleClick(coord![0], coord![1]);
      break;
    case "triple_click":
      mouseDoubleClick(coord![0], coord![1]);
      mouseClick(coord![0], coord![1], "left");
      break;
    case "type":
      typeText(action.text as string);
      break;
    case "key":
      pressKey(action.text as string);
      break;
    case "mouse_move":
      mouseMove(coord![0], coord![1]);
      break;
    case "left_click_drag": {
      const startCoord = action.start_coordinate as number[];
      mouseDrag(startCoord[0], startCoord[1], coord![0], coord![1]);
      break;
    }
    case "scroll":
      mouseScroll(
        coord![0],
        coord![1],
        action.scroll_direction as string,
        (action.scroll_amount as number) || 3,
      );
      break;
    case "screenshot":
      break; // no-op, screenshot is captured after
    case "wait":
      await new Promise((r) => setTimeout(r, 5000));
      break;
    default:
      break;
  }

  // Pause to let UI update after action
  await new Promise((r) => setTimeout(r, 2000));
}

/** Execute actions. All actions are stored as { actions: [...] } — single or batched. */
async function executeAction(action: DesktopAction["input"]): Promise<void> {
  for (const subAction of action.actions) {
    await executeSingleAction(subAction);
  }
}

// --- Display formatting ---

/** Format a single action for human-readable display */
function formatSingleAction(input: Record<string, unknown>): string {
  const action = input.action;
  const coordinate = input.coordinate as number[] | undefined;
  const coord = coordinate ? `(${coordinate.join(", ")})` : "";

  switch (action) {
    case "screenshot":
      return "Take screenshot";
    case "left_click":
      return `Left click at ${coord}`;
    case "right_click":
      return `Right click at ${coord}`;
    case "double_click":
      return `Double click at ${coord}`;
    case "triple_click":
      return `Triple click at ${coord}`;
    case "middle_click":
      return `Middle click at ${coord}`;
    case "type":
      return `Type "${input.text}"`;
    case "key":
      return `Press key "${input.text}"`;
    case "mouse_move":
      return `Move mouse to ${coord}`;
    case "scroll":
      return `Scroll ${input.scroll_direction} by ${input.scroll_amount} at ${coord}`;
    case "left_click_drag": {
      const startCoord = input.start_coordinate as number[] | undefined;
      return `Drag from (${startCoord?.join(", ")}) to ${coord}`;
    }
    case "wait":
      return "Wait";
    default:
      return `${action} ${JSON.stringify(input)}`;
  }
}

/** Format a computer use action for human-readable display. Actions are always { actions: [...] }. */
export function formatDesktopAction(input: DesktopAction["input"]): string {
  return input.actions.map(formatSingleAction).join(", then ");
}

// --- Service factory ---

export async function createComputerService(
  { agentConfig }: AgentConfig,
  output: OutputService,
) {
  let nativeDimensions: { width: number; height: number } | null = null;

  /** Capture screenshot at native resolution */
  async function capture(): Promise<{
    base64: string;
    width: number;
    height: number;
  }> {
    const result = await captureScreenshot();
    nativeDimensions = { width: result.width, height: result.height };
    return result;
  }

  // Seed native display dimensions on startup when desktop mode is enabled
  if (agentConfig().controlDesktop) {
    try {
      await capture();
    } catch (e) {
      output.errorAndLog(
        `Desktop: failed to capture initial screenshot — desktop mode disabled. ${e}`,
      );
    }
  }

  /** Execute an action using native screen coordinates */
  async function execute(action: DesktopAction["input"]) {
    await executeAction(action);
  }

  /** Build the DesktopConfig with native display dimensions. Returns undefined if init failed. */
  function getConfig(): DesktopConfig | undefined {
    if (!nativeDimensions) return undefined;
    return {
      displayWidth: nativeDimensions.width,
      displayHeight: nativeDimensions.height,
    };
  }

  return {
    captureScreenshot: capture,
    executeAction: execute,
    getConfig,
  };
}

export type ComputerService = Awaited<ReturnType<typeof createComputerService>>;
