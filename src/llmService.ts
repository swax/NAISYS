import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import * as config from "./config.js";
import * as contextManager from "./contextManager.js";
import { LlmRole } from "./contextManager.js";
import { getLLModel } from "./llmModels.js";
import { valueFromString } from "./utilities.js";

export async function send(): Promise<string> {
  const model = getLLModel(config.agent.consoleModel);

  if (model.key === "google") {
    return sendWithGoogle();
  } else {
    return sendWithOpenAiCompatible();
  }
}

export function getSystemMessage() {
  const agentPrompt = config.agent.agentPrompt.replace(
    /\$\{config\.([^\}]+)\}/g,
    (match, key) => {
      const value = valueFromString(config, key);
      if (value === undefined) {
        throw `Agent config: Error, ${key} is not defined`;
      }
      return value;
    },
  );

  return `${agentPrompt}
The 'user' role is the command line interface itself presenting you with the next command prompt. 
Make sure the read the command line rules in the MOTD carefully.
Don't try to guess the output of commands. 
For example when you run 'cat' or 'ls', don't write what you think the output will be. Let the system do that.
Your role is that of the user. Command responses and the next prompt will be provided by the 'user' role.
Be careful when writing files through prompt close and escape quotes properly.`;
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
        content: getSystemMessage(),
      },
      ...contextManager.messages,
      //{ role: LlmRole.User, content: contextManager.content },
    ],
  });

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
      parts: getSystemMessage(),
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
  const response = await result.response;

  return response.text();
}
