/**
 * Windows-specific desktop interaction via PowerShell / Win32 P/Invoke.
 * All coordinates are relative to the primary monitor.
 *
 * Also used from WSL (powershell.exe is on WSL's PATH by default). When invoked
 * from WSL, file paths passed to PowerShell are translated via `wslpath -w`.
 */

import { execFileSync } from "child_process";

import { normalizeKeyCombo } from "./keyCombo.js";

function runPowerShell(command: string) {
  execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
    stdio: "pipe",
    timeout: 10000,
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
      // Single character — use its uppercase ASCII code (A=0x41, I=0x49, …)
      return `0x${key.toUpperCase().charCodeAt(0).toString(16).toUpperCase()}`;
  }
}

export function pressKey(keyCombo: string) {
  // Whitespace separates sequential chords ("Down Down Right"); `+` separates
  // modifiers within one chord ("ctrl+c"). Dispatch each chord individually so
  // the existing single-chord paths (SendKeys vs. keybd_event) keep working.
  const chords = normalizeKeyCombo(keyCombo);
  if (chords.length > 1) {
    for (const chord of chords) {
      pressKey([...chord.modifiers, ...chord.keys].join("+"));
    }
    return;
  }

  const chord = chords[0];
  if (!chord) return;

  const parts = [...chord.modifiers, ...chord.keys];
  if (!parts.length) return;
  const hasMeta = chord.modifiers.includes("meta");

  if (hasMeta || chord.keys.length === 0) {
    const nonMetaModifiers = chord.modifiers.filter((mod) => mod !== "meta");
    const presses: string[] = [];
    const releases: string[] = [];

    if (hasMeta) {
      presses.push(
        `[NaisysInput]::keybd_event(${winVirtualKey("meta")},0,0,[IntPtr]::Zero)`,
      );
    }

    for (const mod of nonMetaModifiers) {
      presses.push(
        `[NaisysInput]::keybd_event(${winVirtualKey(mod)},0,0,[IntPtr]::Zero)`,
      );
    }

    if (hasMeta && (nonMetaModifiers.length > 0 || chord.keys.length > 0)) {
      // Windows shortcuts with the meta key are timing-sensitive. Give the
      // shell a moment to observe LWIN before sending the rest of the chord.
      presses.push("Start-Sleep -Milliseconds 50");
    }

    for (const key of chord.keys) {
      presses.push(
        `[NaisysInput]::keybd_event(${winVirtualKey(key)},0,0,[IntPtr]::Zero)`,
      );
    }

    for (const key of [...chord.keys].reverse()) {
      releases.push(
        `[NaisysInput]::keybd_event(${winVirtualKey(key)},0,[NaisysInput]::KEYEVENTF_KEYUP,[IntPtr]::Zero)`,
      );
    }

    for (const mod of [...nonMetaModifiers].reverse()) {
      releases.push(
        `[NaisysInput]::keybd_event(${winVirtualKey(mod)},0,[NaisysInput]::KEYEVENTF_KEYUP,[IntPtr]::Zero)`,
      );
    }

    if (hasMeta) {
      releases.push(
        `[NaisysInput]::keybd_event(${winVirtualKey("meta")},0,[NaisysInput]::KEYEVENTF_KEYUP,[IntPtr]::Zero)`,
      );
    }

    runPowerShell([PS_INPUT_TYPE, ...presses, ...releases].join("; "));
    return;
  }

  const sendKeysStr = parts
    .map((part) => {
      switch (part) {
        case "ctrl":
          return "^";
        case "alt":
          return "%";
        case "shift":
          return "+";
        case "enter":
          return "{ENTER}";
        case "tab":
          return "{TAB}";
        case "escape":
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
          return "{PGUP}";
        case "pagedown":
          return "{PGDN}";
        default:
          if (part.startsWith("f") && part.length <= 3) {
            return `{${part.toUpperCase()}}`;
          }
          return part;
      }
    })
    .join("");
  runPowerShell(
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${sendKeysStr}')`,
  );
}

export function holdKey(keyCombo: string, durationMs: number) {
  // Hold a single chord down for a duration using keybd_event down + Start-Sleep
  // + keybd_event up. Emulators sample key state per frame, so a stream of
  // presses won't register as "held" — we need a real kept-down key.
  const chords = normalizeKeyCombo(keyCombo);
  if (chords.length !== 1) {
    throw new Error(
      `hold requires a single key combo (e.g. "right" or "ctrl+right"), got ${chords.length} chords: "${keyCombo}"`,
    );
  }
  const chord = chords[0];
  const tokens = [...chord.modifiers, ...chord.keys];
  if (!tokens.length) return;

  const downs = tokens.map(
    (t) => `[NaisysInput]::keybd_event(${winVirtualKey(t)},0,0,[IntPtr]::Zero)`,
  );
  const ups = [...tokens]
    .reverse()
    .map(
      (t) =>
        `[NaisysInput]::keybd_event(${winVirtualKey(t)},0,[NaisysInput]::KEYEVENTF_KEYUP,[IntPtr]::Zero)`,
    );
  const sleepMs = Math.max(0, Math.round(durationMs));
  runPowerShell(
    [
      PS_INPUT_TYPE,
      ...downs,
      `Start-Sleep -Milliseconds ${sleepMs}`,
      ...ups,
    ].join("; "),
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
