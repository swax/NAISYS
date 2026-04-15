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

export function captureScreenshot(tmpFile: string): void {
  const errors: string[] = [];

  // grim: works on wlroots compositors (sway, Hyprland, etc.)
  try {
    execFileSync("grim", [tmpFile], { stdio: "pipe", timeout: 5000 });
    return;
  } catch (e: any) {
    errors.push(
      `grim: ${e?.code === "ENOENT" ? "not installed" : e?.stderr?.toString?.()?.trim() || e?.message || e}`,
    );
  }

  // gnome-screenshot: works on GNOME Wayland
  try {
    execFileSync("gnome-screenshot", ["-f", tmpFile], {
      stdio: "pipe",
      timeout: 5000,
    });
    return;
  } catch (e: any) {
    errors.push(
      `gnome-screenshot: ${e?.code === "ENOENT" ? "not installed" : e?.stderr?.toString?.()?.trim() || e?.message || e}`,
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
  } catch (e: any) {
    errors.push(
      `gdbus: ${e?.code === "ENOENT" ? "not installed" : e?.stderr?.toString?.()?.trim() || e?.message || e}`,
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
    execFileSync("ydotool", args, { stdio: "pipe", timeout: 10000 });
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      throw new Error(
        "ydotool is not installed. Install it with: sudo apt install ydotool",
      );
    }
    throw e;
  }
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

export function pressKey(keyCombo: string) {
  ydotool(["key", keyCombo]);
}

export function mouseScroll(
  x: number,
  y: number,
  direction: string,
  amount: number,
) {
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
