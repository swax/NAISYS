import { ModelService } from "../../services/modelService.js";
import { CommandTools } from "../commandTool.js";
import { CostTracker } from "../costTracker.js";

export type QuerySources =
  | "console"
  | "write-protection"
  | "compact"
  | "lynx"
  | "look"
  | "listen";

export interface VendorDeps {
  modelService: ModelService;
  costTracker: CostTracker;
  tools: CommandTools;
  useToolsForLlmConsoleResponses: boolean;
  useThinking: boolean;
}
