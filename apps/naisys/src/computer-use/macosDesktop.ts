/**
 * macOS-specific desktop interaction via screencapture (built-in) and
 * cliclick (mouse/keyboard input).
 *
 * Requirements:
 * - cliclick: `brew install cliclick`
 * - Accessibility permission for the terminal app
 *   (System Settings → Privacy & Security → Accessibility)
 * - Screen Recording permission for screenshots
 *   (System Settings → Privacy & Security → Screen Recording)
 *
 * On Retina/HiDPI displays, screenshots are captured at the native pixel
 * resolution (e.g. 2880×1800) while cliclick works in logical/point
 * coordinates (e.g. 1440×900). The backing scale factor is detected
 * automatically and coordinates are converted before input commands.
 */

import { execFileSync } from "child_process";

// --- Retina / HiDPI coordinate handling ---

let backingScaleFactor: number | undefined;

function getBackingScaleFactor(): number {
  if (backingScaleFactor !== undefined) return backingScaleFactor;
  try {
    const result = execFileSync(
      "osascript",
      [
        "-l",
        "JavaScript",
        "-e",
        "ObjC.import('AppKit'); $.NSScreen.mainScreen.backingScaleFactor",
      ],
      { stdio: "pipe" },
    )
      .toString()
      .trim();
    backingScaleFactor = parseFloat(result) || 1;
  } catch {
    backingScaleFactor = 1;
  }
  return backingScaleFactor;
}

/**
 * Convert pixel coordinates (from Retina screenshot) to logical/point
 * coordinates (for cliclick and CoreGraphics events).
 */
function toLogical(x: number, y: number): [number, number] {
  const scale = getBackingScaleFactor();
  return [Math.round(x / scale), Math.round(y / scale)];
}

// --- cliclick helper ---

function cliclick(args: string[]) {
  try {
    execFileSync("cliclick", args, { stdio: "pipe" });
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      throw new Error(
        "cliclick is not installed. Install it with: brew install cliclick",
      );
    }
    throw e;
  }
}

/** Run a short JXA (JavaScript for Automation) snippet via osascript */
function jxa(script: string) {
  execFileSync("osascript", ["-l", "JavaScript", "-e", script], {
    stdio: "pipe",
  });
}

// --- Exported functions ---

export function captureScreenshot(tmpFile: string): void {
  try {
    // -x: no shutter sound, -C: include cursor
    execFileSync("screencapture", ["-x", "-C", tmpFile], { stdio: "pipe" });
  } catch (e: any) {
    throw new Error(
      `macOS screenshot failed. Grant Screen Recording permission in System Settings → Privacy & Security. ${e?.message || e}`,
    );
  }
}

export function mouseClick(
  x: number,
  y: number,
  button: "left" | "right" | "middle",
) {
  const [lx, ly] = toLogical(x, y);
  if (button === "middle") {
    // cliclick doesn't support middle-click; use CoreGraphics events
    // kCGEventOtherMouseDown=25, kCGEventOtherMouseUp=26, button 2=middle, kCGHIDEventTap=0
    jxa(
      `
ObjC.import('CoreGraphics');
var p = {x: ${lx}, y: ${ly}};
$.CGEventPost(0, $.CGEventCreateMouseEvent(null, 25, p, 2));
$.CGEventPost(0, $.CGEventCreateMouseEvent(null, 26, p, 2));
    `.trim(),
    );
    return;
  }
  const cmd = button === "right" ? "rc" : "c";
  cliclick([`${cmd}:${lx},${ly}`]);
}

export function mouseDoubleClick(x: number, y: number) {
  const [lx, ly] = toLogical(x, y);
  cliclick([`dc:${lx},${ly}`]);
}

export function mouseMove(x: number, y: number) {
  const [lx, ly] = toLogical(x, y);
  cliclick([`m:${lx},${ly}`]);
}

export function mouseDrag(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
  const [lsx, lsy] = toLogical(startX, startY);
  const [lex, ley] = toLogical(endX, endY);
  cliclick([`dd:${lsx},${lsy}`, `du:${lex},${ley}`]);
}

export function typeText(text: string) {
  // Use clipboard paste for reliable handling of special/Unicode characters.
  // Pipe text to pbcopy via stdin to avoid shell escaping issues.
  execFileSync("pbcopy", [], { input: text, stdio: ["pipe", "pipe", "pipe"] });
  cliclick(["kd:cmd", "kp:v", "ku:cmd"]);
}

// --- Key mapping ---

const MODIFIERS = new Set([
  "ctrl",
  "control",
  "alt",
  "option",
  "shift",
  "super",
  "win",
  "cmd",
  "command",
  "meta",
  "fn",
]);

/** Map a modifier name to cliclick's modifier name */
function mapModifier(mod: string): string {
  switch (mod.toLowerCase()) {
    case "ctrl":
    case "control":
      return "ctrl";
    case "alt":
    case "option":
      return "alt";
    case "shift":
      return "shift";
    case "super":
    case "win":
    case "cmd":
    case "command":
    case "meta":
      return "cmd";
    case "fn":
      return "fn";
    default:
      return mod.toLowerCase();
  }
}

/** Map a key name to cliclick's key name */
function mapKey(key: string): string {
  switch (key.toLowerCase()) {
    case "return":
    case "enter":
      return "return";
    case "space":
      return "space";
    case "tab":
      return "tab";
    case "escape":
    case "esc":
      return "esc";
    case "backspace":
      return "delete";
    case "delete":
      return "fwd-delete";
    case "home":
      return "home";
    case "end":
      return "end";
    case "pageup":
    case "page_up":
      return "page-up";
    case "pagedown":
    case "page_down":
      return "page-down";
    case "up":
      return "arrow-up";
    case "down":
      return "arrow-down";
    case "left":
      return "arrow-left";
    case "right":
      return "arrow-right";
    default:
      // F-keys (f1–f16) and single characters pass through
      return key.toLowerCase();
  }
}

export function pressKey(keyCombo: string) {
  const parts = keyCombo.split("+").map((k) => k.trim());
  const mods = parts.filter((k) => MODIFIERS.has(k.toLowerCase()));
  const keys = parts.filter((k) => !MODIFIERS.has(k.toLowerCase()));

  const args: string[] = [];
  for (const mod of mods) args.push(`kd:${mapModifier(mod)}`);
  for (const key of keys) args.push(`kp:${mapKey(key)}`);
  for (const mod of [...mods].reverse()) args.push(`ku:${mapModifier(mod)}`);

  cliclick(args);
}

export function mouseScroll(
  x: number,
  y: number,
  direction: string,
  amount: number,
) {
  const [lx, ly] = toLogical(x, y);
  // Move to scroll position
  cliclick([`m:${lx},${ly}`]);

  // cliclick doesn't support scroll; use CoreGraphics scroll wheel events.
  // CGEventCreateScrollWheelEvent(source, units, wheelCount, wheel1[, wheel2])
  // kCGScrollEventUnitLine=0, kCGHIDEventTap=0
  if (direction === "left" || direction === "right") {
    const hDelta = direction === "left" ? amount : -amount;
    jxa(
      `
ObjC.import('CoreGraphics');
$.CGEventPost(0, $.CGEventCreateScrollWheelEvent(null, 0, 2, 0, ${hDelta}));
    `.trim(),
    );
  } else {
    const vDelta = direction === "up" ? amount : -amount;
    jxa(
      `
ObjC.import('CoreGraphics');
$.CGEventPost(0, $.CGEventCreateScrollWheelEvent(null, 0, 1, ${vDelta}));
    `.trim(),
    );
  }
}
