/**
 * Linux X11-specific desktop interaction via xdotool / scrot.
 */

import { execFileSync } from "child_process";

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
    execFileSync("xdotool", args, { stdio: "pipe", timeout: 10000 });
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
  // xdotool's default 12ms inter-char delay drops keys in browsers, VMs, and
  // Xvfb. 30ms is slow enough to be reliable and still feels instant.
  xdotool(["type", "--clearmodifiers", "--delay", "30", text]);
}

export function pressKey(keyCombo: string) {
  xdotool(["key", "--clearmodifiers", "--delay", "30", keyCombo]);
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
