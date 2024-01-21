import OpenAI from "openai";
import * as config from "./config.js";
import * as contextManager from "./contextManager.js";
import * as output from "./output.js";

if (process.env.OPENAI_API_KEY === undefined) {
  output.comment("Error: OPENAI_API_KEY is not defined");
}

export async function send() {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  const chatCompletion = await openai.chat.completions.create({
    model: "gpt-4", //"gpt-3.5-turbo", //
    messages: [
      {
        role: "system",
        content: `You are ${config.username} a new hire with the job of creating a news website from the command line. 
            The website should be very simple, able to be used from a text based browser like lynx. Pages should be relatively short. 
            The 'user' role is the command line interface itself presenting you with the next command prompt. 
            Make sure the read the command line rules in the MOTD carefully.`,
      },
      { role: "user", content: contextManager.content },
    ],
  });

  return chatCompletion.choices[0].message.content || "";
}
