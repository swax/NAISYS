import { LlmApiType } from "@naisys/common";

import { AgentConfig } from "../agent/agentConfig.js";
import { GlobalConfig } from "../globalConfig.js";
import { ComputerService, getTargetScaleFactor } from "../computer-use/computerService.js";
import { ModelService } from "../services/modelService.js";
import { CommandTools } from "./commandTool.js";
import { CostTracker } from "./costTracker.js";
import { LlmMessage } from "./llmDtos.js";
import { sendWithAnthropic } from "./vendors/anthropic.js";
import { sendWithGoogle } from "./vendors/google.js";
import { sendWithMock } from "./vendors/mock.js";
import { sendWithOpenAiCompatible } from "./vendors/openai-compatible.js";
import { sendWithOpenAiStandard } from "./vendors/openai-standard.js";
import {
  DesktopInfo,
  QueryResult,
  QuerySources,
  VendorDeps,
} from "./vendors/vendorTypes.js";

const useThinking = true;

export function createLLMService(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  costTracker: CostTracker,
  tools: CommandTools,
  modelService: ModelService,
  computerService?: ComputerService,
) {
  // Pre-compute desktop config and scaling info at init time
  const shellModel = modelService.getLlmModel(agentConfig().shellModel);
  const desktopConfig =
    agentConfig().controlDesktop &&
    shellModel.supportsComputerUse &&
    computerService
      ? computerService.getConfig()
      : undefined;

  let desktopInfo: DesktopInfo | undefined;
  if (desktopConfig) {
    const { displayWidth: w, displayHeight: h } = desktopConfig;
    const scaleFactor = getTargetScaleFactor(w, h);
    let coordScaleX: number;
    let coordScaleY: number;

    switch (shellModel.apiType) {
      case LlmApiType.Google:
        coordScaleX = 1000 / w;
        coordScaleY = 1000 / h;
        break;
      default:
        coordScaleX = coordScaleY = scaleFactor;
    }

    desktopInfo = {
      nativeWidth: w,
      nativeHeight: h,
      scaledWidth: Math.floor(w * scaleFactor),
      scaledHeight: Math.floor(h * scaleFactor),
      coordScaleX,
      coordScaleY,
    };
  }

  async function query(
    modelKey: string,
    systemMessage: string,
    context: LlmMessage[],
    source: QuerySources,
    abortSignal?: AbortSignal,
  ): Promise<QueryResult> {
    // Check if spend limit has been reached (throws error if so)
    // Except for compact as when the spend limit is lifted, we don't want to start querying with an expensive expired cache
    if (source != "compact") {
      costTracker.checkSpendLimit();
    }

    const model = modelService.getLlmModel(modelKey);

    // Workspaces feature only works with Anthropic models due to cache_control support
    if (
      agentConfig().workspacesEnabled &&
      model.apiType !== LlmApiType.Anthropic
    ) {
      throw new Error(
        `Workspaces feature requires an Anthropic model. Current model '${modelKey}' uses ${model.apiType} API.`,
      );
    }

    const apiKey = model.apiKeyVar
      ? globalConfig().variableMap[model.apiKeyVar]
      : undefined;

    if (model.apiType === LlmApiType.None) {
      throw "This should be unreachable";
    } else if (model.apiType === LlmApiType.Mock) {
      return sendWithMock(abortSignal);
    }

    // Assert the last message on the context is a user message
    const lastMessage = context[context.length - 1];

    if (lastMessage && lastMessage.role !== "user") {
      throw "Error, last message on context is not a user message";
    }

    // Use pre-computed desktop config only if current model supports computer use
    const effectiveDesktopConfig =
      model.supportsComputerUse ? desktopConfig : undefined;

    const deps: VendorDeps = {
      modelService,
      costTracker,
      tools,
      useToolsForLlmConsoleResponses:
        globalConfig().useToolsForLlmConsoleResponses,
      useThinking,
      desktopConfig: effectiveDesktopConfig,
    };

    if (model.apiType == LlmApiType.Google) {
      return sendWithGoogle(
        deps,
        modelKey,
        systemMessage,
        context,
        source,
        apiKey,
        abortSignal,
      );
    } else if (model.apiType == LlmApiType.Anthropic) {
      return sendWithAnthropic(
        deps,
        modelKey,
        systemMessage,
        context,
        source,
        apiKey,
        abortSignal,
      );
    } else if (model.apiType == LlmApiType.OpenAI) {
      const sendFn = modelKey.startsWith("gpt")
        ? sendWithOpenAiStandard
        : sendWithOpenAiCompatible;

      return sendFn(
        deps,
        modelKey,
        systemMessage,
        context,
        source,
        apiKey,
        abortSignal,
      );
    } else {
      throw `Error, unknown LLM API type ${model.apiType}`;
    }
  }

  return {
    query,
    getDesktopInfo: () => desktopInfo,
  };
}

export type LLMService = ReturnType<typeof createLLMService>;
