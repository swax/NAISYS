import dotenv from "dotenv";
import OpenAI from "openai";
import { consoleService } from "./consoleService.js";
import { contextService } from "./contextService.js";
import { envService } from "./envService.js";

dotenv.config();

if (process.env.OPENAI_API_KEY === undefined) {
  consoleService.comment("Error: OPENAI_API_KEY is not defined");
}

class GptService {
  public async send() {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    const chatCompletion = await openai.chat.completions.create({
      model: "gpt-4", //"gpt-3.5-turbo", //
      messages: [
        {
          role: "system",
          content: `You are ${envService.username} a new hire with the job of creating a news website from the command line. 
            The website should be very simple, able to be used from a text based browser like lynx. Pages should be relatively short. 
            The 'user' role is the command line interface itself presenting you with the next command prompt. 
            Make sure the read the command line rules in the MOTD carefully.`,
        },
        { role: "user", content: contextService.context },
      ],
    });

    return chatCompletion.choices[0].message.content || "";
  }
}

export const gptService = new GptService();
