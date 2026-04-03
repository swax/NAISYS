/**
 * OpenAI-specific computer use helpers.
 * Handles action format conversion between OpenAI and internal (Anthropic-compatible)
 * format, image resizing / coordinate scaling, desktop action extraction from
 * responses, and context formatting for computer_call / computer_call_output items.
 */

import type { ContentBlock, LlmMessage } from "../llm/llmDtos.js";
import type {
  DesktopAction,
  DesktopConfig,
} from "../llm/vendors/vendorTypes.js";
import {
  getTargetScaleFactor,
  scaleActionToNative,
} from "./computerService.js";

// --- Action format conversion ---

/** Convert an OpenAI computer use action to internal (Anthropic-compatible) format */
function convertOpenAiActionToInternal(
  action: Record<string, any>,
): Record<string, unknown> {
  switch (action.type) {
    case "click": {
      const button = action.button || "left";
      const actionName =
        button === "right"
          ? "right_click"
          : button === "middle"
            ? "middle_click"
            : "left_click";
      return { action: actionName, coordinate: [action.x, action.y] };
    }
    case "double_click":
      return { action: "double_click", coordinate: [action.x, action.y] };
    case "drag": {
      // TODO: OpenAI supports multi-point drag paths but the internal format
      // only stores start + end. Intermediate waypoints are lost here.
      const path = action.path || [];
      const start = path[0] || [0, 0];
      const end = path[path.length - 1] || [0, 0];
      return {
        action: "left_click_drag",
        start_coordinate: start,
        coordinate: end,
      };
    }
    case "move":
      return { action: "mouse_move", coordinate: [action.x, action.y] };
    case "scroll": {
      // OpenAI follows Playwright/web convention: positive scrollY = down
      const scrollY = action.scrollY || 0;
      const scrollX = action.scrollX || 0;
      let direction: string;
      let amount: number;
      if (Math.abs(scrollY) >= Math.abs(scrollX)) {
        direction = scrollY > 0 ? "down" : "up";
        amount = Math.max(1, Math.round(Math.abs(scrollY) / 120));
      } else {
        direction = scrollX > 0 ? "right" : "left";
        amount = Math.max(1, Math.round(Math.abs(scrollX) / 120));
      }
      return {
        action: "scroll",
        coordinate: [action.x, action.y],
        scroll_direction: direction,
        scroll_amount: amount,
      };
    }
    case "keypress":
      return { action: "key", text: (action.keys || []).join("+") };
    case "type":
      return { action: "type", text: action.text };
    case "wait":
      return { action: "wait" };
    case "screenshot":
      return { action: "screenshot" };
    default:
      return { action: action.type };
  }
}

/** Convert an internal action back to OpenAI format (for context reconstruction) */
function convertInternalActionToOpenAi(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const coord = input.coordinate as number[] | undefined;
  switch (input.action) {
    case "left_click":
      return { type: "click", x: coord?.[0], y: coord?.[1], button: "left" };
    case "right_click":
      return { type: "click", x: coord?.[0], y: coord?.[1], button: "right" };
    case "middle_click":
      return {
        type: "click",
        x: coord?.[0],
        y: coord?.[1],
        button: "middle",
      };
    case "double_click":
      return { type: "double_click", x: coord?.[0], y: coord?.[1] };
    case "triple_click":
      return { type: "double_click", x: coord?.[0], y: coord?.[1] };
    case "left_click_drag": {
      const startCoord = input.start_coordinate as number[] | undefined;
      return { type: "drag", path: [startCoord, coord] };
    }
    case "mouse_move":
      return { type: "move", x: coord?.[0], y: coord?.[1] };
    case "scroll": {
      const dir = input.scroll_direction as string;
      const amt = (input.scroll_amount as number) || 3;
      let scrollX = 0;
      let scrollY = 0;
      if (dir === "down") scrollY = 120 * amt;
      else if (dir === "up") scrollY = -120 * amt;
      else if (dir === "right") scrollX = 120 * amt;
      else if (dir === "left") scrollX = -120 * amt;
      return {
        type: "scroll",
        x: coord?.[0],
        y: coord?.[1],
        scrollX,
        scrollY,
      };
    }
    case "key":
      return {
        type: "keypress",
        keys: (input.text as string)?.split("+") || [],
      };
    case "type":
      return { type: "type", text: input.text };
    case "wait":
      return { type: "wait" };
    case "screenshot":
      return { type: "screenshot" };
    default:
      return { type: input.action };
  }
}

// --- Public API ---

export interface OpenAiComputerUseSetup {
  scaleFactor: number;
}

/**
 * Compute the scale factor for OpenAI computer use based on native display dimensions.
 */
export function prepareComputerUse(
  desktopConfig: DesktopConfig,
): OpenAiComputerUseSetup {
  const scaleFactor = getTargetScaleFactor(
    desktopConfig.displayWidth,
    desktopConfig.displayHeight,
  );
  return { scaleFactor };
}

/**
 * Extract desktop actions from the OpenAI response output.
 * Each computer_call item becomes a single DesktopAction with batched internal actions.
 * Coordinates are scaled from API (downscaled) space back to native screen space.
 */
export function extractDesktopActions(
  output: any[],
  scaleFactor: number,
): DesktopAction[] {
  const actions: DesktopAction[] = [];
  for (const item of output) {
    if (item.type === "computer_call") {
      const internalActions = (item.actions || []).map(
        (a: Record<string, any>) =>
          scaleActionToNative(convertOpenAiActionToInternal(a), scaleFactor),
      );
      actions.push({
        id: item.call_id,
        name: "computer",
        input: { actions: internalActions },
      });
    }
  }
  return actions;
}

/**
 * Format the full context for the OpenAI Responses API with computer use support.
 * Converts ToolUseBlock/ToolResultBlock content blocks to OpenAI's
 * computer_call / computer_call_output input items, resizing screenshot images
 * to the downscaled resolution.
 */
export function formatInputWithComputerUse(
  context: LlmMessage[],
  formatContentBlocks: (content: string | ContentBlock[]) => any[],
  formatSingleBlock: (block: ContentBlock) => any | null,
): any[] {
  const items: any[] = [];

  for (const msg of context) {
    if (typeof msg.content === "string") {
      const isAssistantStr = msg.role === "assistant";
      const blocks = formatContentBlocks(msg.content);
      items.push({
        role: isAssistantStr ? "assistant" : "user",
        content: isAssistantStr
          ? blocks.map((b: any) =>
              b?.type === "input_text"
                ? { type: "output_text", text: b.text }
                : b,
            )
          : blocks,
      });
      continue;
    }

    const content = msg.content;
    const hasToolUse = content.some((b) => b.type === "tool_use");
    const hasToolResult = content.some((b) => b.type === "tool_result");

    if (msg.role === "assistant" && hasToolUse) {
      // Emit text as an assistant message
      const textBlocks = content.filter(
        (b) => b.type === "text" || b.type === "image",
      );
      if (textBlocks.length > 0) {
        items.push({
          role: "assistant",
          content: textBlocks
            .map(formatSingleBlock)
            .filter(Boolean)
            .map((b: any) =>
              b?.type === "input_text"
                ? { type: "output_text", text: b.text }
                : b,
            ),
        });
      }

      // Emit tool_use blocks as computer_call items
      for (const block of content) {
        if (block.type === "tool_use" && block.name === "computer") {
          const actionsToConvert = block.input.actions as Record<
            string,
            unknown
          >[];
          items.push({
            type: "computer_call",
            call_id: block.id,
            actions: actionsToConvert.map(convertInternalActionToOpenAi),
            status: "completed",
          });
        }
      }
      continue;
    }

    if (msg.role === "user" && hasToolResult) {
      for (const block of content) {
        if (block.type === "tool_result") {
          if (block.isError) {
            const errorText = block.resultContent?.find(
              (c) => c.type === "text",
            );
            items.push({
              type: "computer_call_output",
              call_id: block.toolUseId,
              output: {
                type: "output_text",
                text: `[Desktop action error: ${errorText?.type === "text" ? errorText.text : "unknown error"}]`,
              },
            });
          } else {
            const imageContent = block.resultContent?.find(
              (c) => c.type === "image",
            );
            if (imageContent && imageContent.type === "image") {
              items.push({
                type: "computer_call_output",
                call_id: block.toolUseId,
                output: {
                  type: "computer_screenshot",
                  image_url: `data:${imageContent.mimeType};base64,${imageContent.base64}`,
                  detail: "original",
                },
              });
            }
          }
        }
      }
      continue;
    }

    // Regular ContentBlock[] message (no tool blocks)
    const isAssistant = msg.role === "assistant";
    const formatted = content.map(formatSingleBlock).filter(Boolean);
    items.push({
      role: isAssistant ? "assistant" : "user",
      content: isAssistant
        ? formatted.map((b: any) =>
            b?.type === "input_text"
              ? { type: "output_text", text: b.text }
              : b,
          )
        : formatted,
    });
  }

  return items;
}
