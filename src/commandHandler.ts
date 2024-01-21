import chalk from "chalk";
import * as config from "./config.js";
import * as contextManager from "./contextManager.js";
import * as inputMode from "./inputMode.js";
import { InputMode } from "./inputMode.js";
import * as output from "./output.js";
import { OutputColor } from "./output.js";
import * as promptBuilder from "./promptBuilder.js";
import * as shellCommand from "./shellCommand.js";

export enum NextCommandAction {
  Continue,
  EndSession,
  ExitApplication,
}

export let previousSessionNotes = "";

export async function consoleInput(prompt: string, consoleInput: string) {
  const consoleInputLines = consoleInput.trim().split("\n");

  // We process the lines one at a time so we can support multiple commands with line breaks
  let firstLine = true;
  let processNextLine = true;
  const promptPrefix = promptBuilder.getPromptPrefix();

  let nextCommandAction = NextCommandAction.Continue;

  while (processNextLine) {
    processNextLine = false;

    const line = consoleInputLines.shift() || "";
    if (!line) {
      break;
    }

    // fix common error where chat llm tries to by the prompt
    if (line.startsWith(promptPrefix)) {
      consoleInputLines.unshift(line);
      break;
    }

    if (inputMode.current == InputMode.LLM) {
      // trim repeat prompts
      if (firstLine) {
        firstLine = false;
        // append break line in case llm did not send one
        // later calls to contextService.append() will automatically append a break line
        contextManager.append(line, "endPrompt");
        output.write(prompt + chalk[OutputColor.llm](line));
      } else {
        contextManager.append(line, "llm");
      }
    }

    const cmdParams = line.trim().split(" ");

    if (!cmdParams[0]) {
      break;
    }

    switch (cmdParams[0]) {
      case "suggest":
        contextManager.append("Suggestion noted. Thank you for your feedback!");
        break;

      case "endsession":
        previousSessionNotes = consoleInput
          .trim()
          .split(" ")
          .slice(1)
          .join(" ");
        output.comment(
          "------------------------------------------------------",
        );
        nextCommandAction = NextCommandAction.EndSession;
        processNextLine = false;
        break;

      case "talk": {
        const talkMsg = consoleInput.trim().split(" ").slice(1).join(" ");

        if (inputMode.current === InputMode.LLM) {
          contextManager.append("Message sent!");
        } else if (inputMode.current === InputMode.Debug) {
          inputMode.toggle(InputMode.LLM);
          contextManager.append(
            `Message from root@${config.hostname}: ${talkMsg}`,
          );
          inputMode.toggle(InputMode.Debug);
        }

        break;
      }

      case "context":
        output.comment("#####################");
        output.comment(contextManager.content);
        output.comment("#####################");
        break;

      default: {
        const shellResponse = await shellCommand.handleCommand(
          line,
          consoleInputLines,
        );

        if (shellResponse.commandHandled) {
          processNextLine = Boolean(shellResponse.processNextLine);
          nextCommandAction = shellResponse.terminate
            ? NextCommandAction.ExitApplication
            : NextCommandAction.Continue;
        }
      }
    }
  }

  // iterate unprocessed lines
  if (consoleInputLines.length) {
    output.error("Unprocessed lines from LLM response:");
    for (const line of consoleInputLines) {
      output.error(line);
    }
  }

  return nextCommandAction;
}
