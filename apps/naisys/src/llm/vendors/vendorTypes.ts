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
  toolType: string;
  betaFlag: string;
  displayWidth: number;
  displayHeight: number;
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
