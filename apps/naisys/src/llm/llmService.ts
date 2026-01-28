import Anthropic from "@anthropic-ai/sdk";
import { MessageParam } from "@anthropic-ai/sdk/resources";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { ChatCompletionCreateParamsNonStreaming } from "openai/resources";
import { AgentConfig } from "../agent/agentConfig.js";
import { GlobalConfig } from "../globalConfig.js";
import { CommandTools } from "./commandTool.js";
import { CostTracker } from "./costTracker.js";
import { LlmMessage, LlmRole } from "./llmDtos.js";
import { LlmApiType, LLModels } from "./llModels.js";

type QuerySources = "console" | "write-protection" | "compact" | "lynx";

export function createLLMService(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  costTracker: CostTracker,
  tools: CommandTools,
  llModels: LLModels,
) {
  async function query(
    modelKey: string,
    systemMessage: string,
    context: LlmMessage[],
    source: QuerySources,
    abortSignal?: AbortSignal,
  ): Promise<string[]> {
    // Check if spend limit has been reached (throws error if so)
    await costTracker.checkSpendLimit();

    const model = llModels.get(modelKey);

    // Workspaces feature only works with Anthropic models due to cache_control support
    if (
      agentConfig().workspacesEnabled &&
      model.apiType !== LlmApiType.Anthropic
    ) {
      throw new Error(
        `Workspaces feature requires an Anthropic model. Current model '${modelKey}' uses ${model.apiType} API.`,
      );
    }

    if (model.apiType === LlmApiType.None) {
      throw "This should be unreachable";
    } else if (model.apiType === LlmApiType.Mock) {
      return sendWithMock(abortSignal);
    } else if (model.apiType == LlmApiType.Google) {
      return sendWithGoogle(
        modelKey,
        systemMessage,
        context,
        source,
        abortSignal,
      );
    } else if (model.apiType == LlmApiType.Anthropic) {
      return sendWithAnthropic(
        modelKey,
        systemMessage,
        context,
        source,
        abortSignal,
      );
    } else if (model.apiType == LlmApiType.OpenAI) {
      const apiKey = model.keyEnvVar
        ? globalConfig().getEnv(model.keyEnvVar)
        : globalConfig().openaiApiKey;

      return sendWithOpenAiCompatible(
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

  /**
   * @param abortSignal 5 second mock delay, to simulate network latency and test ESC command
   * @returns Return with a 5 second pause so we can test out of focus agents still waiting before next mock request
   */
  async function sendWithMock(abortSignal?: AbortSignal): Promise<string[]> {
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(resolve, 5000);

      if (abortSignal) {
        if (abortSignal.aborted) {
          clearTimeout(timeoutId);
          reject(abortSignal.reason);
          return;
        }

        abortSignal.addEventListener(
          "abort",
          () => {
            clearTimeout(timeoutId);
            reject(abortSignal.reason);
          },
          { once: true },
        );
      }
    });

    return [
      `ns-comment "Mock LLM ran at ${new Date().toISOString()}"`,
      `ns-session pause 5`,
    ];
  }

  async function sendWithOpenAiCompatible(
    modelKey: string,
    systemMessage: string,
    context: LlmMessage[],
    source: QuerySources,
    apiKey?: string,
    abortSignal?: AbortSignal,
  ): Promise<string[]> {
    const model = llModels.get(modelKey);

    if (model.key === "local") {
      if (!model.baseUrl) {
        throw "Error, local model baseUrl is not defined";
      }
    } else if (!globalConfig().openaiApiKey) {
      throw "Error, openaiApiKey is not defined";
    }

    const openAI = new OpenAI({
      baseURL: model.baseUrl,
      apiKey,
    });

    // Assert the last message on the context is a user message
    const lastMessage = context[context.length - 1];

    if (lastMessage.role !== LlmRole.User) {
      throw "Error, last message on context is not a user message";
    }

    const chatRequest: ChatCompletionCreateParamsNonStreaming = {
      model: model.name,
      stream: false,
      reasoning_effort: "high", // should put behind a usethinking flag?
      messages: [
        {
          role: LlmRole.System, // LlmRole.User, //
          content: systemMessage,
        },
        ...context.map((m) => ({
          content: m.content,
          role: m.role,
        })),
      ],
    };

    if (source === "console" && globalConfig().useToolsForLlmConsoleResponses) {
      chatRequest.tools = [tools.consoleToolOpenAI];
      chatRequest.tool_choice = {
        type: "function",
        function: { name: tools.consoleToolOpenAI.function.name },
      };
    }

    const chatResponse = await openAI.chat.completions.create(chatRequest, {
      signal: abortSignal,
    });

    if (!model.inputCost && !model.outputCost) {
      // Don't cost models with no costs
    }
    // Record token usage
    if (chatResponse.usage) {
      const cacheReadTokens =
        chatResponse.usage.prompt_tokens_details?.cached_tokens || 0;

      // Remove cached tokens so we only bill fresh tokens at the full input rate.
      const nonCachedPromptTokens = Math.max(
        0,
        (chatResponse.usage.prompt_tokens || 0) - cacheReadTokens,
      );

      await costTracker.recordTokens(
        source,
        model.key,
        nonCachedPromptTokens,
        chatResponse.usage.completion_tokens,
        0, // OpenAI doesn't report cache write tokens separately - it's automatic
        cacheReadTokens,
      );
    } else {
      throw "Error, no usage data returned from OpenAI API.";
    }

    if (chatRequest.tools) {
      const commandsFromTool = tools.getCommandsFromOpenAiToolUse(
        chatResponse.choices.at(0)?.message?.tool_calls,
      );

      if (commandsFromTool) {
        return commandsFromTool;
      }
    }

    return [chatResponse.choices[0].message.content || ""];
  }

  async function sendWithGoogle(
    modelKey: string,
    systemMessage: string,
    context: LlmMessage[],
    source: QuerySources,
    abortSignal?: AbortSignal,
  ): Promise<string[]> {
    if (!globalConfig().googleApiKey) {
      throw "Error, googleApiKey is not defined";
    }
    const model = llModels.get(modelKey);

    const ai = new GoogleGenAI({});

    // Assert the last message on the context is a user message
    const lastMessage = context[context.length - 1];

    if (lastMessage.role !== LlmRole.User) {
      throw "Error, last message on context is not a user message";
    }

    // Build history from context (excluding last message)
    const history = context
      .filter((m) => m !== lastMessage)
      .map((m) => ({
        role: m.role === LlmRole.Assistant ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    // Prepare config with system instruction
    const chatConfig: any = {
      model: model.name,
      config: {
        systemInstruction: systemMessage,
        thinkingConfig: {
          // thinkingBudget: 1024,
          // Turn off thinking:
          // thinkingBudget: 0
          // Turn on dynamic thinking:
          thinkingBudget: -1,
        },
      },
      history,
    };

    // Add tool if console source and tools are enabled
    if (source === "console" && globalConfig().useToolsForLlmConsoleResponses) {
      chatConfig.config.tools = [
        {
          functionDeclarations: [tools.consoleToolGoogle],
        },
      ];

      chatConfig.config.toolConfig = {
        functionCallingConfig: {
          // Set the mode to "ANY" to force the model to use the tool response
          mode: "ANY",
        },
      };
    }

    const chat = ai.chats.create(chatConfig);

    const result = await chat.sendMessage({
      message: lastMessage.content,
      config: abortSignal ? { abortSignal } : undefined,
    });

    // Use actual token counts from Google API response
    if (result.usageMetadata) {
      const inputTokenCount = result.usageMetadata.promptTokenCount || 0;
      const outputTokenCount = result.usageMetadata.candidatesTokenCount || 0;
      const cachedTokenCount =
        result.usageMetadata.cachedContentTokenCount || 0;

      await costTracker.recordTokens(
        source,
        model.key,
        inputTokenCount - cachedTokenCount,
        outputTokenCount,
        0, // Cache write tokens (not separately reported)
        cachedTokenCount, // Cache read tokens
      );
    } else {
      throw "Error, no usage metadata returned from Google API.";
    }

    // Check for function calls if tools were enabled
    if (chatConfig.config.tools) {
      const commandsFromTool = tools.getCommandsFromGoogleToolUse(
        result.functionCalls,
      );

      if (commandsFromTool) {
        return commandsFromTool;
      }
    }

    return [result.text || ""];
  }

  async function sendWithAnthropic(
    modelKey: string,
    systemMessage: string,
    context: LlmMessage[],
    source: QuerySources,
    abortSignal?: AbortSignal,
  ): Promise<string[]> {
    const model = llModels.get(modelKey);

    if (!globalConfig().anthropicApiKey) {
      throw "Error, anthropicApiKey is not defined";
    }

    const anthropic = new Anthropic({
      apiKey: globalConfig().anthropicApiKey,
    });

    // Assert the last message on the context is a user message
    const lastMessage = context[context.length - 1];

    if (lastMessage.role !== LlmRole.User) {
      throw "Error, last message on context is not a user message";
    }

    const useThinking = true;

    const createParams: Anthropic.MessageCreateParams = {
      model: model.name,
      max_tokens: 4096, // Blows up on anything higher
      messages: [
        {
          role: "user",
          content: systemMessage,
        },
        {
          role: "assistant",
          content:
            context.length === 0
              ? [
                  {
                    type: "text",
                    text: "Understood",
                    cache_control: { type: "ephemeral" },
                  },
                ]
              : "Understood",
        },
        ...context.map((msg) => {
          return {
            role: msg.role == LlmRole.Assistant ? "assistant" : "user",
            content: msg.cachePoint
              ? [
                  {
                    type: "text",
                    text: msg.content,
                    cache_control: { type: "ephemeral" },
                  },
                ]
              : msg.content,
          } satisfies MessageParam;
        }),
      ],
    };

    if (useThinking) {
      createParams.thinking = {
        type: "enabled",
        budget_tokens: createParams.max_tokens! / 2,
      };
    }

    if (source === "console" && globalConfig().useToolsForLlmConsoleResponses) {
      createParams.tools = [tools.consoleToolAnthropic];
      if (useThinking) {
        createParams.tool_choice = {
          // With thinking enabled, only "auto" is supported
          type: "auto",
        };
      } else {
        createParams.tool_choice = {
          type: "tool",
          name: tools.consoleToolAnthropic.name,
        };
      }
    }

    const msgResponse = await anthropic.messages.create(createParams, {
      signal: abortSignal,
    });

    // Record token usage
    if (msgResponse.usage) {
      await costTracker.recordTokens(
        source,
        model.key,
        msgResponse.usage.input_tokens,
        msgResponse.usage.output_tokens,
        msgResponse.usage.cache_creation_input_tokens || 0,
        msgResponse.usage.cache_read_input_tokens || 0,
      );
    } else {
      throw "Error, no usage data returned from Anthropic API.";
    }

    if (createParams.tools) {
      const commandsFromTool = tools.getCommandsFromAnthropicToolUse(
        msgResponse.content,
      );

      if (commandsFromTool) {
        return commandsFromTool;
      }
    }

    return [msgResponse.content.find((c) => c.type == "text")?.text || ""];
  }

  return {
    query,
  };
}

export type LLMService = ReturnType<typeof createLLMService>;
