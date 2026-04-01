import { ModelService } from "../../services/modelService.js";
import { CommandTools } from "../commandTool.js";
import { CostTracker } from "../costTracker.js";

export type QuerySources =
  | "console"
  | "write_protection"
  | "compact"
  | "lynx"
  | "look"
  | "listen";

export interface DesktopAction {
  id: string;
  name: string;
  input: { actions: Record<string, unknown>[] };
}

export interface DesktopConfig {
  displayWidth: number;
  displayHeight: number;
}

export interface DesktopInfo {
  nativeWidth: number;
  nativeHeight: number;
  /** Image/coordinate resolution the LLM works with */
  scaledWidth: number;
  scaledHeight: number;
  /** Multiply native coordinate by these to get approximate API-space coordinate */
  coordScaleX: number;
  coordScaleY: number;
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
