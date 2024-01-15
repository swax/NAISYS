import { consoleService } from "./consoleService.js";
import { contextService } from "./contextService.js";
import { envService } from "./envService.js";
import { sandboxFileSystem } from "./sandboxFileSystemService.js";
import { promptService } from "./promptService.js";

class CommandService {
  public handleConsoleInput(prompt: string, consoleInput: string) {
    const consoleInputLines = consoleInput.trim().split("\n");

    // iterate lines
    let firstLine = true;
    let processNextLine = true;
    let endcycle = false;
    const promptPrefix = promptService.getPromptPrefix();

    while (processNextLine) {
      processNextLine = false;

      let line = consoleInputLines.shift() || "";
      if (!line) {
        break;
      }

      // fix common error where chat gpt tries to by the prompt
      if (line.startsWith(prompt)) {
        line = line.slice(prompt.length);
      } else if (line.startsWith(promptPrefix)) {
        consoleService.comment(
          `Breaking processing of GPT response due to prompt in the response and wrong current folder: ${line}`
        );
        break;
      }

      if (envService.inputMode == "gpt") {
        // trim repeat prompts
        if (firstLine) {
          firstLine = false;
          // append break line in case gpt did not send one
          // later calls to contextService.append() will automatically append a break line
          contextService.append(line, "endPrompt");
          consoleService.output(prompt + line);
        } else {
          contextService.append(line);
        }
      }

      const cmdParams = line.trim().split(" ");

      if (!cmdParams[0]) {
        break;
      }

      const inMemResponse = sandboxFileSystem.handleCommand(
        line,
        consoleInputLines
      );

      if (inMemResponse.commandHandled) {
        processNextLine = inMemResponse.processNextLine;
        continue;
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
          endcycle = true;
          consoleService.comment(
            "------------------------------------------------------"
          );
          break;

        case "talk":
          const talkMsg = consoleInput.trim().split(" ").slice(1).join(" ");

          if (envService.inputMode === "gpt") {
            contextService.append("Message sent!");
          } else if (envService.inputMode === "root") {
            envService.toggleInputMode("gpt");
            contextService.append(
              `Message from root@${envService.hostname}: ${talkMsg}`
            );
            envService.toggleInputMode("root");
          }

          break;

        case "context":
          consoleService.output("#####################");
          consoleService.output(contextService.context);
          consoleService.output("#####################");
          break;

        default:
          contextService.append(
            `Please enter a valid command: '${cmdParams[0]}' is unknown`
          );
      }
    }

    // iterate unprocessed lines
    if (consoleInputLines.length) {
      consoleService.comment("Unprocessed lines from GPT response:");
      for (const line of consoleInputLines) {
        consoleService.comment(line);
      }
    }

    return endcycle;
  }
}

export const commandService = new CommandService();
