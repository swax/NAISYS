/**
 * Computer interaction service.
 * Handles screenshots, mouse/keyboard actions, and display config.
 * Platform-specific code lives in windowsDesktop.ts / macosDesktop.ts / x11Desktop.ts / waylandDesktop.ts.
 */

import { TARGET_MEGAPIXELS } from "@naisys/common";
import fs from "fs";
import path from "path";
import sharp from "sharp";

import type { AgentConfig } from "../agent/agentConfig.js";
import type {
  DesktopAction,
  DesktopConfig,
  DesktopViewport,
} from "../llm/vendors/vendorTypes.js";
import * as macosDesktop from "./desktops/macosDesktop.js";
import * as waylandDesktop from "./desktops/waylandDesktop.js";
import * as windowsDesktop from "./desktops/windowsDesktop.js";
import * as x11Desktop from "./desktops/x11Desktop.js";

type DesktopBackend = typeof windowsDesktop & {
  checkDependencies?: () => void;
};
type Platform = { backend: DesktopBackend; name: string };

function detectPlatform(): Platform | null {
  if (process.platform === "win32")
    return { backend: windowsDesktop, name: "Windows" };
  if (process.platform === "darwin")
    return { backend: macosDesktop, name: "macOS" };

  // WSL: control the Windows host via powershell.exe rather than the WSLg
  // Wayland compositor, since WSLg only exposes Linux GUI apps.
  if (process.env.WSL_DISTRO_NAME)
    return { backend: windowsDesktop, name: "Windows (WSL)" };

  const sessionType = process.env.XDG_SESSION_TYPE;
  if (sessionType === "wayland" || process.env.WAYLAND_DISPLAY)
    return { backend: waylandDesktop, name: "Linux (Wayland)" };
  if (sessionType === "x11" || process.env.DISPLAY)
    return { backend: x11Desktop, name: "Linux (X11)" };

  // No display server detected (headless, TTY, etc.)
  return null;
}

// --- Screenshot cleanup ---

const SCREENSHOT_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const SCREENSHOT_DIR = path.join(
  process.env.NAISYS_FOLDER || "",
  "tmp",
  "naisys",
  "screenshots",
);
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
    } catch {
      /* ignore */
    }
  };

  clean();
  setInterval(clean, SCREENSHOT_MAX_AGE_MS).unref();
}

// --- Screenshot capture ---

async function captureScreenshot(
  username: string,
  platform: Platform,
): Promise<{
  base64: string;
  width: number;
  height: number;
  filepath: string;
}> {
  const filepath = path.join(SCREENSHOT_DIR, `${username}-${Date.now()}.png`);

  platform.backend.captureScreenshot(filepath);

  const buffer = fs.readFileSync(filepath);
  const metadata = await sharp(buffer).metadata();

  return {
    base64: buffer.toString("base64"),
    width: metadata.width || 1920,
    height: metadata.height || 1080,
    filepath,
  };
}

function isViewportWithinBounds(
  viewport: DesktopViewport,
  screenWidth: number,
  screenHeight: number,
): boolean {
  return (
    Number.isInteger(viewport.x) &&
    Number.isInteger(viewport.y) &&
    Number.isInteger(viewport.width) &&
    Number.isInteger(viewport.height) &&
    viewport.width > 0 &&
    viewport.height > 0 &&
    viewport.x >= 0 &&
    viewport.y >= 0 &&
    viewport.x + viewport.width <= screenWidth &&
    viewport.y + viewport.height <= screenHeight
  );
}

async function cropScreenshotToViewport(
  screenshot: {
    base64: string;
    width: number;
    height: number;
    filepath: string;
  },
  viewport: DesktopViewport,
): Promise<{
  base64: string;
  width: number;
  height: number;
  filepath: string;
}> {
  const croppedBuffer = await sharp(Buffer.from(screenshot.base64, "base64"))
    .extract({
      left: viewport.x,
      top: viewport.y,
      width: viewport.width,
      height: viewport.height,
    })
    .png()
    .toBuffer();

  const filepath = screenshot.filepath.replace(
    ".png",
    `-focus-${viewport.x}-${viewport.y}-${viewport.width}x${viewport.height}.png`,
  );
  fs.writeFileSync(filepath, croppedBuffer);

  return {
    base64: croppedBuffer.toString("base64"),
    width: viewport.width,
    height: viewport.height,
    filepath,
  };
}

function translateScaledCoordinate(
  coord: unknown,
  desktopConfig: DesktopConfig,
): unknown {
  if (!Array.isArray(coord)) return coord;
  const { scaledWidth, scaledHeight, viewport } = desktopConfig;
  // scaled → viewport-local → screen (single multiply/add per axis)
  return [
    Math.round((coord[0] / scaledWidth) * viewport.width) + viewport.x,
    Math.round((coord[1] / scaledHeight) * viewport.height) + viewport.y,
  ];
}

/**
 * Translate an action's coordinates from scaled (API/screenshot) space to
 * absolute screen space. Handles both `coordinate` and `start_coordinate`.
 */
function translateScaledActionToScreen(
  action: Record<string, unknown>,
  desktopConfig: DesktopConfig,
): Record<string, unknown> {
  const translated = { ...action };

  if ("coordinate" in action) {
    translated.coordinate = translateScaledCoordinate(
      action.coordinate,
      desktopConfig,
    );
  }
  if ("start_coordinate" in action) {
    translated.start_coordinate = translateScaledCoordinate(
      action.start_coordinate,
      desktopConfig,
    );
  }

  return translated;
}

// --- Action execution ---

async function executeSingleAction(
  action: Record<string, unknown>,
  platform: Platform,
): Promise<void> {
  const { backend } = platform;
  const coord = action.coordinate as number[] | undefined;

  switch (action.action) {
    case "left_click":
      backend.mouseClick(coord![0], coord![1], "left");
      break;
    case "right_click":
      backend.mouseClick(coord![0], coord![1], "right");
      break;
    case "middle_click":
      backend.mouseClick(coord![0], coord![1], "middle");
      break;
    case "double_click":
      backend.mouseDoubleClick(coord![0], coord![1]);
      break;
    case "triple_click":
      backend.mouseDoubleClick(coord![0], coord![1]);
      backend.mouseClick(coord![0], coord![1], "left");
      break;
    case "type":
      backend.typeText(action.text as string);
      break;
    case "key":
      backend.pressKey(action.text as string);
      break;
    case "hold_key": {
      // Anthropic's native hold_key uses `duration` in seconds (can be fractional).
      // Our ns-desktop `hold` shell command also builds this action. Backends
      // take integer milliseconds.
      const durationSec = (action.duration as number) ?? 0;
      backend.holdKey(action.text as string, Math.round(durationSec * 1000));
      break;
    }
    case "mouse_move":
      backend.mouseMove(coord![0], coord![1]);
      break;
    case "left_click_drag": {
      const startCoord = action.start_coordinate as number[];
      backend.mouseDrag(startCoord[0], startCoord[1], coord![0], coord![1]);
      break;
    }
    case "scroll":
      backend.mouseScroll(
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
async function executeAction(
  action: DesktopAction["input"],
  platform: Platform,
  desktopConfig: DesktopConfig,
): Promise<void> {
  for (const subAction of action.actions) {
    await executeSingleAction(
      translateScaledActionToScreen(subAction, desktopConfig),
      platform,
    );
  }
}

// --- Shared scaling logic ---

/**
 * Compute a scale factor to fit the native resolution into TARGET_MEGAPIXELS
 * while maintaining aspect ratio. The scaled width is rounded down to a
 * multiple of 20 so the result stays at or under the target.
 * Returns 1 if the native resolution is already at or below the target.
 */
export function getTargetScaleFactor(
  nativeWidth: number,
  nativeHeight: number,
): number {
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
    .removeAlpha()
    .resize(scaledWidth, scaledHeight)
    .png()
    .toBuffer();
  return resized.toString("base64");
}

/** Map a coordinate pair between two 2D spaces with independent X/Y scaling. */
export function mapCoordinateBetweenSpaces(
  coord: number[],
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): number[];
export function mapCoordinateBetweenSpaces(
  coord: unknown,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): unknown {
  if (
    !Array.isArray(coord) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    targetWidth <= 0 ||
    targetHeight <= 0
  ) {
    return coord;
  }

  return [
    Math.round(((coord as number[])[0] / sourceWidth) * targetWidth),
    Math.round(((coord as number[])[1] / sourceHeight) * targetHeight),
  ];
}

/** Map all action coordinates between two spaces, preserving non-coordinate fields. */
export function mapActionBetweenSpaces(
  input: Record<string, unknown>,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Record<string, unknown> {
  const result = { ...input };
  if ("coordinate" in result && Array.isArray(result.coordinate)) {
    result.coordinate = mapCoordinateBetweenSpaces(
      result.coordinate,
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
    );
  }
  if ("start_coordinate" in result && Array.isArray(result.start_coordinate)) {
    result.start_coordinate = mapCoordinateBetweenSpaces(
      result.start_coordinate,
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
    );
  }
  return result;
}

/**
 * Check if any coordinates in an action exceed the scaled-screenshot bounds.
 * Action coordinates are in scaled-pixel space (same space the model sees).
 */
export function checkActionBounds(
  input: DesktopAction["input"],
  scaledWidth: number,
  scaledHeight: number,
): string | undefined {
  for (const action of input.actions) {
    const coord = action.coordinate as number[] | undefined;
    if (
      coord &&
      (coord[0] >= scaledWidth ||
        coord[1] >= scaledHeight ||
        coord[0] < 0 ||
        coord[1] < 0)
    ) {
      return `Coordinate (${coord[0]}, ${coord[1]}) is outside the screen resolution ${scaledWidth}x${scaledHeight}`;
    }
    const startCoord = action.start_coordinate as number[] | undefined;
    if (
      startCoord &&
      (startCoord[0] >= scaledWidth ||
        startCoord[1] >= scaledHeight ||
        startCoord[0] < 0 ||
        startCoord[1] < 0)
    ) {
      return `Start coordinate (${startCoord[0]}, ${startCoord[1]}) is outside the screen resolution ${scaledWidth}x${scaledHeight}`;
    }
  }
  return undefined;
}

// --- Display formatting ---

/**
 * Format a coordinate pair. Coord is in scaled space; if desktopConfig is
 * supplied, also shows the absolute screen coord the click will land on.
 */
function fmtCoord(coord: number[], desktopConfig?: DesktopConfig): string {
  if (!desktopConfig) return `(${coord.join(", ")})`;
  const screen = translateScaledCoordinate(coord, desktopConfig) as number[];
  return `(${coord.join(", ")}) → screen (${screen.join(", ")})`;
}

/** Format a single action for human-readable display */
function formatSingleAction(
  input: Record<string, unknown>,
  desktopConfig?: DesktopConfig,
): string {
  const action = input.action;
  const coordinate = input.coordinate as number[] | undefined;
  const coord = coordinate ? fmtCoord(coordinate, desktopConfig) : "";

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
    case "hold_key":
      return `Hold key "${input.text}" for ${input.duration}s`;
    case "mouse_move":
      return `Move mouse to ${coord}`;
    case "scroll":
      return `Scroll ${input.scroll_direction} by ${input.scroll_amount} at ${coord}`;
    case "left_click_drag": {
      const startCoord = input.start_coordinate as number[] | undefined;
      const startStr = startCoord ? fmtCoord(startCoord, desktopConfig) : "";
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
  desktopConfig?: DesktopConfig,
): string {
  return input.actions
    .map((a) => formatSingleAction(a, desktopConfig))
    .join(", then ");
}

/** Format a batch of desktop actions for human-readable display */
export function formatDesktopActions(
  actions: DesktopAction[],
  desktopConfig?: DesktopConfig,
): string {
  return actions
    .map((a) => formatDesktopAction(a.input, desktopConfig))
    .join(", then ");
}

export function isDesktopFocused(desktopConfig: DesktopConfig): boolean {
  return (
    desktopConfig.viewport.x !== 0 ||
    desktopConfig.viewport.y !== 0 ||
    desktopConfig.viewport.width !== desktopConfig.nativeDisplayWidth ||
    desktopConfig.viewport.height !== desktopConfig.nativeDisplayHeight
  );
}

export function describeDesktopViewport(desktopConfig: DesktopConfig): string {
  const { viewport } = desktopConfig;
  if (!isDesktopFocused(desktopConfig)) {
    return `full desktop ${viewport.width}x${viewport.height}`;
  }

  return `focus (${viewport.x}, ${viewport.y}, ${viewport.width}x${viewport.height}) within ${desktopConfig.nativeDisplayWidth}x${desktopConfig.nativeDisplayHeight}`;
}

// --- Service factory ---

export async function createComputerService({ agentConfig }: AgentConfig) {
  startScreenshotCleanup();
  const platform = agentConfig().controlDesktop ? detectPlatform() : null;
  let nativeDimensions: { width: number; height: number } | null = null;
  let focusViewport: DesktopViewport | undefined;

  function syncFocusViewport(): void {
    if (
      focusViewport &&
      nativeDimensions &&
      !isViewportWithinBounds(
        focusViewport,
        nativeDimensions.width,
        nativeDimensions.height,
      )
    ) {
      focusViewport = undefined;
    }
  }

  function getViewport(): DesktopViewport | undefined {
    syncFocusViewport();
    return focusViewport ? { ...focusViewport } : undefined;
  }

  /** Capture the full physical display at native resolution. */
  async function captureFullScreenshot(): Promise<{
    base64: string;
    width: number;
    height: number;
    filepath: string;
  }> {
    if (!platform) {
      throw new Error(
        "Desktop mode is not enabled or no display server detected.",
      );
    }
    const result = await captureScreenshot(agentConfig().username, platform);
    nativeDimensions = { width: result.width, height: result.height };
    syncFocusViewport();
    return result;
  }

  /** Capture the current viewport (cropped from the full display) at native resolution. */
  async function captureViewportScreenshot(): Promise<{
    base64: string;
    width: number;
    height: number;
    filepath: string;
  }> {
    const screenshot = await captureFullScreenshot();
    const viewport = getViewport();
    if (!viewport) {
      return screenshot;
    }

    const cropped = await cropScreenshotToViewport(screenshot, viewport);
    try {
      fs.unlinkSync(screenshot.filepath);
    } catch {
      /* ignore */
    }
    return cropped;
  }

  /** Capture the current viewport scaled to TARGET_MEGAPIXELS (what the model sees). */
  async function captureScaledScreenshot(): Promise<{
    base64: string;
    filepath: string;
  }> {
    const raw = await captureViewportScreenshot();

    const scaleFactor = getTargetScaleFactor(raw.width, raw.height);
    if (scaleFactor < 1) {
      const scaledBase64 = await resizeScreenshot(
        raw.base64,
        scaleFactor,
        raw.width,
        raw.height,
      );
      const scaledWidth = Math.floor(raw.width * scaleFactor);
      const scaledHeight = Math.floor(raw.height * scaleFactor);
      const scaledPath = raw.filepath.replace(
        ".png",
        `-${scaledWidth}x${scaledHeight}.png`,
      );
      fs.writeFileSync(scaledPath, Buffer.from(scaledBase64, "base64"));
      return { base64: scaledBase64, filepath: scaledPath };
    }

    return { base64: raw.base64, filepath: raw.filepath };
  }

  let initError: string | undefined;

  // Seed native display dimensions on startup when desktop mode is enabled
  if (agentConfig().controlDesktop) {
    if (!platform) {
      initError = "No display server detected (no X11 or Wayland session).";
    } else {
      try {
        platform.backend.checkDependencies?.();
        await captureFullScreenshot();
      } catch (e) {
        initError = e instanceof Error ? e.message : String(e);
      }
    }
  }

  /**
   * Execute an action whose coordinates are in scaled-pixel space (the same
   * space the model sees in its screenshot and the space it sends back in
   * tool calls). Translation to absolute screen coords happens here —
   * scaled → viewport-local → screen — before dispatch to the platform
   * backend.
   */
  async function execute(action: DesktopAction["input"]) {
    if (!platform) {
      throw new Error(
        "Desktop mode is not enabled or no display server detected.",
      );
    }
    const config = getConfig();
    if (!config) {
      throw new Error("Desktop config unavailable.");
    }
    await executeAction(action, platform, config);
  }

  /** Build the DesktopConfig with native display dimensions. Returns undefined if no platform or init failed. */
  function getConfig(): DesktopConfig | undefined {
    if (!platform || !nativeDimensions) return undefined;
    const viewport = getViewport() || {
      x: 0,
      y: 0,
      width: nativeDimensions.width,
      height: nativeDimensions.height,
    };
    const scaleFactor = getTargetScaleFactor(viewport.width, viewport.height);
    return {
      nativeDisplayWidth: nativeDimensions.width,
      nativeDisplayHeight: nativeDimensions.height,
      viewport,
      scaledWidth: Math.floor(viewport.width * scaleFactor),
      scaledHeight: Math.floor(viewport.height * scaleFactor),
      scaleFactor,
      desktopPlatform: platform.name,
    };
  }

  function setFocus(
    viewport: DesktopViewport | undefined,
  ): DesktopViewport | undefined {
    if (!viewport) {
      focusViewport = undefined;
      return undefined;
    }
    if (!nativeDimensions) {
      throw new Error("Desktop dimensions are not initialized yet.");
    }
    if (
      !isViewportWithinBounds(
        viewport,
        nativeDimensions.width,
        nativeDimensions.height,
      )
    ) {
      throw new Error(
        `Focus rectangle (${viewport.x}, ${viewport.y}, ${viewport.width}, ${viewport.height}) is outside the native screen ${nativeDimensions.width}x${nativeDimensions.height}.`,
      );
    }
    focusViewport = { ...viewport };
    return getViewport();
  }

  return {
    captureScaledScreenshot,
    captureViewportScreenshot,
    captureFullScreenshot,
    executeAction: execute,
    getConfig,
    getFocus: getViewport,
    setFocus,
    platformName: platform?.name,
    initError,
  };
}

export type ComputerService = Awaited<ReturnType<typeof createComputerService>>;
