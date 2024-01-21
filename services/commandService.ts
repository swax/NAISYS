import chalk from "chalk";
import * as consoleService from "./consoleService.js";
import { ConsoleColor } from "./consoleService.js";
import * as contextService from "./contextService.js";
import * as envService from "./envService.js";
import * as inputModeService from "./inputModeService.js";
import { InputMode } from "./inputModeService.js";
import * as promptService from "./promptService.js";
import * as shellCommandService from "./shellCommandService.js";

export enum NextCommandAction {
  Continue,
  EndSession,
  ExitApplication,
}

export let previousSessionNotes = "";

export async function handleConsoleInput(prompt: string, consoleInput: string) {
  const consoleInputLines = consoleInput.trim().split("\n");

  // We process the lines one at a time so we can support multiple commands with line breaks
  let firstLine = true;
  let processNextLine = true;
  const promptPrefix = promptService.getPromptPrefix();

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

    if (inputModeService.current == InputMode.LLM) {
      // trim repeat prompts
      if (firstLine) {
        firstLine = false;
        // append break line in case llm did not send one
        // later calls to contextService.append() will automatically append a break line
        contextService.append(line, "endPrompt");
        consoleService.output(prompt + chalk[ConsoleColor.llm](line));
      } else {
        contextService.append(line, "llm");
      }
    }

    const cmdParams = line.trim().split(" ");

    if (!cmdParams[0]) {
      break;
    }

    switch (cmdParams[0]) {
      case "suggest":
        contextService.append("Suggestion noted. Thank you for your feedback!");
        break;

      case "endsession":
        previousSessionNotes = consoleInput
          .trim()
          .split(" ")
          .slice(1)
          .join(" ");
        consoleService.comment(
          "------------------------------------------------------",
        );
        nextCommandAction = NextCommandAction.EndSession;
        processNextLine = false;
        break;

      case "talk": {
        const talkMsg = consoleInput.trim().split(" ").slice(1).join(" ");

        if (inputModeService.current === InputMode.LLM) {
          contextService.append("Message sent!");
        } else if (inputModeService.current === InputMode.Debug) {
          inputModeService.toggle(InputMode.LLM);
          contextService.append(
            `Message from root@${envService.hostname}: ${talkMsg}`,
          );
          inputModeService.toggle(InputMode.Debug);
        }

        break;
      }

      case "context":
        consoleService.comment("#####################");
        consoleService.comment(contextService.context);
        consoleService.comment("#####################");
        break;

      default: {
        const shellResponse = await shellCommandService.handleCommand(
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
    consoleService.error("Unprocessed lines from LLM response:");
    for (const line of consoleInputLines) {
      consoleService.error(line);
    }
  }

  return nextCommandAction;
}
