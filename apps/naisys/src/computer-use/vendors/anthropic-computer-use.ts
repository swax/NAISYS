/**
 * Anthropic-specific computer use helpers.
 * Handles image resizing to fit API constraints, coordinate scaling
 * between the API image space and native screen space, and
 * desktop action extraction from responses.
 */

import type {
  BetaToolComputerUse20250124,
  BetaToolComputerUse20251124,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import type {
  DesktopAction,
  DesktopConfig,
} from "../../llm/vendors/vendorTypes.js";
import { mapActionBetweenSpaces } from "../computerService.js";

// --- Anthropic version config ---

type ComputerToolType =
  | BetaToolComputerUse20250124["type"]
  | BetaToolComputerUse20251124["type"];

/** Determine the computer use tool type and beta flag for an Anthropic model */
function getVersionConfig(versionName: string): {
  toolType: ComputerToolType;
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

export type AnthropicComputerTool =
  | BetaToolComputerUse20250124
  | BetaToolComputerUse20251124;

export interface ComputerUseSetup {
  computerTool: AnthropicComputerTool;
  betaFlag: string;
}

/**
 * Prepare the computer use tool definition.
 * Returns the tool to add to the request and the beta flag for the API
 * request. Screenshots are already scaled at capture time by ComputerService.
 */
export function prepareComputerUse(
  desktopConfig: DesktopConfig,
  versionName: string,
): ComputerUseSetup {
  const { toolType, betaFlag } = getVersionConfig(versionName);
  const computerTool: AnthropicComputerTool = {
    type: toolType,
    name: "computer",
    display_width_px: desktopConfig.scaledWidth,
    display_height_px: desktopConfig.scaledHeight,
  };

  return { computerTool, betaFlag };
}

/**
 * Extract desktop actions from the response content, mapping coordinates
 * from the API's scaled-pixel space back to viewport-local pixels.
 */
export function extractDesktopActions(
  content: any[],
  desktopConfig: DesktopConfig,
): DesktopAction[] {
  const { viewport, scaledWidth, scaledHeight } = desktopConfig;
  const actions: DesktopAction[] = [];
  for (const block of content) {
    if (block.type === "tool_use" && block.name === "computer") {
      actions.push({
        id: block.id,
        name: block.name,
        input: {
          actions: [
            mapActionBetweenSpaces(
              block.input,
              scaledWidth,
              scaledHeight,
              viewport.width,
              viewport.height,
            ),
          ],
        },
      });
    }
  }
  return actions;
}
