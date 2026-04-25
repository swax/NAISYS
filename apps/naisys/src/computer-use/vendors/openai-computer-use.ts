/**
 * OpenAI-specific computer use helpers.
 * Handles action format conversion between OpenAI and internal (Anthropic-compatible)
 * format, image resizing / coordinate scaling, desktop action extraction from
 * responses, and context formatting for computer_call / computer_call_output items.
 */

import type { ResponseOutputItem } from "openai/resources/responses/responses";

import type { ContentBlock, LlmMessage } from "../../llm/llmDtos.js";
import type {
  DesktopAction,
  DesktopActionInput,
  DesktopCoord,
  DesktopScrollDirection,
  DesktopSubAction,
} from "../../llm/vendors/vendorTypes.js";

// --- Action format conversion ---

/** Convert an OpenAI computer use action to internal (Anthropic-compatible) format.
 *  Fields are accessed dynamically by `action.type`; the runtime API shape is looser
 *  than the SDK's ComputerAction union so `any` is used to avoid extensive narrowing. */
function convertOpenAiActionToInternal(
  action: Record<string, any>,
): DesktopSubAction {
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
      // OpenAI's drag path is `{x, y}[]`; the internal format uses [x, y]
      // tuples. Also accept legacy tuple arrays in case cached history
      // carries the old shape. Multi-point paths collapse to start + end —
      // intermediate waypoints are lost.
      const path = (action.path || []) as Array<
        { x: number; y: number } | DesktopCoord
      >;
      const toCoord = (p: { x: number; y: number } | DesktopCoord | undefined): DesktopCoord =>
        Array.isArray(p) ? [p[0], p[1]] : p ? [p.x, p.y] : [0, 0];
      return {
        action: "left_click_drag",
        start_coordinate: toCoord(path[0]),
        coordinate: toCoord(path[path.length - 1]),
      };
    }
    case "move":
      return { action: "mouse_move", coordinate: [action.x, action.y] };
    case "scroll": {
      // OpenAI follows Playwright/web convention: positive scrollY = down
      const scrollY = action.scroll_y || 0;
      const scrollX = action.scroll_x || 0;
      let direction: DesktopScrollDirection;
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
      throw new Error(
        `Unsupported OpenAI computer-use action type: ${action.type}`,
      );
  }
}

/** Convert an internal action back to OpenAI format (for context reconstruction) */
function convertInternalActionToOpenAi(
  input: DesktopSubAction,
): Record<string, unknown> {
  switch (input.action) {
    case "left_click":
      return {
        type: "click",
        x: input.coordinate[0],
        y: input.coordinate[1],
        button: "left",
      };
    case "right_click":
      return {
        type: "click",
        x: input.coordinate[0],
        y: input.coordinate[1],
        button: "right",
      };
    case "middle_click":
      return {
        type: "click",
        x: input.coordinate[0],
        y: input.coordinate[1],
        button: "middle",
      };
    case "double_click":
      return {
        type: "double_click",
        x: input.coordinate[0],
        y: input.coordinate[1],
      };
    case "triple_click":
      return {
        type: "double_click",
        x: input.coordinate[0],
        y: input.coordinate[1],
      };
    case "left_click_drag":
      return {
        type: "drag",
        path: [
          { x: input.start_coordinate[0], y: input.start_coordinate[1] },
          { x: input.coordinate[0], y: input.coordinate[1] },
        ],
      };
    case "mouse_move":
      return {
        type: "move",
        x: input.coordinate[0],
        y: input.coordinate[1],
      };
    case "scroll": {
      let scrollX = 0;
      let scrollY = 0;
      const amt = input.scroll_amount;
      if (input.scroll_direction === "down") scrollY = 120 * amt;
      else if (input.scroll_direction === "up") scrollY = -120 * amt;
      else if (input.scroll_direction === "right") scrollX = 120 * amt;
      else if (input.scroll_direction === "left") scrollX = -120 * amt;
      return {
        type: "scroll",
        x: input.coordinate[0],
        y: input.coordinate[1],
        scroll_x: scrollX,
        scroll_y: scrollY,
      };
    }
    case "key":
      return { type: "keypress", keys: input.text.split("+") };
    case "hold_key":
      // OpenAI has no hold_key equivalent; replay as a plain keypress.
      // The hold duration is dropped, but the keystroke is preserved so the
      // session history remains coherent.
      return { type: "keypress", keys: input.text.split("+") };
    case "type":
      return { type: "type", text: input.text };
    case "wait":
      return { type: "wait" };
    case "screenshot":
      return { type: "screenshot" };
  }
}

// --- Public API ---

/**
 * Extract desktop actions from the OpenAI response output. Each computer_call
 * item becomes a single DesktopAction with batched internal actions.
 * Action shapes are normalized to the internal (Anthropic-compatible) form,
 * but coordinates are left in the API's scaled-pixel space.
 */
export function extractDesktopActions(
  output: ResponseOutputItem[],
): DesktopAction[] {
  const actions: DesktopAction[] = [];
  for (const item of output) {
    if (item.type === "computer_call") {
      // The batched `actions` field is an extension not yet in the typed
      // ResponseComputerToolCall shape consistently; read loosely.
      const rawActions =
        (item as unknown as { actions?: Record<string, any>[] }).actions || [];
      // convertOpenAiActionToInternal throws on unknown action types — catch
      // here so a single unsupported action is contained to one tool_use
      // turn (validationError → tool_result error) rather than killing the
      // whole LLM query downstream.
      try {
        const internalActions = rawActions.map(convertOpenAiActionToInternal);
        actions.push({
          id: item.call_id,
          name: "computer",
          input: { actions: internalActions },
        });
      } catch (e) {
        actions.push({
          id: item.call_id,
          name: "computer",
          input: { actions: [] },
          validationError: e instanceof Error ? e.message : String(e),
        });
      }
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
export function formatInputWithComputerUse<Part>(
  context: LlmMessage[],
  formatContentBlocks: (
    content: string | ContentBlock[],
    role: string,
  ) => Part[],
  formatSingleBlock: (block: ContentBlock, role: string) => Part | null,
): unknown[] {
  const items: unknown[] = [];

  for (const msg of context) {
    if (typeof msg.content === "string") {
      items.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: formatContentBlocks(msg.content, msg.role),
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
            .map((b) => formatSingleBlock(b, "assistant"))
            .filter(Boolean),
        });
      }

      // Emit tool_use blocks as computer_call items
      for (const block of content) {
        if (block.type === "tool_use" && block.name === "computer") {
          const input = block.input as unknown as DesktopActionInput;
          items.push({
            type: "computer_call",
            call_id: block.id,
            actions: input.actions.map(convertInternalActionToOpenAi),
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
    items.push({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: content
        .map((b) => formatSingleBlock(b, msg.role))
        .filter(Boolean),
    });
  }

  return items;
}
