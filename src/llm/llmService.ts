import Anthropic from "@anthropic-ai/sdk";
import { MessageParam } from "@anthropic-ai/sdk/resources/messages.mjs";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { ChatCompletionCreateParamsNonStreaming } from "openai/resources";
import * as config from "../config.js";
import { createCommandTools } from "./commandTool.js";
import { createCostTracker } from "./costTracker.js";
import { createLLModels, LlmApiType } from "./llModels.js";
import { LlmMessage, LlmRole } from "./llmDtos.js";

type QuerySources = "console" | "write-protection" | "dream" | "llmynx";

export function createLLMService(
  costTracker: ReturnType<typeof createCostTracker>,
  tools: ReturnType<typeof createCommandTools>,
  llModels: ReturnType<typeof createLLModels>,
) {
  async function query(
    modelKey: string,
    systemMessage: string,
    context: LlmMessage[],
    source: QuerySources,
  ): Promise<string[]> {
    const currentTotalCost = await costTracker.getTotalCosts(
      config.agent.spendLimitDollars ? config.agent.username : undefined,
    );
    const spendLimit =
      config.agent.spendLimitDollars || config.spendLimitDollars || -1;

    if (spendLimit < currentTotalCost) {
      throw `LLM Spend limit of $${spendLimit} reached for ${config.agent.spendLimitDollars ? config.agent.username : "all users"}, current total cost $${currentTotalCost.toFixed(2)}`;
    }

    const model = llModels.get(modelKey);

    if (model.apiType == LlmApiType.Google) {
      return sendWithGoogle(modelKey, systemMessage, context, source);
    } else if (model.apiType == LlmApiType.Anthropic) {
      return sendWithAnthropic(modelKey, systemMessage, context, source);
    } else if (model.apiType == LlmApiType.OpenAI) {
      const apiKey = model.keyEnvVar
        ? config.getEnv(model.keyEnvVar)
        : config.openaiApiKey;

      return sendWithOpenAiCompatible(
        modelKey,
        systemMessage,
        context,
        source,
        apiKey,
      );
    } else {
      throw `Error, unknown LLM API type ${model.apiType}`;
    }
  }

  async function sendWithOpenAiCompatible(
    modelKey: string,
    systemMessage: string,
    context: LlmMessage[],
    source: QuerySources,
    apiKey?: string,
  ): Promise<string[]> {
    const model = llModels.get(modelKey);

    if (model.key === "local") {
      if (!model.baseUrl) {
        throw "Error, local model baseUrl is not defined";
      }
    } else if (!config.openaiApiKey) {
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

    if (source === "console" && config.useToolsForLlmConsoleResponses) {
      chatRequest.tools = [tools.consoleToolOpenAI];
      chatRequest.tool_choice = {
        type: "function",
        function: { name: tools.consoleToolOpenAI.function.name },
      };
    }

    const chatResponse = await openAI.chat.completions.create(chatRequest);

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
        chatResponse.choices[0]?.message?.tool_calls,
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
  ): Promise<string[]> {
    if (!config.googleApiKey) {
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
    if (source === "console" && config.useToolsForLlmConsoleResponses) {
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
  ): Promise<string[]> {
    const model = llModels.get(modelKey);

    if (!config.anthropicApiKey) {
      throw "Error, anthropicApiKey is not defined";
    }

    const anthropic = new Anthropic({
      apiKey: config.anthropicApiKey,
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
          content: [
            {
              type: "text",
              text: systemMessage,
              cache_control: { type: "ephemeral" },
            },
          ],
        },
        {
          role: "assistant",
          content: "Understood",
        },
        ...context.map((msg, index) => {
          const isLastMessage = index === context.length - 1;
          return {
            role: msg.role == LlmRole.Assistant ? "assistant" : "user",
            content:
              isLastMessage && msg.role === LlmRole.User
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

    if (source === "console" && config.useToolsForLlmConsoleResponses) {
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

    const msgResponse = await anthropic.messages.create(createParams);

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
