/**
 * Google-specific computer use helpers.
 * Handles coordinate normalization (0-999 ↔ native pixels), action format
 * conversion between Google named functions and internal (Anthropic-compatible)
 * format, desktop action extraction from responses, image resizing for
 * screenshots, and context formatting with function_call/function_response.
 */

import type { ContentBlock, LlmMessage } from "../llm/llmDtos.js";
import type {
  DesktopAction,
  DesktopConfig,
  DesktopViewport,
} from "../llm/vendors/vendorTypes.js";
// --- Coordinate normalization ---
// Google uses a 0-999 normalized grid regardless of screen resolution.
const NORMALIZED_MAX = 1000;

function denormalizeX(normalized: number, screenWidth: number): number {
  return Math.round((normalized / NORMALIZED_MAX) * screenWidth);
}

function denormalizeY(normalized: number, screenHeight: number): number {
  return Math.round((normalized / NORMALIZED_MAX) * screenHeight);
}

function normalizeX(pixel: number, screenWidth: number): number {
  return Math.round((pixel / screenWidth) * NORMALIZED_MAX);
}

function normalizeY(pixel: number, screenHeight: number): number {
  return Math.round((pixel / screenHeight) * NORMALIZED_MAX);
}

// --- Known Google Computer Use action names ---

const GOOGLE_CU_ACTIONS = new Set([
  "click_at",
  "hover_at",
  "type_text_at",
  "key_combination",
  "scroll_document",
  "scroll_at",
  "drag_and_drop",
  "open_web_browser",
  "wait_5_seconds",
  "go_back",
  "go_forward",
  "search",
  "navigate",
]);

export function isGoogleComputerUseAction(name: string): boolean {
  return GOOGLE_CU_ACTIONS.has(name);
}

// --- Google action → internal format conversion ---

function convertGoogleActionToInternal(
  name: string,
  args: Record<string, unknown>,
  displayWidth: number,
  displayHeight: number,
): Record<string, unknown>[] {
  const dx = (x: number) => denormalizeX(x, displayWidth);
  const dy = (y: number) => denormalizeY(y, displayHeight);

  switch (name) {
    case "click_at":
      return [
        {
          action: "left_click",
          coordinate: [dx(args.x as number), dy(args.y as number)],
        },
      ];
    case "hover_at":
      return [
        {
          action: "mouse_move",
          coordinate: [dx(args.x as number), dy(args.y as number)],
        },
      ];
    case "type_text_at": {
      const actions: Record<string, unknown>[] = [];
      actions.push({
        action: "left_click",
        coordinate: [dx(args.x as number), dy(args.y as number)],
      });
      if (args.clear_before_typing !== false) {
        actions.push({ action: "key", text: "ctrl+a" });
        actions.push({ action: "key", text: "BackSpace" });
      }
      actions.push({ action: "type", text: args.text as string });
      if (args.press_enter !== false) {
        actions.push({ action: "key", text: "Return" });
      }
      return actions;
    }
    case "key_combination":
      return [{ action: "key", text: args.keys as string }];
    case "scroll_document":
      return [
        {
          action: "scroll",
          coordinate: [
            Math.round(displayWidth / 2),
            Math.round(displayHeight / 2),
          ],
          scroll_direction: args.direction as string,
          scroll_amount: 3,
        },
      ];
    case "scroll_at": {
      const magnitude = (args.magnitude as number) || 800;
      const amount = Math.max(1, Math.ceil(magnitude / 200));
      return [
        {
          action: "scroll",
          coordinate: [dx(args.x as number), dy(args.y as number)],
          scroll_direction: args.direction as string,
          scroll_amount: amount,
        },
      ];
    }
    case "drag_and_drop":
      return [
        {
          action: "left_click_drag",
          start_coordinate: [dx(args.x as number), dy(args.y as number)],
          coordinate: [
            dx(args.destination_x as number),
            dy(args.destination_y as number),
          ],
        },
      ];
    case "wait_5_seconds":
      return [{ action: "wait" }];
    case "go_back":
      return [{ action: "key", text: "alt+Left" }];
    case "go_forward":
      return [{ action: "key", text: "alt+Right" }];
    case "navigate": {
      const actions: Record<string, unknown>[] = [];
      actions.push({ action: "key", text: "ctrl+l" });
      actions.push({ action: "type", text: args.url as string });
      actions.push({ action: "key", text: "Return" });
      return actions;
    }
    case "open_web_browser":
    case "search":
      return []; // No-op in desktop context
    default:
      return [];
  }
}

// --- Internal format → Google args reconstruction ---

function reconstructGoogleArgs(
  googleFuncName: string,
  internalActions: Record<string, unknown>[],
  displayWidth: number,
  displayHeight: number,
): Record<string, unknown> {
  const nx = (x: number) => normalizeX(x, displayWidth);
  const ny = (y: number) => normalizeY(y, displayHeight);
  const getCoord = (a: Record<string, unknown>) =>
    a.coordinate as number[] | undefined;

  switch (googleFuncName) {
    case "click_at": {
      const coord = getCoord(internalActions[0]);
      return { x: nx(coord![0]), y: ny(coord![1]) };
    }
    case "hover_at": {
      const coord = getCoord(internalActions[0]);
      return { x: nx(coord![0]), y: ny(coord![1]) };
    }
    case "type_text_at": {
      const clickAction = internalActions.find(
        (a) => a.action === "left_click",
      );
      const typeAction = internalActions.find((a) => a.action === "type");
      const coord = getCoord(clickAction!);
      const hasClear = internalActions.some(
        (a) => a.action === "key" && a.text === "ctrl+a",
      );
      const hasEnter = internalActions.some(
        (a) => a.action === "key" && a.text === "Return",
      );
      return {
        x: nx(coord![0]),
        y: ny(coord![1]),
        text: (typeAction?.text as string) || "",
        press_enter: hasEnter,
        clear_before_typing: hasClear,
      };
    }
    case "key_combination":
      return { keys: (internalActions[0]?.text as string) || "" };
    case "scroll_document":
      return {
        direction: (internalActions[0]?.scroll_direction as string) || "down",
      };
    case "scroll_at": {
      const coord = getCoord(internalActions[0]);
      const amount = (internalActions[0]?.scroll_amount as number) || 3;
      return {
        x: nx(coord![0]),
        y: ny(coord![1]),
        direction: (internalActions[0]?.scroll_direction as string) || "down",
        magnitude: amount * 200,
      };
    }
    case "drag_and_drop": {
      const startCoord = internalActions[0]?.start_coordinate as number[];
      const endCoord = getCoord(internalActions[0]);
      return {
        x: nx(startCoord[0]),
        y: ny(startCoord[1]),
        destination_x: nx(endCoord![0]),
        destination_y: ny(endCoord![1]),
      };
    }
    case "navigate": {
      const typeAction = internalActions.find((a) => a.action === "type");
      return { url: (typeAction?.text as string) || "" };
    }
    case "go_back":
    case "go_forward":
    case "open_web_browser":
    case "search":
    case "wait_5_seconds":
      return {};
    default:
      return {};
  }
}

function getReplayViewport(
  input: Record<string, unknown>,
  desktopConfig: DesktopConfig,
): Pick<DesktopViewport, "width" | "height"> {
  const viewport = input.viewport as Partial<DesktopViewport> | undefined;
  if (
    viewport &&
    typeof viewport.width === "number" &&
    typeof viewport.height === "number" &&
    viewport.width > 0 &&
    viewport.height > 0
  ) {
    return { width: viewport.width, height: viewport.height };
  }

  return {
    width: desktopConfig.displayWidth,
    height: desktopConfig.displayHeight,
  };
}

// --- Public API ---

/**
 * Extract desktop actions from Google response **parts** (not bare function calls).
 * Accepts full Part objects so we can capture `thoughtSignature` which lives
 * at the Part level, not inside the FunctionCall object.
 * Converts normalized coordinates to native screen space and
 * maps named functions to internal action format.
 */
export function extractDesktopActions(
  parts: any[],
  displayWidth: number,
  displayHeight: number,
): DesktopAction[] {
  const actions: DesktopAction[] = [];
  for (const part of parts) {
    const fc = part?.functionCall;
    if (!fc || typeof fc !== "object") continue;
    const name = fc.name as string;
    if (!isGoogleComputerUseAction(name)) continue;

    const args = (fc.args || {}) as Record<string, unknown>;
    const internalActions = convertGoogleActionToInternal(
      name,
      args,
      displayWidth,
      displayHeight,
    );

    const id =
      (fc.id as string) ||
      `google-cu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Capture thoughtSignature from the Part level (not inside functionCall).
    // Gemini 3 Flash requires it when replaying function_call parts in context.
    // It flows through ToolUseBlock.input (Record<string, unknown>) untouched.
    const thoughtSignature = part.thoughtSignature ?? part.thought_signature;

    actions.push({
      id,
      name, // Preserve Google function name for context reconstruction
      input: {
        actions: internalActions,
        ...(thoughtSignature ? { thoughtSignature } : {}),
      },
    });
  }
  return actions;
}

/**
 * Format the full context for the Google API with computer use support.
 * Converts internal ToolUseBlock/ToolResultBlock content blocks to
 * Google's function_call/function_response parts, resizing screenshot
 * images for token efficiency.
 */
export function formatContextWithComputerUse(
  context: LlmMessage[],
  desktopConfig: DesktopConfig,
  formatPartsForGoogle: (content: string | ContentBlock[]) => any[],
): any[] {
  // Map tool_use IDs to their Google function names for function_response reconstruction
  const toolUseIdToName = new Map<string, string>();
  const formattedMessages: any[] = [];

  for (const msg of context) {
    if (typeof msg.content === "string") {
      formattedMessages.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: formatPartsForGoogle(msg.content),
      });
      continue;
    }

    const content = msg.content;
    const hasToolUse = content.some((b) => b.type === "tool_use");
    const hasToolResult = content.some((b) => b.type === "tool_result");

    // Assistant message with tool_use → model message with function_call parts
    if (msg.role === "assistant" && hasToolUse) {
      const parts: any[] = [];
      for (const block of content) {
        if (block.type === "text") {
          parts.push({ text: block.text });
        } else if (block.type === "tool_use") {
          toolUseIdToName.set(block.id, block.name);
          const replayViewport = getReplayViewport(
            block.input,
            desktopConfig,
          );
          const googleArgs = reconstructGoogleArgs(
            block.name,
            (block.input as { actions: Record<string, unknown>[] }).actions,
            replayViewport.width,
            replayViewport.height,
          );
          const inputObj = block.input as Record<string, unknown>;
          parts.push({
            functionCall: {
              name: block.name,
              id: block.id,
              args: googleArgs,
            },
            // thoughtSignature lives at the Part level, not inside functionCall.
            // Gemini 3 Flash requires it when replaying function_call parts.
            ...(inputObj.thoughtSignature
              ? { thoughtSignature: inputObj.thoughtSignature }
              : {}),
          });
        }
      }
      formattedMessages.push({ role: "model", parts });
      continue;
    }

    // User message with tool_result → merge into the previous user message
    // if it also contains function_responses. Google requires ALL function_responses
    // for a batch of function_calls in a SINGLE user message.
    if (msg.role === "user" && hasToolResult) {
      const parts: any[] = [];
      for (const block of content) {
        if (block.type === "tool_result") {
          const funcName =
            toolUseIdToName.get(block.toolUseId) || "computer_action";

          // Google's computer use model requires a 'url' field in every function response
          const response: Record<string, unknown> = { url: "" };
          if (block.isError) {
            const textContent = block.resultContent?.find(
              (c) => c.type === "text",
            );
            response.error =
              textContent?.type === "text" ? textContent.text : "Action failed";
          }

          const frParts: any[] = [];
          for (const rc of block.resultContent) {
            if (rc.type === "image") {
              frParts.push({
                inlineData: { mimeType: rc.mimeType, data: rc.base64 },
              });
            }
          }

          parts.push({
            functionResponse: {
              name: funcName,
              id: block.toolUseId,
              response,
              parts: frParts.length > 0 ? frParts : undefined,
            },
          });
        } else if (block.type === "text") {
          parts.push({ text: block.text });
        }
      }

      // Merge with previous user message if it has function_responses
      const prev = formattedMessages[formattedMessages.length - 1];
      if (
        prev?.role === "user" &&
        prev.parts?.some((p: any) => p.functionResponse)
      ) {
        prev.parts.push(...parts);
      } else {
        formattedMessages.push({ role: "user", parts });
      }
      continue;
    }

    // Regular ContentBlock[] message (no tool blocks)
    formattedMessages.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: formatPartsForGoogle(content),
    });
  }

  return formattedMessages;
}
