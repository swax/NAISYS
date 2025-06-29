import Anthropic from "@anthropic-ai/sdk";
import { MessageParam } from "@anthropic-ai/sdk/resources/messages.mjs";
import { Content, GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import * as config from "../config.js";
import { getTokenCount } from "../utils/utilities.js";
import * as costTracker from "./costTracker.js";
import { LlmApiType, getLLModel } from "./llModels.js";
import { LlmMessage, LlmRole } from "./llmDtos.js";

export async function query(
  modelKey: string,
  systemMessage: string,
  context: LlmMessage[],
  source: string,
): Promise<string> {
  const currentTotalCost = await costTracker.getTotalCosts();

  if (config.agent.spendLimitDollars < currentTotalCost) {
    throw `LLM Spend limit of $${config.agent.spendLimitDollars} reached`;
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
  // Total up costs, prices are per 1M tokens
  else if (chatResponse.usage) {
    const inputCost = (chatResponse.usage.prompt_tokens * model.inputCost) / 1_000_000;
    const outputCost = (chatResponse.usage.completion_tokens * model.outputCost) / 1_000_000;
    const totalCost = inputCost + outputCost;
    await costTracker.recordCost(totalCost, source, model.key, inputCost, outputCost);
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

  // TODO: take into account google allows 60 queries per minute for free for 1.0, 2 queries/min for 1.5

  // AFAIK Google API doesn't provide usage data, so we have to estimate it ourselves
  const inputTokenCount =
    getTokenCount(systemMessage) +
    context
      .map((m) => getTokenCount(m.content))
      .reduce((prevVal, currVal) => prevVal + currVal, 0);

  const outputTokenCount = getTokenCount(responseText);

  const inputCost = (inputTokenCount * model.inputCost) / 1_000_000;
  const outputCost = (outputTokenCount * model.outputCost) / 1_000_000;
  const totalCost = inputCost + outputCost;

  await costTracker.recordCost(totalCost, source, model.name, inputCost, outputCost);

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

  // Total up costs, prices are per 1M tokens
  if (msgResponse.usage) {
    const inputCost = (msgResponse.usage.input_tokens * model.inputCost) / 1_000_000;
    const outputCost = (msgResponse.usage.output_tokens * model.outputCost) / 1_000_000;
    
    // Calculate cache costs if present
    let cacheWriteCost = 0;
    let cacheReadCost = 0;
    
    if (msgResponse.usage.cache_creation_input_tokens && model.cacheWriteCost) {
      cacheWriteCost = (msgResponse.usage.cache_creation_input_tokens * model.cacheWriteCost) / 1_000_000;
    }
    
    if (msgResponse.usage.cache_read_input_tokens && model.cacheReadCost) {
      cacheReadCost = (msgResponse.usage.cache_read_input_tokens * model.cacheReadCost) / 1_000_000;
    }
    
    const totalCost = inputCost + outputCost + cacheWriteCost + cacheReadCost;
    await costTracker.recordCost(totalCost, source, model.key, inputCost, outputCost, cacheWriteCost, cacheReadCost);
  } else {
    throw "Error, no usage data returned from Anthropic API.";
  }

  return msgResponse.content.find((c) => c.type == "text")?.text || "";
}
