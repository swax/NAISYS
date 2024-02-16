import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import * as config from "./config.js";
import * as contextManager from "./contextManager.js";
import { LlmRole } from "./contextManager.js";
import { llmModel } from "./llmModel.js";

interface LLMServiceResponse {
  value: string;
  error?: boolean;
}

const model = llmModel.gpt4turbo;

export async function send(): Promise<LLMServiceResponse> {
  if (model === llmModel.google) {
    return sendWithGoogle();
  } else {
    return sendWithOpenAiCompatible();
  }
}

function getSystemMessage() {
  return `You are ${config.username} a new hire with the job of creating a Neon Genesis Evangelion fan website from the command line. 
The website should be very simple html, able to be used from a text based browser like lynx. Pages should be relatively short.
The location of the website should be in /mnt/c/naisys/www 
When website can be tested at http://swax-elitebook.local/ use --dump with lynx as it does not work in interactive mode.
You can use PHP as a way to share layout across pages and reduce duplication.
The 'user' role is the command line interface itself presenting you with the next command prompt. 
Make sure the read the command line rules in the MOTD carefully.
Don't try to guess the output of commands. 
For example when you run 'cat' or 'ls', don't write what you think the output will be. Let the system do that.
Your role is that of the user. Command responses and the next prompt will be provided by the 'user' role.
Be careful when writing files through prompt close and escape quotes properly.`;
}

async function sendWithOpenAiCompatible(): Promise<LLMServiceResponse> {
  const openAI = new OpenAI({
    baseURL: model.baseUrl,
    apiKey: process.env.OPENAI_API_KEY,
  });

  if (process.env.OPENAI_API_KEY === undefined) {
    throw "LLM Service: Error, OPENAI_API_KEY is not defined";
  }

  // Assert the last message on the context is a user message
  const lastMessage =
    contextManager.messages[contextManager.messages.length - 1];

  if (lastMessage.role !== LlmRole.User) {
    return {
      value:
        "LLM Service: Error, last message on context is not a user message",
      error: true,
    };
  }

  try {
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

    return {
      value: chatCompletion.choices[0].message.content || "",
    };
  } catch (e) {
    return {
      value: "LLM Service: " + e,
      error: true,
    };
  }
}

async function sendWithGoogle(): Promise<LLMServiceResponse> {
  const googleAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");

  const googleModel = googleAI.getGenerativeModel({ model: model.name });

  // Assert the last message on the context is a user message
  const lastMessage =
    contextManager.messages[contextManager.messages.length - 1];

  if (lastMessage.role !== LlmRole.User) {
    return {
      value:
        "LLM Service: Error, last message on context is not a user message",
      error: true,
    };
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

  try {
    const result = await chat.sendMessage(lastMessage.content);
    const response = await result.response;

    return {
      value: response.text(),
    };
  } catch (e) {
    return {
      value: "LLM Service: " + e,
      error: true,
    };
  }
}
