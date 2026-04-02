/**
 * Computer interaction service.
 * Handles screenshots, mouse/keyboard actions, and display config.
 * Platform-specific code lives in windowsDesktop.ts / linuxDesktop.ts.
 */

import { TARGET_MEGAPIXELS } from "@naisys/common";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";

import { AgentConfig } from "../agent/agentConfig.js";
import { DesktopAction, DesktopConfig } from "../llm/vendors/vendorTypes.js";
import { OutputService } from "../utils/output.js";
import * as linuxDesktop from "./linuxDesktop.js";
import * as windowsDesktop from "./windowsDesktop.js";

const platform = process.platform === "win32" ? windowsDesktop : linuxDesktop;

// --- Screenshot cleanup ---

const SCREENSHOT_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const SCREENSHOT_DIR = path.join(os.tmpdir(), "naisys");
let cleanupStarted = false;

function startScreenshotCleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const clean = () => {
    try {
      const now = Date.now();
      for (const file of fs.readdirSync(SCREENSHOT_DIR)) {
        const filepath = path.join(SCREENSHOT_DIR, file);
        const stat = fs.statSync(filepath);
        if (stat.isFile() && now - stat.mtimeMs > SCREENSHOT_MAX_AGE_MS) {
          fs.unlinkSync(filepath);
        }
      }
    } catch { /* ignore */ }
  };

  clean();
  setInterval(clean, SCREENSHOT_MAX_AGE_MS).unref();
}

// --- Screenshot capture ---

async function captureScreenshot(username: string): Promise<{
  base64: string;
  width: number;
  height: number;
  filepath: string;
}> {
  const filepath = path.join(SCREENSHOT_DIR, `${username}-${Date.now()}.png`);

  platform.captureScreenshot(filepath);

  const buffer = fs.readFileSync(filepath);
  const metadata = await sharp(buffer).metadata();

  return {
    base64: buffer.toString("base64"),
    width: metadata.width || 1920,
    height: metadata.height || 1080,
    filepath,
  };
}

// --- Action execution ---

async function executeSingleAction(
  action: Record<string, unknown>,
): Promise<void> {
  const coord = action.coordinate as number[] | undefined;

  switch (action.action) {
    case "left_click":
      platform.mouseClick(coord![0], coord![1], "left");
      break;
    case "right_click":
      platform.mouseClick(coord![0], coord![1], "right");
      break;
    case "middle_click":
      platform.mouseClick(coord![0], coord![1], "middle");
      break;
    case "double_click":
      platform.mouseDoubleClick(coord![0], coord![1]);
      break;
    case "triple_click":
      platform.mouseDoubleClick(coord![0], coord![1]);
      platform.mouseClick(coord![0], coord![1], "left");
      break;
    case "type":
      platform.typeText(action.text as string);
      break;
    case "key":
      platform.pressKey(action.text as string);
      break;
    case "mouse_move":
      platform.mouseMove(coord![0], coord![1]);
      break;
    case "left_click_drag": {
      const startCoord = action.start_coordinate as number[];
      platform.mouseDrag(startCoord[0], startCoord[1], coord![0], coord![1]);
      break;
    }
    case "scroll":
      platform.mouseScroll(
        coord![0],
        coord![1],
        action.scroll_direction as string,
        (action.scroll_amount as number) || 3,
      );
      break;
    case "screenshot":
      break; // no-op, screenshot is captured after
    case "wait":
      await new Promise((r) => setTimeout(r, 5000));
      break;
    default:
      break;
  }

  // Pause to let UI update after action
  await new Promise((r) => setTimeout(r, 2000));
}

/** Execute actions. All actions are stored as { actions: [...] } — single or batched. */
async function executeAction(action: DesktopAction["input"]): Promise<void> {
  for (const subAction of action.actions) {
    await executeSingleAction(subAction);
  }
}

// --- Shared scaling logic ---

/**
 * Compute a scale factor to fit the native resolution into TARGET_MEGAPIXELS
 * while maintaining aspect ratio. The scaled width is rounded down to a
 * multiple of 20 so the result stays at or under the target.
 * Returns 1 if the native resolution is already at or below the target.
 */
export function getTargetScaleFactor(nativeWidth: number, nativeHeight: number): number {
  const nativePixels = nativeWidth * nativeHeight;
  const targetPixels = TARGET_MEGAPIXELS * 1_000_000;

  if (nativePixels <= targetPixels) return 1;

  const aspectRatio = nativeWidth / nativeHeight;
  const exactWidth = Math.sqrt(targetPixels * aspectRatio);
  const roundedWidth = Math.floor(exactWidth / 20) * 20;

  return Math.min(1, roundedWidth / nativeWidth);
}

// --- Shared image/coordinate helpers (used by vendor computer-use modules) ---

/** Resize a base64 screenshot to fit within a vendor's constraints */
export async function resizeScreenshot(
  base64: string,
  scaleFactor: number,
  nativeWidth: number,
  nativeHeight: number,
): Promise<string> {
  if (scaleFactor >= 1) return base64;
  const scaledWidth = Math.floor(nativeWidth * scaleFactor);
  const scaledHeight = Math.floor(nativeHeight * scaleFactor);
  const resized = await sharp(Buffer.from(base64, "base64"))
    .resize(scaledWidth, scaledHeight)
    .png()
    .toBuffer();
  return resized.toString("base64");
}

/** Scale coordinates in a computer use action from API space back to native screen space */
export function scaleActionToNative(
  input: Record<string, unknown>,
  scaleFactor: number,
): Record<string, unknown> {
  if (scaleFactor >= 1) return input;

  const result = { ...input };
  if (Array.isArray(result.coordinate)) {
    result.coordinate = [
      Math.round((result.coordinate as number[])[0] / scaleFactor),
      Math.round((result.coordinate as number[])[1] / scaleFactor),
    ];
  }
  if (Array.isArray(result.start_coordinate)) {
    result.start_coordinate = [
      Math.round((result.start_coordinate as number[])[0] / scaleFactor),
      Math.round((result.start_coordinate as number[])[1] / scaleFactor),
    ];
  }
  return result;
}

/**
 * Check if any coordinates in an action exceed native screen bounds.
 * Returns an error message referencing the API-space coordinates and
 * the scaled resolution the LLM was told, or undefined if all OK.
 */
export function checkActionBounds(
  input: DesktopAction["input"],
  nativeWidth: number,
  nativeHeight: number,
  coordScale: CoordScale,
): string | undefined {
  const apiW = Math.round(nativeWidth * coordScale.x);
  const apiH = Math.round(nativeHeight * coordScale.y);

  for (const action of input.actions) {
    const coord = action.coordinate as number[] | undefined;
    if (coord && (coord[0] >= nativeWidth || coord[1] >= nativeHeight || coord[0] < 0 || coord[1] < 0)) {
      const apiX = Math.round(coord[0] * coordScale.x);
      const apiY = Math.round(coord[1] * coordScale.y);
      return `Coordinate (${apiX}, ${apiY}) is outside the screen resolution ${apiW}x${apiH}`;
    }
    const startCoord = action.start_coordinate as number[] | undefined;
    if (startCoord && (startCoord[0] >= nativeWidth || startCoord[1] >= nativeHeight || startCoord[0] < 0 || startCoord[1] < 0)) {
      const apiX = Math.round(startCoord[0] * coordScale.x);
      const apiY = Math.round(startCoord[1] * coordScale.y);
      return `Start coordinate (${apiX}, ${apiY}) is outside the screen resolution ${apiW}x${apiH}`;
    }
  }
  return undefined;
}

// --- Display formatting ---

/** Coordinate scale for converting native screen coordinates to API-space coordinates */
export interface CoordScale {
  x: number;
  y: number;
}

/** Format a coordinate pair, optionally showing API-space coordinates */
function fmtCoord(
  coord: number[],
  scale?: CoordScale,
): string {
  if (!scale) return `(${coord.join(", ")})`;
  const apiX = Math.round(coord[0] * scale.x);
  const apiY = Math.round(coord[1] * scale.y);
  return `(${apiX}, ${apiY}) → screen (${coord.join(", ")})`;
}

/** Format a single action for human-readable display */
function formatSingleAction(
  input: Record<string, unknown>,
  scale?: CoordScale,
): string {
  const action = input.action;
  const coordinate = input.coordinate as number[] | undefined;
  const coord = coordinate ? fmtCoord(coordinate, scale) : "";

  switch (action) {
    case "screenshot":
      return "Take screenshot";
    case "left_click":
      return `Left click at ${coord}`;
    case "right_click":
      return `Right click at ${coord}`;
    case "double_click":
      return `Double click at ${coord}`;
    case "triple_click":
      return `Triple click at ${coord}`;
    case "middle_click":
      return `Middle click at ${coord}`;
    case "type":
      return `Type "${input.text}"`;
    case "key":
      return `Press key "${input.text}"`;
    case "mouse_move":
      return `Move mouse to ${coord}`;
    case "scroll":
      return `Scroll ${input.scroll_direction} by ${input.scroll_amount} at ${coord}`;
    case "left_click_drag": {
      const startCoord = input.start_coordinate as number[] | undefined;
      const startStr = startCoord ? fmtCoord(startCoord, scale) : "";
      return `Drag from ${startStr} to ${coord}`;
    }
    case "wait":
      return "Wait";
    default:
      return `${action} ${JSON.stringify(input)}`;
  }
}

/** Format a computer use action for human-readable display. Actions are always { actions: [...] }. */
export function formatDesktopAction(
  input: DesktopAction["input"],
  coordScale?: CoordScale,
): string {
  return input.actions.map((a) => formatSingleAction(a, coordScale)).join(", then ");
}

/** Format a batch of desktop actions for human-readable display */
export function formatDesktopActions(
  actions: DesktopAction[],
  coordScale?: CoordScale,
): string {
  return actions.map((a) => formatDesktopAction(a.input, coordScale)).join(", then ");
}

// --- Service factory ---

export async function createComputerService(
  { agentConfig }: AgentConfig,
  output: OutputService,
) {
  startScreenshotCleanup();
  let nativeDimensions: { width: number; height: number } | null = null;

  /** Capture screenshot at native resolution */
  async function capture(): Promise<{
    base64: string;
    width: number;
    height: number;
    filepath: string;
  }> {
    const result = await captureScreenshot(agentConfig().username);
    nativeDimensions = { width: result.width, height: result.height };
    return result;
  }

  // Seed native display dimensions on startup when desktop mode is enabled
  if (agentConfig().controlDesktop) {
    try {
      await capture();
    } catch (e) {
      output.errorAndLog(
        `Desktop: failed to capture initial screenshot — desktop mode disabled. ${e}`,
      );
    }
  }

  /** Execute an action using native screen coordinates */
  async function execute(action: DesktopAction["input"]) {
    await executeAction(action);
  }

  /** Build the DesktopConfig with native display dimensions. Returns undefined if init failed. */
  function getConfig(): DesktopConfig | undefined {
    if (!nativeDimensions) return undefined;
    return {
      displayWidth: nativeDimensions.width,
      displayHeight: nativeDimensions.height,
    };
  }

  return {
    captureScreenshot: capture,
    executeAction: execute,
    getConfig,
  };
}

export type ComputerService = Awaited<ReturnType<typeof createComputerService>>;
