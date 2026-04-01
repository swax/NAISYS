/**
 * Anthropic-specific computer use helpers.
 * Handles image resizing to fit API constraints, coordinate scaling
 * between the API image space and native screen space, and
 * desktop action extraction from responses.
 */

import sharp from "sharp";

import { DesktopAction, DesktopConfig } from "./vendorTypes.js";

// --- Anthropic image constraints ---
const MAX_LONG_EDGE = 1568;
const MAX_PIXELS = 1_150_000;

function getScaleFactor(width: number, height: number): number {
  const longEdge = Math.max(width, height);
  const totalPixels = width * height;
  const longEdgeScale = MAX_LONG_EDGE / longEdge;
  const totalPixelsScale = Math.sqrt(MAX_PIXELS / totalPixels);
  return Math.min(1.0, longEdgeScale, totalPixelsScale);
}

/** Scale coordinates in a computer use action from API space back to native screen space */
function scaleActionToNative(
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

/** Resize a base64 image to fit within Anthropic's constraints */
async function resizeImageForApi(
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

/** Walk formatted messages and resize base64 images inside tool_result blocks */
async function resizeToolResultImages(
  messages: any[],
  scaleFactor: number,
  nativeWidth: number,
  nativeHeight: number,
): Promise<void> {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type !== "tool_result" || !Array.isArray(block.content))
        continue;
      for (const inner of block.content) {
        if (inner.type === "image" && inner.source?.type === "base64") {
          inner.source.data = await resizeImageForApi(
            inner.source.data,
            scaleFactor,
            nativeWidth,
            nativeHeight,
          );
        }
      }
    }
  }
}

// --- Anthropic version config ---

/** Determine the computer use tool type and beta flag for an Anthropic model */
function getVersionConfig(versionName: string): {
  toolType: string;
  betaFlag: string;
} {
  if (versionName.includes("4-6") || versionName.includes("4-5")) {
    return {
      toolType: "computer_20251124",
      betaFlag: "computer-use-2025-11-24",
    };
  }
  return {
    toolType: "computer_20250124",
    betaFlag: "computer-use-2025-01-24",
  };
}

// --- Public API ---

export interface ComputerUseSetup {
  computerTool: any;
  scaleFactor: number;
  betaFlag: string;
}

/**
 * Prepare the computer use tool definition and resize screenshot images.
 * Returns the tool to add to the request, the scale factor for coordinate
 * mapping, and the beta flag for the API request.
 */
export async function prepareComputerUse(
  desktopConfig: DesktopConfig,
  versionName: string,
  messages: any[],
): Promise<ComputerUseSetup> {
  const { toolType, betaFlag } = getVersionConfig(versionName);
  const scaleFactor = getScaleFactor(
    desktopConfig.displayWidth,
    desktopConfig.displayHeight,
  );
  const scaledWidth = Math.floor(
    desktopConfig.displayWidth * scaleFactor,
  );
  const scaledHeight = Math.floor(
    desktopConfig.displayHeight * scaleFactor,
  );

  const computerTool = {
    type: toolType,
    name: "computer",
    display_width_px: scaledWidth,
    display_height_px: scaledHeight,
  };

  if (scaleFactor < 1) {
    await resizeToolResultImages(
      messages,
      scaleFactor,
      desktopConfig.displayWidth,
      desktopConfig.displayHeight,
    );
  }

  return { computerTool, scaleFactor, betaFlag };
}

/**
 * Extract desktop actions from the response content,
 * scaling coordinates from API space back to native screen space.
 */
export function extractDesktopActions(
  content: any[],
  scaleFactor: number,
): DesktopAction[] {
  const actions: DesktopAction[] = [];
  for (const block of content) {
    if (block.type === "tool_use" && block.name === "computer") {
      actions.push({
        id: block.id,
        name: block.name,
        input: { actions: [scaleActionToNative(block.input, scaleFactor)] },
      });
    }
  }
  return actions;
}
