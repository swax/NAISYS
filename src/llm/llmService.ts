import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import * as config from "../config.js";
import { LlmRole } from "./contextLog.js";
import * as contextManager from "./contextManager.js";
import * as costTracker from "./costTracker.js";
import { getLLModel } from "./llmModels.js";

export async function send(): Promise<string> {
  const currentTotalCost = await costTracker.getTotalCosts();
  if (config.costLimitDollars < currentTotalCost) {
    throw `LLM Service: Cost limit of $${config.costLimitDollars} reached`;
  }

  const model = getLLModel(config.agent.consoleModel);

  if (model.key === "google") {
    return sendWithGoogle();
  } else {
    return sendWithOpenAiCompatible();
  }
}

async function sendWithOpenAiCompatible(): Promise<string> {
  const model = getLLModel(config.agent.consoleModel);

  const openAI = new OpenAI({
    baseURL: model.baseUrl,
    apiKey: config.openaiApiKey,
  });

  // Assert the last message on the context is a user message
  const lastMessage =
    contextManager.messages[contextManager.messages.length - 1];

  if (lastMessage.role !== LlmRole.User) {
    throw "LLM Service: Error, last message on context is not a user message";
  }

  const chatCompletion = await openAI.chat.completions.create({
    model: model.name,
    messages: [
      {
        role: LlmRole.System,
        content: contextManager.getSystemMessage(),
      },
      ...contextManager.messages.map((m) => ({
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
    await costTracker.recordCost(cost / 1000);
  } else {
    throw "LLM Service: Error, no usage data returned from OpenAI API.";
  }

  return chatCompletion.choices[0].message.content || "";
}

async function sendWithGoogle(): Promise<string> {
  const model = getLLModel(config.agent.consoleModel);

  const googleAI = new GoogleGenerativeAI(config.googleApiKey);

  const googleModel = googleAI.getGenerativeModel({ model: model.name });

  // Assert the last message on the context is a user message
  const lastMessage =
    contextManager.messages[contextManager.messages.length - 1];

  if (lastMessage.role !== LlmRole.User) {
    throw "LLM Service: Error, last message on context is not a user message";
  }

  const history = [
    {
      role: LlmRole.User, // System role is not supported by Google API
      parts: contextManager.getSystemMessage(),
    },
    {
      role: "model",
      parts: "Understood",
    },
    ...contextManager.messages
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
    throw `LLM Service: Request Blocked, ${result.response.promptFeedback.blockReason}`;
  }

  const responseText = result.response.text();

  // Total up cost, per 1000 characters with google
  // todo: take into account google allows 60 queries per minute for free
  const cost =
    lastMessage.content.length * model.inputCost +
    responseText.length * model.outputCost;

  await costTracker.recordCost(cost / 1000);

  return responseText;
}
