/**
 * Linux X11-specific desktop interaction via xdotool / scrot.
 */

import { execFileSync } from "child_process";

export function captureScreenshot(tmpFile: string): void {
  // scrot: common lightweight screenshot tool
  try {
    execFileSync("scrot", [tmpFile], { stdio: "pipe" });
    return;
  } catch {
    // not available
  }

  // import: ImageMagick's screenshot tool
  try {
    execFileSync("import", ["-window", "root", tmpFile], {
      stdio: "pipe",
    });
    return;
  } catch {
    // not available
  }

  throw new Error(
    "No X11 screenshot tool available. Install one of: scrot, imagemagick (for import)",
  );
}

function xdotool(args: string[]) {
  try {
    execFileSync("xdotool", args, { stdio: "pipe" });
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      throw new Error("xdotool is not installed. Install it with: sudo apt install xdotool");
    }
    throw e;
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
  xdotool([
    "mousemove",
    String(x),
    String(y),
    "click",
    "--repeat",
    "2",
    "1",
  ]);
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
  xdotool([
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

export function typeText(text: string) {
  xdotool(["type", "--clearmodifiers", text]);
}

export function pressKey(keyCombo: string) {
  xdotool(["key", keyCombo]);
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
