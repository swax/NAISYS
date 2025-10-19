import Anthropic from "@anthropic-ai/sdk";
import { MessageParam } from "@anthropic-ai/sdk/resources/messages.mjs";
import { Content, GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import * as config from "../config.js";
import * as costTracker from "./costTracker.js";
import { LlmApiType, getLLModel } from "./llModels.js";
import { LlmMessage, LlmRole } from "./llmDtos.js";

export async function query(
  modelKey: string,
  systemMessage: string,
  context: LlmMessage[],
  source: string,
): Promise<string> {
  const currentTotalCost = await costTracker.getTotalCosts(config.agent.spendLimitDollars ? config.agent.username : undefined);
  const spendLimit = config.agent.spendLimitDollars ? config.agent.spendLimitDollars : config.spendLimitDollars || -1;

  if (spendLimit < currentTotalCost) {
    throw `LLM Spend limit of $${spendLimit} reached for ${config.agent.spendLimitDollars ? config.agent.username : 'all users'}, current total cost $${currentTotalCost.toFixed(2)}`;
  }

  const model = getLLModel(modelKey);

  if (model.apiType == LlmApiType.Google) {
    return sendWithGoogle(modelKey, systemMessage, context, source);
  } else if (model.apiType == LlmApiType.Anthropic) {
    return sendWithAnthropic(modelKey, systemMessage, context, source);
  } else if (
    model.apiType == LlmApiType.OpenAI ||
    model.apiType == LlmApiType.OpenRouter
  ) {
    const apiKey =
      model.apiType == LlmApiType.OpenAI
        ? config.openaiApiKey
        : config.openRouterApiKey;

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
  source: string,
  apiKey?: string,
): Promise<string> {
  const model = getLLModel(modelKey);

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

  const chatResponse = await openAI.chat.completions.create({
    model: model.name,
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

  return chatResponse.choices[0].message.content || "";
}

async function sendWithGoogle(
  modelKey: string,
  systemMessage: string,
  context: LlmMessage[],
  source: string,
): Promise<string> {
  if (!config.googleApiKey) {
    throw "Error, googleApiKey is not defined";
  }
  const model = getLLModel(modelKey);

  const googleAI = new GoogleGenerativeAI(config.googleApiKey);

  const googleModel = googleAI.getGenerativeModel({ model: model.name });

  // Assert the last message on the context is a user message
  const lastMessage = context[context.length - 1];

  if (lastMessage.role !== LlmRole.User) {
    throw "Error, last message on context is not a user message";
  }

  const contextHistory: Content[] = context
    .filter((m) => m != lastMessage)
    .map((m) => ({
      role: m.role == LlmRole.Assistant ? "model" : "user",
      parts: [
        {
          text: m.content,
        },
      ],
    }));

  const history: Content[] = [
    {
      role: LlmRole.User, // System role is not supported by Google API
      parts: [
        {
          text: systemMessage,
        },
      ],
    },
    {
      role: "model",
      parts: [
        {
          text: "Understood",
        },
      ],
    },
    ...contextHistory,
  ];

  const chat = googleModel.startChat({
    history,
    generationConfig: {},
  });

  const result = await chat.sendMessage(lastMessage.content);

  if (result.response.promptFeedback?.blockReason) {
    throw `Google API Request Blocked, ${result.response.promptFeedback.blockReason}`;
  }

  const responseText = result.response.text();

  // Use actual token counts from Google API response
  if (result.response.usageMetadata) {
    const inputTokenCount = result.response.usageMetadata.promptTokenCount || 0;
    const outputTokenCount = result.response.usageMetadata.candidatesTokenCount || 0;
    const cachedTokenCount = result.response.usageMetadata.cachedContentTokenCount || 0;

    await costTracker.recordTokens(
      source, 
      model.key, 
      inputTokenCount, 
      outputTokenCount, 
      0, // Cache write tokens (not separately reported)
      cachedTokenCount // Cache read tokens
    );
  } else {
    throw "Error, no usage metadata returned from Google API.";
  }

  return responseText;
}

async function sendWithAnthropic(
  modelKey: string,
  systemMessage: string,
  context: LlmMessage[],
  source: string,
): Promise<string> {
  const model = getLLModel(modelKey);

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

  const msgResponse = await anthropic.messages.create({
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
      ...context.map(
        (msg, index) => {
          const isLastMessage = index === context.length - 1;
          return {
            role: msg.role == LlmRole.Assistant ? "assistant" : "user",
            content: isLastMessage && msg.role === LlmRole.User
              ? [
                  {
                    type: "text",
                    text: msg.content,
                    cache_control: { type: "ephemeral" },
                  },
                ]
              : msg.content,
          } satisfies MessageParam;
        },
      ),
    ],
  });

  // Record token usage
  if (msgResponse.usage) {
    await costTracker.recordTokens(
      source, 
      model.key, 
      msgResponse.usage.input_tokens,
      msgResponse.usage.output_tokens,
      msgResponse.usage.cache_creation_input_tokens || 0,
      msgResponse.usage.cache_read_input_tokens || 0
    );
  } else {
    throw "Error, no usage data returned from Anthropic API.";
  }

  return msgResponse.content.find((c) => c.type == "text")?.text || "";
}
