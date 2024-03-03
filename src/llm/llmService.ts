import { GoogleGenerativeAI } from "@google/generative-ai";
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
  const currentTotalCost = await costTracker.getTotalCosts();

  if (config.agent.spendLimitDollars < currentTotalCost) {
    throw `LLM Spend limit of $${config.agent.spendLimitDollars} reached`;
  }

  const model = getLLModel(modelKey);

  if (model.apiType == LlmApiType.Google) {
    return sendWithGoogle(modelKey, systemMessage, context, source);
  } else if (model.apiType == LlmApiType.OpenAI) {
    return sendWithOpenAiCompatible(modelKey, systemMessage, context, source);
  } else {
    throw `Error, unknown LLM API type ${model.apiType}`;
  }
}

async function sendWithOpenAiCompatible(
  modelKey: string,
  systemMessage: string,
  context: LlmMessage[],
  source: string,
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
    apiKey: config.openaiApiKey,
  });

  // Assert the last message on the context is a user message
  const lastMessage = context[context.length - 1];

  if (lastMessage.role !== LlmRole.User) {
    throw "Error, last message on context is not a user message";
  }

  const chatCompletion = await openAI.chat.completions.create({
    model: model.name,
    messages: [
      {
        role: LlmRole.System,
        content: systemMessage,
      },
      ...context.map((m) => ({
        content: m.content,
        role: m.role,
      })),
    ],
  });

  // Total up costs, prices are per 1000 tokens
  if (chatCompletion.usage) {
    const cost =
      chatCompletion.usage.prompt_tokens * model.inputCost +
      chatCompletion.usage.completion_tokens * model.outputCost;
    await costTracker.recordCost(cost / 1000, source, model.name);
  } else {
    throw "Error, no usage data returned from OpenAI API.";
  }

  return chatCompletion.choices[0].message.content || "";
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

  const history = [
    {
      role: LlmRole.User, // System role is not supported by Google API
      parts: systemMessage,
    },
    {
      role: "model",
      parts: "Understood",
    },
    ...context
      .filter((m) => m != lastMessage)
      .map((m) => ({
        role: m.role == LlmRole.Assistant ? "model" : LlmRole.User,
        parts: m.content,
      })),
  ];

  const chat = googleModel.startChat({
    history: history,
    generationConfig: {
      maxOutputTokens: 2000,
    },
  });

  const result = await chat.sendMessage(lastMessage.content);

  if (result.response.promptFeedback?.blockReason) {
    throw `Google API Request Blocked, ${result.response.promptFeedback.blockReason}`;
  }

  const responseText = result.response.text();

  // Total up cost, per 1000 characters with google
  // todo: take into account google allows 60 queries per minute for free
  const cost =
    lastMessage.content.length * model.inputCost +
    responseText.length * model.outputCost;

  await costTracker.recordCost(cost / 1000, source, model.name);

  return responseText;
}
