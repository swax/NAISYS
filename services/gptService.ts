import dotenv from "dotenv";
import { injectable } from "inversify";
import OpenAI from "openai";
import { ConsoleService } from "./consoleService.js";
import { ContextService } from "./contextService.js";
import { EnvService } from "./envService.js";

@injectable()
export class GptService {
  constructor(
    private _consoleService: ConsoleService,
    private _contextService: ContextService,
    private _envService: EnvService,
  ) {
    dotenv.config();

    if (process.env.OPENAI_API_KEY === undefined) {
      this._consoleService.comment("Error: OPENAI_API_KEY is not defined");
    }
  }

  public async send() {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    const chatCompletion = await openai.chat.completions.create({
      model: "gpt-4", //"gpt-3.5-turbo", //
      messages: [
        {
          role: "system",
          content: `You are ${this._envService.username} a new hire with the job of creating a news website from the command line. 
            The website should be very simple, able to be used from a text based browser like lynx. Pages should be relatively short. 
            The 'user' role is the command line interface itself presenting you with the next command prompt. 
            Make sure the read the command line rules in the MOTD carefully.`,
        },
        { role: "user", content: this._contextService.context },
      ],
    });

    return chatCompletion.choices[0].message.content || "";
  }
}
