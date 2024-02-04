import OpenAI from "openai";
import * as config from "./config.js";
import * as contextManager from "./contextManager.js";
import * as output from "./output.js";

import { llmModel } from "./llmModel.js";

export async function send() {
  if (process.env.OPENAI_API_KEY === undefined) {
    output.comment("Error: OPENAI_API_KEY is not defined");
    return "";
  }

  const model = llmModel.local;

  const openai = new OpenAI({
    baseURL: model.baseUrl,
    apiKey: process.env.OPENAI_API_KEY,
  });

  const chatCompletion = await openai.chat.completions.create({
    model: model.name,
    messages: [
      {
        role: "system",
        content: `You are ${config.username} a new hire with the job of creating a website about animals from the command line. 
            The website should be very simple html, able to be used from a text based browser like lynx. Pages should be relatively short. 
            The 'user' role is the command line interface itself presenting you with the next command prompt. 
            Make sure the read the command line rules in the MOTD carefully.
            Don't try to guess the output of commands. 
            For example when you run 'cat' or 'ls', don't write what you think the output will be. Let the system do that.
            Your role is that of the user. Command responses and the next prompt will be provided by the 'user' role.`,
      },
      { role: "user", content: contextManager.content },
    ],
  });

  return chatCompletion.choices[0].message.content || "";
}
