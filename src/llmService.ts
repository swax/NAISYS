import OpenAI from "openai";
import * as config from "./config.js";
import * as contextManager from "./contextManager.js";
import { llmModel } from "./llmModel.js";

interface LLMServiceResponse {
  value: string;
  error?: boolean;
}

export async function send(): Promise<LLMServiceResponse> {
  if (process.env.OPENAI_API_KEY === undefined) {
    return {
      value: "LLM Service: Error, OPENAI_API_KEY is not defined",
      error: true,
    };
  }

  const model = llmModel.gpt4turbo;

  const openai = new OpenAI({
    baseURL: model.baseUrl,
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Assert the last message on the context is a user message
  const lastMessage =
    contextManager.messages[contextManager.messages.length - 1];
  if (lastMessage.role !== "user") {
    return {
      value:
        "LLM Service: Error, last message on context is not a user message",
      error: true,
    };
  }

  try {
    const chatCompletion = await openai.chat.completions.create({
      model: model.name,
      messages: [
        {
          role: "system",
          content: `You are ${config.username} a new hire with the job of creating a Neon Genesis Evangelion fan website from the command line. 
            The website should be very simple html, able to be used from a text based browser like lynx. Pages should be relatively short.
            The location of the website should be in /mnt/c/naisys/www 
            You can use PHP as a way to share layout across pages and reduce duplication.
            The 'user' role is the command line interface itself presenting you with the next command prompt. 
            Make sure the read the command line rules in the MOTD carefully.
            Don't try to guess the output of commands. 
            For example when you run 'cat' or 'ls', don't write what you think the output will be. Let the system do that.
            Your role is that of the user. Command responses and the next prompt will be provided by the 'user' role.
            Be careful when writing files through prompt close and escape quotes properly.`,
        },
        ...contextManager.messages,
        //{ role: "user", content: contextManager.content },
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
