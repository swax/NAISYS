import chalk from "chalk";
import { InputMode } from "../enums.js";
import { ConsoleColor, consoleService } from "./consoleService.js";
import { contextService } from "./contextService.js";
import { envService } from "./envService.js";
import { promptService } from "./promptService.js";
import { realShellService } from "./real-shell/realShellService.js";

class CommandService {
  public async handleConsoleInput(prompt: string, consoleInput: string) {
    const consoleInputLines = consoleInput.trim().split("\n");

    // We process the lines one at a time so we can support multiple commands with line breaks
    let firstLine = true;
    let processNextLine = true;
    let endsession = false;
    const promptPrefix = promptService.getPromptPrefix();

    while (processNextLine) {
      processNextLine = false;

      let line = consoleInputLines.shift() || "";
      if (!line) {
        break;
      }

      // fix common error where chat gpt tries to by the prompt
      if (line.startsWith(promptPrefix)) {
        consoleInputLines.unshift(line);
        break;
      }

      if (envService.inputMode == InputMode.LLM) {
        // trim repeat prompts
        if (firstLine) {
          firstLine = false;
          // append break line in case gpt did not send one
          // later calls to contextService.append() will automatically append a break line
          contextService.append(line, "endPrompt");
          consoleService.output(prompt + chalk[ConsoleColor.gpt](line));
        } else {
          contextService.append(line, "gpt");
        }
      }

      const cmdParams = line.trim().split(" ");

      if (!cmdParams[0]) {
        break;
      }

      switch (cmdParams[0]) {
        case "suggest":
          contextService.append(
            "Suggestion noted. Thank you for your feedback!"
          );
          break;

        case "endsession":
          envService.previousSessionNotes = consoleInput
            .trim()
            .split(" ")
            .slice(1)
            .join(" ");
          endsession = true;
          consoleService.comment(
            "------------------------------------------------------"
          );
          break;

        case "talk":
          const talkMsg = consoleInput.trim().split(" ").slice(1).join(" ");

          if (envService.inputMode === InputMode.LLM) {
            contextService.append("Message sent!");
          } else if (envService.inputMode === InputMode.Debug) {
            envService.toggleInputMode(InputMode.LLM);
            contextService.append(
              `Message from root@${envService.hostname}: ${talkMsg}`
            );
            envService.toggleInputMode(InputMode.Debug);
          }

          break;

        case "context":
          consoleService.comment("#####################");
          consoleService.comment(contextService.context);
          consoleService.comment("#####################");
          break;

        default:
          const fsResponse = await realShellService.handleCommand(
            line,
            consoleInputLines
          );

          if (fsResponse.commandHandled) {
            processNextLine = fsResponse.processNextLine;
          }
      }
    }

    // iterate unprocessed lines
    if (consoleInputLines.length) {
      consoleService.error("Unprocessed lines from GPT response:");
      for (const line of consoleInputLines) {
        consoleService.error(line);
      }
    }

    return endsession;
  }
}

export const commandService = new CommandService();
