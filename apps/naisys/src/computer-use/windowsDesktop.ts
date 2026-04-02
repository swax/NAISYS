/**
 * Windows-specific desktop interaction via PowerShell / Win32 P/Invoke.
 * All coordinates are relative to the primary monitor.
 */

import { execFileSync } from "child_process";

function runPowerShell(command: string) {
  execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
    stdio: "pipe",
  });
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
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  public const uint LEFTDOWN=2, LEFTUP=4, RIGHTDOWN=8, RIGHTUP=16, MIDDLEDOWN=32, MIDDLEUP=64, WHEEL=0x800;
  public const uint KEYEVENTF_KEYUP=2;
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
  $b.Save('${tmpFile}', [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $g.Dispose()
  $b.Dispose()
}
`.trim();

  try {
    execFileSync("powershell.exe", ["-NoProfile", "-Command", psScript], {
      stdio: "pipe",
    });
  } catch (e: any) {
    throw new Error(
      `Windows screenshot capture failed. Ensure PowerShell and .NET Framework are available. ${e?.message || e}`,
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

export function pressKey(keyCombo: string) {
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
}

export function mouseScroll(
  x: number,
  y: number,
  direction: string,
  amount: number,
) {
  const delta = direction === "up" ? 120 * amount : -120 * amount;
  runPowerShell(
    `${PS_INPUT_TYPE}; [NaisysInput]::SetCursorPos($__s.Left+${x},$__s.Top+${y}); [NaisysInput]::mouse_event([NaisysInput]::WHEEL,0,0,${delta},[IntPtr]::Zero)`,
  );
}
