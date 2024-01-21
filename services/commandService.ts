import chalk from "chalk";
import { injectable } from "inversify";
import { InputMode } from "../enums.js";
import { ConsoleColor, ConsoleService } from "./consoleService.js";
import { ContextService } from "./contextService.js";
import { EnvService } from "./envService.js";
import { PromptService } from "./promptService.js";
import { ShellCommandService } from "./shellCommandService.js";

export enum NextCommandAction {
  Continue,
  EndSession,
  ExitApplication,
}

@injectable()
export class CommandService {
  constructor(
    private _consoleService: ConsoleService,
    private _contextService: ContextService,
    private _envService: EnvService,
    private _promptService: PromptService,
    private _shellCommandService: ShellCommandService,
  ) {}

  public async handleConsoleInput(prompt: string, consoleInput: string) {
    const consoleInputLines = consoleInput.trim().split("\n");

    // We process the lines one at a time so we can support multiple commands with line breaks
    let firstLine = true;
    let processNextLine = true;
    const promptPrefix = this._promptService.getPromptPrefix();

    let nextCommandAction = NextCommandAction.Continue;

    while (processNextLine) {
      processNextLine = false;

      const line = consoleInputLines.shift() || "";
      if (!line) {
        break;
      }

      // fix common error where chat gpt tries to by the prompt
      if (line.startsWith(promptPrefix)) {
        consoleInputLines.unshift(line);
        break;
      }

      if (this._envService.inputMode == InputMode.LLM) {
        // trim repeat prompts
        if (firstLine) {
          firstLine = false;
          // append break line in case gpt did not send one
          // later calls to contextService.append() will automatically append a break line
          this._contextService.append(line, "endPrompt");
          this._consoleService.output(prompt + chalk[ConsoleColor.gpt](line));
        } else {
          this._contextService.append(line, "gpt");
        }
      }

      const cmdParams = line.trim().split(" ");

      if (!cmdParams[0]) {
        break;
      }

      if (cmdParams[0] == "exit") {
        if (this._envService.inputMode == InputMode.LLM) {
          this._contextService.append(
            "Use 'endsession' to end the session and clear the console log.",
          );
        } else if (this._envService.inputMode == InputMode.Debug) {
          nextCommandAction = NextCommandAction.ExitApplication;
          break;
        }
      }

      switch (cmdParams[0]) {
        case "suggest":
          this._contextService.append(
            "Suggestion noted. Thank you for your feedback!",
          );
          break;

        case "endsession":
          this._envService.previousSessionNotes = consoleInput
            .trim()
            .split(" ")
            .slice(1)
            .join(" ");
          this._consoleService.comment(
            "------------------------------------------------------",
          );
          nextCommandAction = NextCommandAction.EndSession;
          processNextLine = false;
          break;

        case "talk": {
          const talkMsg = consoleInput.trim().split(" ").slice(1).join(" ");

          if (this._envService.inputMode === InputMode.LLM) {
            this._contextService.append("Message sent!");
          } else if (this._envService.inputMode === InputMode.Debug) {
            this._envService.toggleInputMode(InputMode.LLM);
            this._contextService.append(
              `Message from root@${this._envService.hostname}: ${talkMsg}`,
            );
            this._envService.toggleInputMode(InputMode.Debug);
          }

          break;
        }

        case "context":
          this._consoleService.comment("#####################");
          this._consoleService.comment(this._contextService.context);
          this._consoleService.comment("#####################");
          break;

        default: {
          const fsResponse = await this._shellCommandService.handleCommand(
            line,
            consoleInputLines,
          );

          if (fsResponse.commandHandled) {
            processNextLine = fsResponse.processNextLine;
          }
        }
      }
    }

    // iterate unprocessed lines
    if (consoleInputLines.length) {
      this._consoleService.error("Unprocessed lines from GPT response:");
      for (const line of consoleInputLines) {
        this._consoleService.error(line);
      }
    }

    return nextCommandAction;
  }
}
