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

export type DesktopActionInput = Record<string, unknown> & {
  actions: Record<string, unknown>[];
};

export interface DesktopAction {
  id: string;
  name: string;
  input: DesktopActionInput;
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
