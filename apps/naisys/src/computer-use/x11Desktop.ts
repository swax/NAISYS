/**
 * Linux X11-specific desktop interaction via xdotool / scrot.
 */

import { execFileSync } from "child_process";

import type {
  CanonicalKeyChord} from "./keyCombo.js";
import {
  normalizeKeyCombo,
  PRESS_KEY_HOLD_MS,
  toLinuxKeyToken,
} from "./keyCombo.js";

const XDOTOOL_TIMEOUT_MS = 10000;
const X11_TYPE_DELAY_MS = "40";
const X11_KEY_SEQUENCE_SETTLE_S = "0.05";

export function captureScreenshot(tmpFile: string): void {
  const errors: string[] = [];

  // scrot: common lightweight screenshot tool
  try {
    execFileSync("scrot", [tmpFile], { stdio: "pipe", timeout: 5000 });
    return;
  } catch (e: any) {
    errors.push(
      `scrot: ${e?.code === "ENOENT" ? "not installed" : e?.stderr?.toString?.()?.trim() || e?.message || e}`,
    );
  }

  // import: ImageMagick's screenshot tool
  try {
    execFileSync("import", ["-window", "root", tmpFile], {
      stdio: "pipe",
      timeout: 5000,
    });
    return;
  } catch (e: any) {
    errors.push(
      `import: ${e?.code === "ENOENT" ? "not installed" : e?.stderr?.toString?.()?.trim() || e?.message || e}`,
    );
  }

  throw new Error(
    `No X11 screenshot tool available. Install one of: scrot, imagemagick (for import). Errors: ${errors.join("; ")}`,
  );
}

function xdotool(args: string[], timeoutMs: number = XDOTOOL_TIMEOUT_MS) {
  try {
    execFileSync("xdotool", args, {
      stdio: "pipe",
      timeout: timeoutMs,
    });
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      throw new Error(
        "xdotool is not installed. Install it with: sudo apt install xdotool",
      );
    }
    const stderr = e?.stderr?.toString?.()?.trim();
    throw new Error(`xdotool failed: ${stderr || e?.message || e}`);
  }
}

export function checkDependencies(): void {
  try {
    execFileSync("xdotool", ["version"], { stdio: "pipe", timeout: 3000 });
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      throw new Error(
        "xdotool is not installed. Install it with: sudo apt install xdotool",
      );
    }
  }
}

export function mouseClick(
  x: number,
  y: number,
  button: "left" | "right" | "middle",
) {
  const btn = button === "right" ? "3" : button === "middle" ? "2" : "1";
  xdotool(["mousemove", String(x), String(y), "click", btn]);
}

export function mouseDoubleClick(x: number, y: number) {
  xdotool(["mousemove", String(x), String(y), "click", "--repeat", "2", "1"]);
}

export function mouseMove(x: number, y: number) {
  xdotool(["mousemove", String(x), String(y)]);
}

export function mouseDrag(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
  // Apps often need a short settle time after mousedown before they start
  // tracking drag motion — and a short pause before mouseup so the final
  // position is registered. Without these, drags can be ignored.
  xdotool([
    "mousemove",
    String(startX),
    String(startY),
    "mousedown",
    "1",
    "sleep",
    "0.1",
    "mousemove",
    String(endX),
    String(endY),
    "sleep",
    "0.05",
    "mouseup",
    "1",
  ]);
}

export function typeText(text: string) {
  if (!text) return;

  // xdotool's default 12ms inter-char delay drops keys in browsers, VMs, and
  // Xvfb. A slightly higher delay is slower on paper but materially more
  // reliable in practice while still feeling instant to humans.
  xdotool(["type", "--clearmodifiers", "--delay", X11_TYPE_DELAY_MS, text]);
}

// Hold a chord for a duration using chained keydown / sleep / keyup in one
// xdotool invocation. --clearmodifiers protects the press and release events
// themselves — it saves ambient modifiers, clears them, sends the event, then
// restores them — so an injected Right seen by an app at the press instant is
// Right alone, not Shift+Right. It does NOT cover the sleep window: because
// the modifiers are restored at the end of the keydown, a physically-held
// Shift is back on the kernel state during the hold and can combine with the
// held key. Good enough for agent use where the user typically isn't
// co-driving the keyboard. This is the single primitive used by both pressKey
// (fixed 100ms) and holdKey (caller duration).
function holdChord(chord: CanonicalKeyChord, durationMs: number) {
  const key = [...chord.modifiers, ...chord.keys]
    .map(toLinuxKeyToken)
    .join("+");
  if (!key) return;

  // The sleep runs inside xdotool, so the subprocess timeout must cover the
  // full hold plus startup and keyup — otherwise a 10s hold at the 10s default
  // timeout would SIGKILL xdotool mid-sleep and strand the key down.
  xdotool(
    [
      "keydown",
      "--clearmodifiers",
      key,
      "sleep",
      (durationMs / 1000).toString(),
      "keyup",
      "--clearmodifiers",
      key,
    ],
    durationMs + XDOTOOL_TIMEOUT_MS,
  );
}

export function pressKey(keyCombo: string) {
  // Whitespace separates sequential chords ("Down Down Right") while `+`
  // stays inside a single chord ("ctrl+shift+t"). Many X11 apps miss rapid
  // navigation keys when focus/selection changes between events, so we leave
  // a short settle between chords.
  const chords = normalizeKeyCombo(keyCombo);
  for (const [index, chord] of chords.entries()) {
    if (index > 0) {
      xdotool(["sleep", X11_KEY_SEQUENCE_SETTLE_S]);
    }
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
  const btn = direction === "up" ? "4" : "5";
  xdotool([
    "mousemove",
    String(x),
    String(y),
    "click",
    "--repeat",
    String(amount),
    btn,
  ]);
}
