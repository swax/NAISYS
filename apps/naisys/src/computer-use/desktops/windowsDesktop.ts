/**
 * Windows-specific desktop interaction via PowerShell / Win32 P/Invoke.
 * All coordinates are relative to the primary monitor.
 *
 * Also used from WSL (powershell.exe is on WSL's PATH by default). When invoked
 * from WSL, file paths passed to PowerShell are translated via `wslpath -w`.
 */

import { execFileSync } from "child_process";

import type { ExecError } from "../execError.js";
import type {
  CanonicalKeyChord} from "../keyCombo.js";
import {
  normalizeKeyCombo,
  PRESS_KEY_HOLD_MS,
} from "../keyCombo.js";

function runPowerShell(command: string, timeoutMs: number = 10000) {
  execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
    stdio: "pipe",
    timeout: timeoutMs,
  });
}

/** Translate a Linux path to a Windows path when running on WSL. No-op on Windows. */
function toWindowsPath(p: string): string {
  if (process.platform === "win32") return p;
  return execFileSync("wslpath", ["-w", p], { encoding: "utf8" }).trim();
}

// P/Invoke declarations + DPI awareness + primary monitor bounds.
// SetProcessDpiAwarenessContext(-4) = Per-Monitor Aware v2 (Windows 10 1607+),
// falls back to SetProcessDPIAware for older systems.
// $__s holds the primary monitor bounds; SetCursorPos is offset by Left/Top
// so coordinates are always relative to the primary monitor.
const PS_INPUT_TYPE = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class NaisysInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, int d, IntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint uCode, uint uMapType);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  public const uint LEFTDOWN=2, LEFTUP=4, RIGHTDOWN=8, RIGHTUP=16, MIDDLEDOWN=32, MIDDLEUP=64, WHEEL=0x800, HWHEEL=0x1000;
  public const uint KEYEVENTF_KEYUP=2, KEYEVENTF_EXTENDEDKEY=1;
}
"@
try { [void][NaisysInput]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) } catch { }
[NaisysInput]::SetProcessDPIAware()
Add-Type -AssemblyName System.Windows.Forms
$__s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
`.trim();

export function captureScreenshot(tmpFile: string): void {
  // SetProcessDpiAwarenessContext ensures we capture at native resolution on scaled displays.
  // GetCursorInfo + DrawIconEx draws the actual cursor onto the screenshot
  // (CopyFromScreen doesn't capture the cursor).
  const winTmpFile = toWindowsPath(tmpFile);
  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ScreenCapture {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CURSORINFO pci);
  [DllImport("user32.dll")] public static extern bool DrawIconEx(IntPtr hdc, int x, int y, IntPtr hIcon, int w, int h, uint step, IntPtr brush, uint flags);
  public const uint DI_NORMAL = 3;
}
[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
[StructLayout(LayoutKind.Sequential)] public struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT ptScreenPos; }
"@
try { [void][ScreenCapture]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) } catch { }
[ScreenCapture]::SetProcessDPIAware()
$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$b = New-Object System.Drawing.Bitmap($s.Width, $s.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppRgb)
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
  $b.Save('${winTmpFile}', [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $g.Dispose()
  $b.Dispose()
}
`.trim();

  try {
    execFileSync("powershell.exe", ["-NoProfile", "-Command", psScript], {
      stdio: "pipe",
      timeout: 5000,
    });
  } catch (e) {
    const err = e as ExecError;
    throw new Error(
      `Windows screenshot capture failed. Ensure PowerShell and .NET Framework are available. ${err.message || err}`,
    );
  }
}

export function mouseClick(
  x: number,
  y: number,
  button: "left" | "right" | "middle",
) {
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
    `${PS_INPUT_TYPE}; [NaisysInput]::SetCursorPos($__s.Left+${x},$__s.Top+${y}); Start-Sleep -Milliseconds 50; [NaisysInput]::mouse_event([NaisysInput]::${down},0,0,0,[IntPtr]::Zero); [NaisysInput]::mouse_event([NaisysInput]::${up},0,0,0,[IntPtr]::Zero)`,
  );
}

export function mouseDoubleClick(x: number, y: number) {
  runPowerShell(
    `${PS_INPUT_TYPE}; [NaisysInput]::SetCursorPos($__s.Left+${x},$__s.Top+${y}); Start-Sleep -Milliseconds 50; [NaisysInput]::mouse_event([NaisysInput]::LEFTDOWN,0,0,0,[IntPtr]::Zero); [NaisysInput]::mouse_event([NaisysInput]::LEFTUP,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 50; [NaisysInput]::mouse_event([NaisysInput]::LEFTDOWN,0,0,0,[IntPtr]::Zero); [NaisysInput]::mouse_event([NaisysInput]::LEFTUP,0,0,0,[IntPtr]::Zero)`,
  );
}

export function mouseMove(x: number, y: number) {
  runPowerShell(
    `${PS_INPUT_TYPE}; [NaisysInput]::SetCursorPos($__s.Left+${x},$__s.Top+${y})`,
  );
}

export function mouseDrag(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
  runPowerShell(
    `${PS_INPUT_TYPE}; [NaisysInput]::SetCursorPos($__s.Left+${startX},$__s.Top+${startY}); Start-Sleep -Milliseconds 50; [NaisysInput]::mouse_event([NaisysInput]::LEFTDOWN,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 50; [NaisysInput]::SetCursorPos($__s.Left+${endX},$__s.Top+${endY}); Start-Sleep -Milliseconds 50; [NaisysInput]::mouse_event([NaisysInput]::LEFTUP,0,0,0,[IntPtr]::Zero)`,
  );
}

export function typeText(text: string) {
  runPowerShell(
    `Set-Clipboard -Value '${text.replace(/'/g, "''")}'; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')`,
  );
}

// VK_OEM_* codes for US-layout punctuation. Needed because punctuation
// char codes don't match Windows virtual-key codes (e.g. "/" is 0x2F = VK_HELP,
// not the slash key), so the generic ASCII fallback would fire the wrong key.
const WIN_PUNCTUATION_VK: Record<string, string> = {
  ";": "0xBA",
  "=": "0xBB",
  ",": "0xBC",
  "-": "0xBD",
  ".": "0xBE",
  "/": "0xBF",
  "`": "0xC0",
  "[": "0xDB",
  "\\": "0xDC",
  "]": "0xDD",
  "'": "0xDE",
};

/** Map a key name to a Windows virtual-key code (hex string) for keybd_event */
function winVirtualKey(key: string): string {
  switch (key) {
    case "ctrl":
      return "0xA2";
    case "alt":
      return "0xA4";
    case "shift":
      return "0xA0";
    case "meta":
      return "0x5B";
    case "enter":
      return "0x0D";
    case "tab":
      return "0x09";
    case "escape":
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
      return "0x21";
    case "pagedown":
      return "0x22";
    default:
      if (key.startsWith("f") && key.length <= 3) {
        const n = parseInt(key.slice(1));
        return `0x${(0x6f + n).toString(16).toUpperCase()}`; // F1=0x70 …
      }
      if (key.length === 1) {
        const punct = WIN_PUNCTUATION_VK[key];
        if (punct) return punct;
        const code = key.toUpperCase().charCodeAt(0);
        // Letters A-Z (0x41-0x5A) and digits 0-9 (0x30-0x39) map directly to
        // their VK codes. Anything else would hit unrelated VKs (e.g. VK_LWIN).
        if (
          (code >= 0x41 && code <= 0x5a) ||
          (code >= 0x30 && code <= 0x39)
        ) {
          return `0x${code.toString(16).toUpperCase()}`;
        }
      }
      throw new Error(
        `Windows does not have a virtual-key mapping for "${key}" — use typeText for arbitrary characters`,
      );
  }
}

// Keys that Windows flags as "extended" (set 1 in the scan-code map). Without
// KEYEVENTF_EXTENDEDKEY, the arrow/navigation events collide with numpad
// variants and many emulators reading raw input/DirectInput miss them.
const WIN_EXTENDED_KEYS = new Set([
  "up",
  "down",
  "left",
  "right",
  "home",
  "end",
  "pageup",
  "pagedown",
  "delete",
  "insert",
  "meta",
]);

// Generate a keybd_event PowerShell statement with a proper scan code
// (via MapVirtualKey) and the extended flag when needed. bScan=0 with no flag
// produces half-populated raw-input events that emulators can drop — this is
// why the 100ms hold alone wasn't enough to fix the "keys not registering"
// issue on Windows.
function winKeyEventStmt(key: string, up: boolean): string {
  const vk = winVirtualKey(key);
  const flags =
    (WIN_EXTENDED_KEYS.has(key) ? 1 : 0) | (up ? 2 : 0); // EXTENDED | KEYUP
  return `[NaisysInput]::keybd_event(${vk},[byte]([NaisysInput]::MapVirtualKey(${vk},0) -band 0xFF),${flags},[IntPtr]::Zero)`;
}

function holdChord(chord: CanonicalKeyChord, durationMs: number) {
  if (!chord.modifiers.length && !chord.keys.length) return;

  const hasMeta = chord.modifiers.includes("meta");
  const nonMetaModifiers = chord.modifiers.filter((mod) => mod !== "meta");
  const presses: string[] = [];
  const releases: string[] = [];

  if (hasMeta) presses.push(winKeyEventStmt("meta", false));
  for (const mod of nonMetaModifiers) presses.push(winKeyEventStmt(mod, false));

  if (hasMeta && (nonMetaModifiers.length > 0 || chord.keys.length > 0)) {
    // Windows shortcuts with the meta key are timing-sensitive. Give the
    // shell a moment to observe LWIN before sending the rest of the chord.
    presses.push("Start-Sleep -Milliseconds 50");
  }

  for (const key of chord.keys) presses.push(winKeyEventStmt(key, false));

  for (const key of [...chord.keys].reverse()) {
    releases.push(winKeyEventStmt(key, true));
  }
  for (const mod of [...nonMetaModifiers].reverse()) {
    releases.push(winKeyEventStmt(mod, true));
  }
  if (hasMeta) releases.push(winKeyEventStmt("meta", true));

  const sleepMs = Math.max(0, Math.round(durationMs));
  // The Start-Sleep runs inside PowerShell, so the subprocess timeout must
  // cover the full hold plus startup and keyup — otherwise a long hold would
  // SIGKILL the shell mid-sleep and strand the key down. PowerShell startup
  // (Add-Type compilation) can be slow, so use a generous 10s margin.
  runPowerShell(
    [
      PS_INPUT_TYPE,
      ...presses,
      `Start-Sleep -Milliseconds ${sleepMs}`,
      ...releases,
    ].join("; "),
    sleepMs + 10000,
  );
}

export function pressKey(keyCombo: string) {
  // Whitespace separates sequential chords ("Down Down Right"); `+` separates
  // modifiers within one chord ("ctrl+c"). Dispatch each chord as its own
  // PowerShell invocation so sequences behave consistently.
  const chords = normalizeKeyCombo(keyCombo);
  for (const chord of chords) {
    holdChord(chord, PRESS_KEY_HOLD_MS);
  }
}

export function holdKey(keyCombo: string, durationMs: number) {
  const chords = normalizeKeyCombo(keyCombo);
  if (chords.length !== 1) {
    throw new Error(
      `hold requires a single key combo (e.g. "right" or "ctrl+right"), got ${chords.length} chords: "${keyCombo}"`,
    );
  }
  holdChord(chords[0], durationMs);
}

export function mouseScroll(
  x: number,
  y: number,
  direction: string,
  amount: number,
) {
  // mouse_event sign conventions: WHEEL +=up/-=down; HWHEEL +=right/-=left.
  const isHorizontal = direction === "left" || direction === "right";
  const event = isHorizontal ? "HWHEEL" : "WHEEL";
  const positive = direction === "up" || direction === "right";
  const delta = (positive ? 120 : -120) * amount;
  runPowerShell(
    `${PS_INPUT_TYPE}; [NaisysInput]::SetCursorPos($__s.Left+${x},$__s.Top+${y}); [NaisysInput]::mouse_event([NaisysInput]::${event},0,0,${delta},[IntPtr]::Zero)`,
  );
}
