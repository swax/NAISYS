/**
 * Linux X11-specific desktop interaction via xdotool / scrot.
 */

import { execFileSync } from "child_process";

import { normalizeKeyCombo, toLinuxKeyToken } from "./keyCombo.js";

const XDOTOOL_TIMEOUT_MS = 10000;
const X11_TYPE_DELAY_MS = "40";
const X11_KEY_DELAY_MS = "50";
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

function xdotool(args: string[]) {
  try {
    execFileSync("xdotool", args, {
      stdio: "pipe",
      timeout: XDOTOOL_TIMEOUT_MS,
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

function buildKeySequenceArgs(keyCombo: string): string[] {
  const chords = normalizeKeyCombo(keyCombo);
  const args: string[] = [];

  for (const [index, chord] of chords.entries()) {
    if (index > 0) {
      // Many X11 apps miss rapid navigation keys when their focus or selection
      // state changes between events. A short settle gap improves repeatability
      // without making sequences feel sluggish.
      args.push("sleep", X11_KEY_SEQUENCE_SETTLE_S);
    }

    const key = [...chord.modifiers, ...chord.keys]
      .map(toLinuxKeyToken)
      .join("+");

    if (!key) continue;
    args.push("key", "--clearmodifiers", "--delay", X11_KEY_DELAY_MS, key);
  }

  return args;
}

export function pressKey(keyCombo: string) {
  // Whitespace separates sequential chords ("Down Down Right") while `+`
  // stays inside a single chord ("ctrl+shift+t"). Run sequential chords as
  // separate xdotool commands with a tiny gap so slower apps can keep up.
  const args = buildKeySequenceArgs(keyCombo);
  if (!args.length) return;
  xdotool(args);
}

export function holdKey(keyCombo: string, durationMs: number) {
  // Hold means a single chord down for a duration — no sequences. Press all
  // modifiers and keys down, sleep, then release in reverse order. Emulators
  // sample input state per frame, so a real keydown/keyup is the only way to
  // get "walking" behavior; a stream of discrete key presses won't do it.
  const chords = normalizeKeyCombo(keyCombo);
  if (chords.length !== 1) {
    throw new Error(
      `hold requires a single key combo (e.g. "right" or "ctrl+right"), got ${chords.length} chords: "${keyCombo}"`,
    );
  }
  const chord = chords[0];
  const tokens = [...chord.modifiers, ...chord.keys].map(toLinuxKeyToken);
  if (!tokens.length) return;

  const args: string[] = [];
  for (const token of tokens) args.push("keydown", token);
  args.push("sleep", (durationMs / 1000).toString());
  for (const token of [...tokens].reverse()) args.push("keyup", token);
  xdotool(args);
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
