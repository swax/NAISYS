import { LlmApiType } from "@naisys/common";
import { AgentConfig } from "../agent/agentConfig.js";
import { GlobalConfig } from "../globalConfig.js";
import { ModelService } from "../services/modelService.js";
import { CommandTools } from "./commandTool.js";
import { CostTracker } from "./costTracker.js";
import { LlmMessage, LlmRole } from "./llmDtos.js";
import { sendWithAnthropic } from "./vendors/anthropic.js";
import { sendWithGoogle } from "./vendors/google.js";
import { sendWithMock } from "./vendors/mock.js";
import { sendWithOpenAiCompatible } from "./vendors/openai.js";
import { QueryResult, QuerySources, VendorDeps } from "./vendors/vendorTypes.js";

const useThinking = true;

export function createLLMService(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  costTracker: CostTracker,
  tools: CommandTools,
  modelService: ModelService,
) {
  async function query(
    modelKey: string,
    systemMessage: string,
    context: LlmMessage[],
    source: QuerySources,
    abortSignal?: AbortSignal,
  ): Promise<QueryResult> {
    // Check if spend limit has been reached (throws error if so)
    await costTracker.checkSpendLimit();

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

    if (lastMessage && lastMessage.role !== LlmRole.User) {
      throw "Error, last message on context is not a user message";
    }

    const deps: VendorDeps = {
      modelService,
      costTracker,
      tools,
      useToolsForLlmConsoleResponses:
        globalConfig().useToolsForLlmConsoleResponses,
      useThinking,
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
      return sendWithOpenAiCompatible(
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
  };
}

export type LLMService = ReturnType<typeof createLLMService>;
