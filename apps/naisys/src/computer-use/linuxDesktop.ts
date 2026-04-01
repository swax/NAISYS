/**
 * Linux-specific desktop interaction via xdotool / scrot.
 */

import { execFileSync } from "child_process";

export function captureScreenshot(tmpFile: string): void {
  try {
    execFileSync("scrot", [tmpFile], { stdio: "pipe" });
  } catch {
    execFileSync("import", ["-window", "root", tmpFile], {
      stdio: "pipe",
    });
  }
}

export function mouseClick(
  x: number,
  y: number,
  button: "left" | "right" | "middle",
) {
  const btn = button === "right" ? "3" : button === "middle" ? "2" : "1";
  execFileSync("xdotool", ["mousemove", String(x), String(y), "click", btn]);
}

export function mouseDoubleClick(x: number, y: number) {
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

export function mouseMove(x: number, y: number) {
  execFileSync("xdotool", ["mousemove", String(x), String(y)]);
}

export function mouseDrag(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
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

export function typeText(text: string) {
  execFileSync("xdotool", ["type", "--clearmodifiers", text]);
}

export function pressKey(keyCombo: string) {
  execFileSync("xdotool", ["key", keyCombo]);
}

export function mouseScroll(
  x: number,
  y: number,
  direction: string,
  amount: number,
) {
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
