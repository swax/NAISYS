import { consoleService } from "./consoleService.js";
import { contextService } from "./contextService.js";
import { envService } from "./envService.js";
import { inMemoryFileSystem } from "./inMemoryFileSystemService.js";

class CommandService {
  public handleConsoleInput(prompt: string, consoleInput: string) {
    const consoleInputLines = consoleInput.trim().split("\n");

    // iterate lines
    let firstLine = true;
    let processNextLine = true;
    let endcycle = false;
    const promptPrefix = envService.getPromptPrefix();

    while (processNextLine) {
      processNextLine = false;

      const line = consoleInputLines.shift() || "";
      if (!line) {
        break;
      }

      // trim repeat prompts
      if (line.startsWith(promptPrefix)) {
        consoleService.comment(
          `Breaking processing of GPT response due to prompt in the response: ${line}`
        );
        break;
      } else if (firstLine) {
        firstLine = false;
        // append break line in case gpt did not send one
        // later calls to contextService.append() will automatically append a break line
        contextService.append(line, "endPrompt");
        consoleService.output(prompt + line);
      } else {
        contextService.append(line);
      }

      const cmdParams = line.trim().split(" ");

      if (!cmdParams[0]) {
        break;
      }

      const inMemResponse = inMemoryFileSystem.handleCommand(
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

        case "talk":
          contextService.append("Message sent!");
          break;

        case "endsession":
          envService.previousSessionNotes = consoleInput
            .trim()
            .split(" ")
            .slice(1)
            .join(" ");
          endcycle = true;
          console.log("------------------------------------------------------");
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
