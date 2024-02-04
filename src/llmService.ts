import OpenAI from "openai";
import * as config from "./config.js";
import * as contextManager from "./contextManager.js";
import * as output from "./output.js";

export async function send() {
  if (process.env.OPENAI_API_KEY === undefined) {
    output.comment("Error: OPENAI_API_KEY is not defined");
    return "";
  }

  const openai = new OpenAI({
    //baseURL:"http://localhost:1234/v1",
    apiKey: process.env.OPENAI_API_KEY,
  });

  const chatCompletion = await openai.chat.completions.create({
    model: "gpt-4", //"gpt-3.5-turbo", //
    messages: [
      {
        role: "system",
        content: `You are ${config.username} a new hire with the job of creating a news website from the command line. 
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
