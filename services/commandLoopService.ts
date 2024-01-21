import chalk from "chalk";
import { injectable } from "inversify";
import * as readline from "readline";
import { InputMode } from "../enums.js";
import { CommandService, NextCommandAction } from "./commandService.js";
import { ConsoleService } from "./consoleService.js";
import { ContextService } from "./contextService.js";
import { EnvService } from "./envService.js";
import { GptService } from "./gptService.js";
import { PromptService } from "./promptService.js";
import { ShellCommandService } from "./shellCommandService.js";
import { ShellService } from "./shellService.js";

@injectable()
export class CommandLoopService {
  readlineInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  constructor(
    private _commandService: CommandService,
    private _consoleService: ConsoleService,
    private _contextService: ContextService,
    private _envService: EnvService,
    private _gptService: GptService,
    private _promptService: PromptService,
    private _shellCommandService: ShellCommandService,
    private _shellService: ShellService,
  ) {}

  public async run() {
    let nextCommandAction = NextCommandAction.Continue;

    while (nextCommandAction != NextCommandAction.ExitApplication) {
      this._envService.toggleInputMode(InputMode.LLM);

      this._contextService.append(`NAISYS 1.0 Shell
Welcome back ${this._envService.username}!
MOTD:
Date: ${new Date().toUTCString()}
Standard Unix Commands available. 
  vi and nano are not supported. 
  Read/write entire files with cat and echo.
Special Commands:
  suggest <note>: Suggest something to be implemented for the next cycle
  talk <user> <message>: Use this command to send a message to another user
  endsession <note>: Ends this session, clears the console log. Add notes to carry over to the next session
The console log can only hold a certain number of 'tokens' that is specified in the prompt.
  Make sure to call endsession before the limit is hit to you can continue your work with a fresh console.
Previous session notes: ${this._envService.previousSessionNotes || "None"}
`);

      this._contextService.append(
        (await this._promptService.getPrompt()) + "ls",
      );
      await this._shellCommandService.handleCommand("ls", []);

      this._envService.toggleInputMode(InputMode.Debug);

      while (nextCommandAction == NextCommandAction.Continue) {
        const prompt = await this._promptService.getPrompt();
        let input = "";

        // Root runs in a shadow mode
        if (this._envService.inputMode === InputMode.Debug) {
          input = await this._getInput(`${prompt}`);
        }
        // When GPT runs input/output is added to the context
        else if (this._envService.inputMode === InputMode.LLM) {
          this._contextService.append(prompt, "startPrompt");

          input = await this._gptService.send();
        }

        nextCommandAction = await this._commandService.handleConsoleInput(
          prompt,
          input,
        );

        // If the user is in debug mode and they didn't enter anything, switch to LLM
        // If in LLM mode, auto switch back to debug
        if (
          (this._envService.inputMode == InputMode.Debug && !input) ||
          this._envService.inputMode == InputMode.LLM
        ) {
          this._envService.toggleInputMode();
        }
      }

      if (nextCommandAction == NextCommandAction.EndSession) {
        this._contextService.clear();
        nextCommandAction = NextCommandAction.Continue;
      }
    }

    await this._shellService.terminate();
    this._consoleService.comment("NAISYS Terminated");
  }

  private _getInput(query: string) {
    return new Promise<string>((resolve) => {
      this.readlineInterface.question(chalk.greenBright(query), (answer) => {
        resolve(answer);
      });
    });
  }
}
