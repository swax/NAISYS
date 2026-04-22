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
  /** Current viewport dimensions exposed to the model */
  displayWidth: number;
  displayHeight: number;
  /** Native full-screen dimensions */
  nativeDisplayWidth: number;
  nativeDisplayHeight: number;
  /** Viewport origin within the native desktop */
  viewport: DesktopViewport;
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
