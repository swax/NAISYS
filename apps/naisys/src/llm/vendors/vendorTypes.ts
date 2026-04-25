import type { ModelService } from "../../services/modelService.js";
import type { CommandTools } from "../commandTool.js";
import type { CostTracker } from "../costTracker.js";

export type QuerySources =
  | "console"
  | "write_protection"
  | "compact"
  | "lynx"
  | "look"
  | "listen";

export type DesktopCoord = [number, number];

export type DesktopScrollDirection = "up" | "down" | "left" | "right";

export type DesktopSubAction =
  | { action: "screenshot" }
  | { action: "wait" }
  | {
      action:
        | "left_click"
        | "right_click"
        | "middle_click"
        | "double_click"
        | "triple_click"
        | "mouse_move";
      coordinate: DesktopCoord;
    }
  | { action: "type"; text: string }
  | { action: "key"; text: string }
  | { action: "hold_key"; text: string; duration: number }
  | {
      action: "scroll";
      coordinate: DesktopCoord;
      scroll_direction: DesktopScrollDirection;
      scroll_amount: number;
    }
  | {
      action: "left_click_drag";
      start_coordinate: DesktopCoord;
      coordinate: DesktopCoord;
    };

export interface DesktopActionInput {
  actions: DesktopSubAction[];
  /** Stamped by attachViewportToActions; replay paths derive their coord frame from this. */
  viewport?: DesktopViewport;
  /** Gemini 3 Flash thoughtSignature; replayed back through context. */
  thoughtSignature?: string;
}

export interface DesktopAction {
  id: string;
  name: string;
  input: DesktopActionInput;
  /**
   * Set by provider-boundary validators when the raw payload didn't match
   * `DesktopSubAction`. confirmAndExecuteActions short-circuits on this and
   * surfaces the message back to the model as a tool_result error.
   */
  validationError?: string;
}

export interface DesktopViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopConfig {
  /**
   * Full physical display size at native resolution. Unchanged by focus.
   */
  nativeDisplayWidth: number;
  nativeDisplayHeight: number;
  /**
   * Subsection of the native display that the model sees and acts on. When
   * unfocused, this covers the full display (x=0, y=0, width=native, height=native).
   * When focused, `x/y` is the viewport origin on the native display and
   * `width/height` is the viewport size at native resolution.
   */
  viewport: DesktopViewport;
  /**
   * The viewport resized to fit TARGET_MEGAPIXELS — what the model actually
   * sees in screenshots and the coord space it receives from the API. Equal
   * to the viewport dimensions when no downscaling is needed.
   */
  scaledWidth: number;
  scaledHeight: number;
  /**
   * viewport → scaled divisor. scaledWidth = floor(viewport.width * scaleFactor).
   * 1 when the viewport is already at or below TARGET_MEGAPIXELS.
   */
  scaleFactor: number;
  desktopPlatform: string;
}

export interface QueryResult {
  responses: string[];
  /** Total input context size (excludes output/thinking tokens which don't persist) */
  messagesTokenCount: number;
  /** Computer use actions returned by the model (desktop mode only) */
  desktopActions?: DesktopAction[];
}

export interface VendorDeps {
  modelService: ModelService;
  costTracker: CostTracker;
  tools: CommandTools;
  useToolsForLlmConsoleResponses: boolean;
  useThinking: boolean;
  desktopConfig?: DesktopConfig;
}
