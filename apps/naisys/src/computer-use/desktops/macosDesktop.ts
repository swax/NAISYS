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

import type { ExecError } from "../execError.js";
import type { CanonicalKeyChord, CanonicalModifier } from "../keyCombo.js";
import { normalizeKeyCombo, PRESS_KEY_HOLD_MS } from "../keyCombo.js";

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
      { stdio: "pipe", timeout: 5000 },
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

function cliclick(args: string[], timeoutMs: number = 10000) {
  try {
    execFileSync("cliclick", args, { stdio: "pipe", timeout: timeoutMs });
  } catch (e) {
    if ((e as ExecError).code === "ENOENT") {
      throw new Error(
        "cliclick is not installed. Install it with: brew install cliclick",
      );
    }
    throw e;
  }
}

/** Run a short JXA (JavaScript for Automation) snippet via osascript */
function jxa(script: string, timeoutMs: number = 10000) {
  execFileSync("osascript", ["-l", "JavaScript", "-e", script], {
    stdio: "pipe",
    timeout: timeoutMs,
  });
}

// --- Dependency check ---

/**
 * Verify that cliclick is installed (Accessibility permission) and that the
 * host can talk to System Events (Automation permission for typeText paste).
 * Called at init time to fail fast with actionable error messages instead
 * of timing out or erroring cryptically during action execution.
 */
export function checkDependencies(): void {
  try {
    // "p:." prints cursor position — read-only, non-destructive
    execFileSync("cliclick", ["p:."], { stdio: "pipe", timeout: 3000 });
  } catch (e) {
    const err = e as ExecError;
    if (err.code === "ENOENT") {
      throw new Error(
        "cliclick is not installed. Install it with: brew install cliclick",
      );
    }
    if (err.killed || err.code === "ETIMEDOUT" || err.signal === "SIGTERM") {
      throw new Error(
        "cliclick timed out — likely missing Accessibility permission. " +
          "Grant it in System Settings → Privacy & Security → Accessibility for your terminal app, " +
          "then restart the terminal.",
      );
    }
    // Other errors (e.g. non-zero exit) — at least it's installed and responsive
  }

  // typeText pastes via 'tell application "System Events" to keystroke …',
  // which needs Automation permission separate from the Accessibility
  // permission cliclick uses. Probe it here so a missing grant surfaces at
  // init rather than mid-action with a -1743 AppleEvent error.
  try {
    execFileSync(
      "osascript",
      ["-e", 'tell application "System Events" to get name'],
      { stdio: "pipe", timeout: 5000 },
    );
  } catch (e) {
    const err = e as ExecError;
    const stderr = err.stderr?.toString() ?? err.message ?? "";
    // errAEEventNotPermitted = -1743
    if (stderr.includes("-1743") || /not authoriz/i.test(stderr)) {
      throw new Error(
        "Automation permission missing for System Events — required by typeText to paste. " +
          "Grant it in System Settings → Privacy & Security → Automation, " +
          "find your terminal app, and enable 'System Events'.",
      );
    }
    if (err.killed || err.code === "ETIMEDOUT" || err.signal === "SIGTERM") {
      throw new Error(
        "System Events probe timed out — Automation permission may be missing. " +
          "Grant it in System Settings → Privacy & Security → Automation for your terminal, " +
          "then restart the terminal.",
      );
    }
    // Anything else (e.g. osascript missing — unlikely on macOS) we let
    // surface from the action itself rather than blocking startup.
  }
}

// --- Exported functions ---

export function captureScreenshot(tmpFile: string): void {
  try {
    // -x: no shutter sound, -C: include cursor
    execFileSync("screencapture", ["-x", "-C", tmpFile], {
      stdio: "pipe",
      timeout: 5000,
    });
  } catch (e) {
    const err = e as ExecError;
    throw new Error(
      `macOS screenshot failed. Grant Screen Recording permission in System Settings → Privacy & Security. ${err.message || err}`,
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
  execFileSync("pbcopy", [], {
    input: text,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 5000,
  });
  // Trigger paste via System Events keystroke. Layout-aware: it maps "v" to
  // whichever keycode produces 'v' on the active layout, so paste works on
  // Dvorak/AZERTY where cmd+kc=9 (the QWERTY V position) would resolve to a
  // different character. This needs Automation permission, validated by
  // checkDependencies.
  execFileSync(
    "osascript",
    [
      "-e",
      'tell application "System Events" to keystroke "v" using command down',
    ],
    { stdio: "pipe", timeout: 5000 },
  );
}

// --- Key delivery ---

// macOS virtual key codes for non-character keys (canonical names from
// CanonicalKeyChord) plus single ASCII letters/digits/symbols (US QWERTY
// layout assumed). Used to drive CGEventCreateKeyboardEvent so we can
// deliver real held-down keys for any key, matching what xdotool does on
// X11 and keybd_event does on Windows.
//
// Why not cliclick or AppleScript:
//   - cliclick's kd:/ku: only accept modifiers; kp: only accepts a fixed
//     special-keys list (no letters/digits). Both fail for most chords.
//   - AppleScript `keystroke`/`key code` only deliver an instant tap, not a
//     held-down key — emulator/game input then misses frames.
const KEY_CODES: Record<string, number> = {
  escape: 53,
  enter: 36,
  tab: 48,
  space: 49,
  backspace: 51,
  delete: 117,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  up: 126,
  down: 125,
  left: 123,
  right: 124,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111,
  f13: 105,
  f14: 107,
  f15: 113,
  f16: 106,
  a: 0,
  b: 11,
  c: 8,
  d: 2,
  e: 14,
  f: 3,
  g: 5,
  h: 4,
  i: 34,
  j: 38,
  k: 40,
  l: 37,
  m: 46,
  n: 45,
  o: 31,
  p: 35,
  q: 12,
  r: 15,
  s: 1,
  t: 17,
  u: 32,
  v: 9,
  w: 13,
  x: 7,
  y: 16,
  z: 6,
  "0": 29,
  "1": 18,
  "2": 19,
  "3": 20,
  "4": 21,
  "5": 23,
  "6": 22,
  "7": 26,
  "8": 28,
  "9": 25,
  "-": 27,
  "=": 24,
  "[": 33,
  "]": 30,
  "\\": 42,
  ";": 41,
  "'": 39,
  ",": 43,
  ".": 47,
  "/": 44,
  "`": 50,
};

// Modifier virtual keycodes (left-hand variants). Posting these as real
// keyDown/keyUp events alongside the flag mask makes apps that watch raw key
// events (emulators, games) see a genuine modifier press, not just a flag.
const MODIFIER_KEYCODES: Record<CanonicalModifier, number> = {
  meta: 55, // command (left)
  shift: 56,
  alt: 58, // option (left)
  ctrl: 59,
  fn: 63,
};

// CGEventFlags mask values (kCGEventFlagMask*). Applied via CGEventSetFlags
// so each posted event carries the modifier state the OS would have under
// real keyboard input.
const CG_FLAG_MASKS: Record<CanonicalModifier, number> = {
  meta: 0x100000,
  ctrl: 0x40000,
  alt: 0x80000,
  shift: 0x20000,
  fn: 0x800000,
};

// Hold a chord down for a duration via CGEventCreateKeyboardEvent: press
// modifiers (each one setting its flag), press keys, sleep, release in
// reverse (each modifier clearing its flag as it goes up). One JXA
// invocation handles the whole sequence so osascript startup (~50ms) is
// paid once per chord rather than per event.
function holdChord(chord: CanonicalKeyChord, durationMs: number) {
  if (!chord.modifiers.length && !chord.keys.length) return;

  type Event = { code: number; isDown: boolean; flags: number };
  const downs: Event[] = [];
  const ups: Event[] = [];

  // Track the modifier flag mask as events are generated. A modifier's
  // flag is set on its keyDown and cleared on its keyUp, so each event
  // carries the mask that would be active under real keyboard input —
  // apps that watch raw event flags don't see stale state (e.g. a cmd
  // keyUp wrongly advertising shift still down).
  let flags = 0;
  for (const m of chord.modifiers) {
    flags |= CG_FLAG_MASKS[m];
    downs.push({ code: MODIFIER_KEYCODES[m], isDown: true, flags });
  }
  for (const key of chord.keys) {
    const code = KEY_CODES[key];
    if (code === undefined) {
      throw new Error(
        `Unsupported key for macOS keypress: "${key}". ` +
          `Add a virtual keycode in KEY_CODES.`,
      );
    }
    downs.push({ code, isDown: true, flags });
  }
  // Release in reverse: keys first (modifiers still held), then modifiers
  // (each clearing its flag as it's released).
  for (let i = chord.keys.length - 1; i >= 0; i--) {
    ups.push({ code: KEY_CODES[chord.keys[i]], isDown: false, flags });
  }
  for (let i = chord.modifiers.length - 1; i >= 0; i--) {
    flags &= ~CG_FLAG_MASKS[chord.modifiers[i]];
    ups.push({
      code: MODIFIER_KEYCODES[chord.modifiers[i]],
      isDown: false,
      flags,
    });
  }

  const render = (ev: Event, name: string) =>
    `var ${name}=$.CGEventCreateKeyboardEvent(null,${ev.code},${ev.isDown});` +
    `$.CGEventSetFlags(${name},${ev.flags});$.CGEventPost(0,${name});`;

  const downsScript = downs.map((e, i) => render(e, `d${i}`)).join("\n");
  const upsScript = ups.map((e, i) => render(e, `u${i}`)).join("\n");

  const seconds = (Math.max(0, durationMs) / 1000).toFixed(3);
  // The sleep runs inside the JXA process, so the subprocess timeout must
  // cover the full hold plus startup and keyup — otherwise a long hold
  // would SIGKILL osascript mid-sleep and strand the key down.
  jxa(
    `ObjC.import('CoreGraphics');\n${downsScript}\n` +
      `$.NSThread.sleepForTimeInterval(${seconds});\n${upsScript}`,
    durationMs + 10000,
  );
}

export function pressKey(keyCombo: string) {
  // Whitespace separates sequential chords ("Down Down Right"); `+` separates
  // modifiers within a single chord ("ctrl+shift+t"). Each chord is held for
  // PRESS_KEY_HOLD_MS with a short settle between chords.
  const chords = normalizeKeyCombo(keyCombo);
  for (const [index, chord] of chords.entries()) {
    if (index > 0) cliclick(["w:50"]);
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
