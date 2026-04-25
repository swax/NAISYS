/**
 * Anthropic-specific computer use helpers.
 * Builds the tool definition and extracts tool_use blocks from responses.
 * Coordinates stay in scaled-pixel (API) space throughout — ComputerService
 * handles translation to absolute screen coords at execute time.
 */

import type {
  BetaToolComputerUse20250124,
  BetaToolComputerUse20251124,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";

import type {
  DesktopAction,
  DesktopConfig,
  DesktopSubAction,
} from "../../llm/vendors/vendorTypes.js";
import { KNOWN_DESKTOP_ACTION_TAGS } from "../computerService.js";

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
 * Extract desktop actions from the response content. Coordinates are passed
 * through as-is in the API's scaled-pixel space. The action discriminator
 * is checked against the closed `DesktopSubAction` set; an unrecognized
 * action name is surfaced as a `validationError` so confirmAndExecuteActions
 * can reply to the model with a tool_result error instead of silently
 * no-op'ing later. Field shapes (coordinate types, etc.) are trusted to
 * the API contract — if a known action carries malformed fields, the
 * existing try/catch around `executeAction` contains the explosion.
 */
export function extractDesktopActions(content: any[]): DesktopAction[] {
  const actions: DesktopAction[] = [];
  for (const block of content) {
    if (block.type === "tool_use" && block.name === "computer") {
      const tag = (block.input as { action?: unknown })?.action;
      const isKnown =
        typeof tag === "string" &&
        KNOWN_DESKTOP_ACTION_TAGS.has(tag as DesktopSubAction["action"]);
      actions.push({
        id: block.id,
        name: block.name,
        input: { actions: [block.input as DesktopSubAction] },
        ...(isKnown
          ? {}
          : {
              validationError: `Unsupported computer-use action: ${typeof tag === "string" ? tag : "(no action field)"}`,
            }),
      });
    }
  }
  return actions;
}
