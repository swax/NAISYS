/**
 * Linux Wayland-specific desktop interaction via ydotool (input) and
 * grim / gnome-screenshot (screenshots).
 *
 * ydotool works at the kernel /dev/uinput level, so it is
 * compositor-agnostic (GNOME, KDE, sway, Hyprland, etc.).
 * Requires /dev/uinput access (add user to 'input' group).
 *
 * Supports both ydotool v0.1.x (Ubuntu package) and v1.0+ syntax.
 *
 * Screenshot capture tries grim (wlroots compositors) first,
 * then gnome-screenshot (GNOME), then the GNOME Shell D-Bus interface.
 */

import { execFileSync } from "child_process";

import type { ExecError } from "../execError.js";
import type {
  CanonicalKeyChord} from "../keyCombo.js";
import {
  normalizeKeyCombo,
  PRESS_KEY_HOLD_MS,
  toLinuxKeyToken,
} from "../keyCombo.js";

const YDOTOOL_TIMEOUT_MS = 10000;
const WAYLAND_KEY_SEQUENCE_SETTLE_MS = 50;

export function captureScreenshot(tmpFile: string): void {
  const errors: string[] = [];

  // grim: works on wlroots compositors (sway, Hyprland, etc.)
  try {
    execFileSync("grim", [tmpFile], { stdio: "pipe", timeout: 5000 });
    return;
  } catch (e) {
    const err = e as ExecError;
    errors.push(
      `grim: ${err.code === "ENOENT" ? "not installed" : err.stderr?.toString().trim() || err.message || err}`,
    );
  }

  // gnome-screenshot: works on GNOME Wayland
  try {
    execFileSync("gnome-screenshot", ["-f", tmpFile], {
      stdio: "pipe",
      timeout: 5000,
    });
    return;
  } catch (e) {
    const err = e as ExecError;
    errors.push(
      `gnome-screenshot: ${err.code === "ENOENT" ? "not installed" : err.stderr?.toString().trim() || err.message || err}`,
    );
  }

  // GNOME Shell D-Bus Screenshot interface
  try {
    execFileSync(
      "gdbus",
      [
        "call",
        "--session",
        "--dest",
        "org.gnome.Shell.Screenshot",
        "--object-path",
        "/org/gnome/Shell/Screenshot",
        "--method",
        "org.gnome.Shell.Screenshot.Screenshot",
        "true",
        "false",
        tmpFile,
      ],
      { stdio: "pipe", timeout: 5000 },
    );
    return;
  } catch (e) {
    const err = e as ExecError;
    errors.push(
      `gdbus: ${err.code === "ENOENT" ? "not installed" : err.stderr?.toString().trim() || err.message || err}`,
    );
  }

  throw new Error(
    `No Wayland screenshot tool available. Install one of: gnome-screenshot (GNOME), grim (sway/wlroots). Errors: ${errors.join("; ")}`,
  );
}

// --- ydotool version detection ---
// v0.1.x (Ubuntu package): mousemove <x> <y>, click <1|2|3>
// v1.0+: mousemove --absolute -x <x> -y <y>, click 0xC0

let ydotoolVersion: "legacy" | "modern" | undefined;

function detectYdotoolVersion(): "legacy" | "modern" {
  if (ydotoolVersion) return ydotoolVersion;
  try {
    const out = execFileSync("ydotool", ["mousemove", "--help"], {
      stdio: "pipe",
      timeout: 5000,
    }).toString();
    // v0.1.x: "Usage: mousemove [--delay <ms>] <x> <y>"
    // v1.0+:  "--absolute" appears in help
    ydotoolVersion = out.includes("--absolute") ? "modern" : "legacy";
  } catch {
    // If help fails, try legacy first (Ubuntu default)
    ydotoolVersion = "legacy";
  }
  return ydotoolVersion;
}

function ydotool(args: string[]) {
  try {
    execFileSync("ydotool", args, {
      stdio: "pipe",
      timeout: YDOTOOL_TIMEOUT_MS,
    });
  } catch (e) {
    if ((e as ExecError).code === "ENOENT") {
      throw new Error(
        "ydotool is not installed. Install it with: sudo apt install ydotool",
      );
    }
    throw e;
  }
}

function waitForInputSettle(ms: number) {
  // Wayland apps can miss rapid navigation keys when selection or focus changes
  // between events. A short blocking pause gives the compositor/app time to
  // observe the previous key before the next one arrives.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function moveTo(x: number, y: number) {
  if (detectYdotoolVersion() === "legacy") {
    ydotool(["mousemove", String(x), String(y)]);
  } else {
    ydotool(["mousemove", "--absolute", "-x", String(x), "-y", String(y)]);
  }
}

function clickButton(button: string) {
  if (detectYdotoolVersion() === "legacy") {
    // v0.1.x: 1=left, 2=right, 3=middle
    ydotool(["click", button]);
  } else {
    // v1.0+: hex codes — high nibble=action (C=click), low nibble=button (0=left,1=right,2=middle)
    const hexCode = button === "2" ? "0xC1" : button === "3" ? "0xC2" : "0xC0";
    ydotool(["click", hexCode]);
  }
}

export function mouseClick(
  x: number,
  y: number,
  button: "left" | "right" | "middle",
) {
  const btn = button === "right" ? "2" : button === "middle" ? "3" : "1";
  moveTo(x, y);
  clickButton(btn);
}

export function mouseDoubleClick(x: number, y: number) {
  moveTo(x, y);
  if (detectYdotoolVersion() === "legacy") {
    ydotool(["click", "--repeat", "2", "1"]);
  } else {
    ydotool(["click", "--repeat", "2", "--next-delay", "50", "0xC0"]);
  }
}

export function mouseMove(x: number, y: number) {
  moveTo(x, y);
}

export function mouseDrag(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
  // Drag is not well supported in v0.1.x — best-effort with move + click
  moveTo(startX, startY);
  if (detectYdotoolVersion() === "legacy") {
    // v0.1.x has no separate down/up — simulate with quick click-hold via key
    ydotool(["click", "--delay", "0", "1"]);
  } else {
    ydotool(["click", "--delay", "0", "0x40"]); // left down
  }
  moveTo(endX, endY);
  if (detectYdotoolVersion() === "legacy") {
    ydotool(["click", "--delay", "0", "1"]);
  } else {
    ydotool(["click", "--delay", "0", "0x80"]); // left up
  }
}

export function typeText(text: string) {
  ydotool(["type", "--", text]);
}

// Hold a chord for a duration. Emulators need a real held-down key, not
// repeated presses. This is the single primitive used by both pressKey
// (fixed 100ms) and holdKey (caller-specified duration).
function holdChord(chord: CanonicalKeyChord, durationMs: number) {
  const tokens = [...chord.modifiers, ...chord.keys];
  if (!tokens.length) return;

  if (detectYdotoolVersion() === "legacy") {
    const names = tokens.map(toLinuxKeyToken);
    for (const n of names) ydotool(["keydown", n]);
    waitForInputSettle(Math.round(durationMs));
    for (const n of [...names].reverse()) ydotool(["keyup", n]);
  } else {
    const codes = tokens.map(toWaylandKeycode);
    for (const c of codes) ydotool(["key", `${c}:1`]);
    waitForInputSettle(Math.round(durationMs));
    for (const c of [...codes].reverse()) ydotool(["key", `${c}:0`]);
  }
}

export function pressKey(keyCombo: string) {
  // Whitespace-separated tokens are pressed in sequence (e.g. "Down Down Right")
  // while a single token may still be a chord like "ctrl+c".
  const chords = normalizeKeyCombo(keyCombo);
  for (const [index, chord] of chords.entries()) {
    if (index > 0) waitForInputSettle(WAYLAND_KEY_SEQUENCE_SETTLE_MS);
    holdChord(chord, PRESS_KEY_HOLD_MS);
  }
}

// Linux input event codes (see /usr/include/linux/input-event-codes.h).
// ydotool v1.0+ takes these as `<code>:<state>` where state 1=down, 0=up.
const WAYLAND_KEYCODES: Record<string, number> = {
  ctrl: 29,
  alt: 56,
  shift: 42,
  meta: 125,
  enter: 28,
  tab: 15,
  escape: 1,
  backspace: 14,
  delete: 111,
  space: 57,
  up: 103,
  down: 108,
  left: 105,
  right: 106,
  home: 102,
  end: 107,
  pageup: 104,
  pagedown: 109,
  a: 30,
  b: 48,
  c: 46,
  d: 32,
  e: 18,
  f: 33,
  g: 34,
  h: 35,
  i: 23,
  j: 36,
  k: 37,
  l: 38,
  m: 50,
  n: 49,
  o: 24,
  p: 25,
  q: 16,
  r: 19,
  s: 31,
  t: 20,
  u: 22,
  v: 47,
  w: 17,
  x: 45,
  y: 21,
  z: 44,
  "1": 2,
  "2": 3,
  "3": 4,
  "4": 5,
  "5": 6,
  "6": 7,
  "7": 8,
  "8": 9,
  "9": 10,
  "0": 11,
};

function toWaylandKeycode(key: string): number {
  const code = WAYLAND_KEYCODES[key.toLowerCase()];
  if (code !== undefined) return code;
  if (/^f([1-9]|1[0-2])$/i.test(key)) {
    const n = parseInt(key.slice(1));
    return n <= 10 ? 58 + n : n === 11 ? 87 : 88; // F1=59..F10=68, F11=87, F12=88
  }
  throw new Error(`ydotool v1.0+ does not have a keycode for "${key}"`);
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
  if (direction === "left" || direction === "right") {
    // ydotool exposes only REL_WHEEL (vertical); no HWHEEL primitive in either
    // legacy click-button or modern `mousemove --wheel` modes. Reject rather
    // than silently scrolling vertically.
    throw new Error(
      `Horizontal scroll (${direction}) is not supported on Wayland — ydotool lacks an HWHEEL primitive. Use up/down only.`,
    );
  }
  moveTo(x, y);
  if (detectYdotoolVersion() === "legacy") {
    // v0.1.x: click button 4=up, 5=down (same as X11 convention)
    const btn = direction === "up" ? "4" : "5";
    ydotool(["click", "--repeat", String(amount), btn]);
  } else {
    // v1.0+: positive = up, negative = down
    const delta = direction === "up" ? amount : -amount;
    ydotool(["mousemove", "--wheel", "--", String(delta)]);
  }
}
