import chalk from "chalk";
import { injectable } from "inversify";
import * as readline from "readline";
import { CommandService, NextCommandAction } from "./commandService.js";
import { ConsoleService } from "./consoleService.js";
import { ContextService } from "./contextService.js";
import { EnvService } from "./envService.js";
import { LlmService } from "./llmService.js";
import { InputMode, InputModeService } from "./inputModeService.js";
import { PromptService } from "./promptService.js";

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
    private _llmService: LlmService,
    private _inputModeService: InputModeService,
    private _promptService: PromptService,
  ) {}

  public async run() {
    let nextCommandAction = NextCommandAction.Continue;

    while (nextCommandAction != NextCommandAction.ExitApplication) {
      this._inputModeService.toggle(InputMode.LLM);

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
Previous session notes: ${this._commandService.previousSessionNotes || "None"}
`);

      await this._commandService.handleConsoleInput(
        await this._promptService.getPrompt(),
        "ls",
      );

      this._inputModeService.toggle(InputMode.Debug);

      while (nextCommandAction == NextCommandAction.Continue) {
        const prompt = await this._promptService.getPrompt();
        let input = "";

        // Root runs in a shadow mode
        if (this._inputModeService.current === InputMode.Debug) {
          input = await this._getInput(`${prompt}`);
        }
        // When GPT runs input/output is added to the context
        else if (this._inputModeService.current === InputMode.LLM) {
          this._contextService.append(prompt, "startPrompt");

          input = await this._llmService.send();
        }

        nextCommandAction = await this._commandService.handleConsoleInput(
          prompt,
          input,
        );

        // If the user is in debug mode and they didn't enter anything, switch to LLM
        // If in LLM mode, auto switch back to debug
        if (
          (this._inputModeService.current == InputMode.Debug && !input) ||
          this._inputModeService.current == InputMode.LLM
        ) {
          this._inputModeService.toggle();
        }
      }

      if (nextCommandAction == NextCommandAction.EndSession) {
        this._contextService.clear();
        nextCommandAction = NextCommandAction.Continue;
      }
    }

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
