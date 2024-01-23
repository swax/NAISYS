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
  // We process the lines one at a time so we can support multiple commands with line breaks
  let firstLine = true;
  let continuingProcessing = true;
  const userHostPrompt = promptBuilder.getUserHostPrompt();

  let nextCommandAction = NextCommandAction.Continue;

  let nextInput = consoleInput.trim();

  while (continuingProcessing && nextInput) {
    let input = "";

    // if the prompt exists in the input, save if for the next run
    const nextPromptPos = nextInput.indexOf(userHostPrompt);

    if (nextPromptPos == 0) {
      const pathPrompt = await promptBuilder.getUserHostPathPrompt();

      // check working directory is the same
      if (nextInput.startsWith(pathPrompt)) {
        // slice nextInput after $
        const endPrompt = nextInput.indexOf("$", pathPrompt.length);
        nextInput = nextInput.slice(endPrompt + 1).trim();
        continue;
      }
      // else prompt did not match, stop processing input
      else {
        break;
      }
    }
    // we can't validate that the working directory in the prompt is good until the commands are processed
    else if (nextPromptPos > 0) {
      input = nextInput.slice(0, nextPromptPos);
      nextInput = nextInput.slice(nextPromptPos).trim();
    } else {
      input = nextInput;
      nextInput = "";
    }

    if (!input.trim()) {
      break;
    }

    // first line is special because we want to append the output to the context without a line break
    if (inputMode.current == InputMode.LLM) {
      if (firstLine) {
        firstLine = false;
        contextManager.append(input, "endPrompt");
        output.write(prompt + chalk[OutputColor.llm](input));
      } else {
        output.comment("Continuing with next optimistic command from LLM...");
        contextManager.append(input, "llm");
      }
    }

    const cmdParams = input.split(" ");

    switch (cmdParams[0]) {
      case "suggest":
        contextManager.append("Suggestion noted. Thank you for your feedback!");
        break;

      case "endsession":
        previousSessionNotes = input.slice("endsession".length).trim();
        output.comment(
          "------------------------------------------------------",
        );
        nextCommandAction = NextCommandAction.EndSession;
        continuingProcessing = false;
        break;

      case "talk": {
        const talkMsg = input.slice("talk".length).trim();

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
        const shellResponse = await shellCommand.handleCommand(input);

        if (shellResponse.commandHandled) {
          nextCommandAction = shellResponse.terminate
            ? NextCommandAction.ExitApplication
            : NextCommandAction.Continue;
        }
      }
    }
  }

  // display unprocessed lines to aid in debugging
  if (nextInput.trim()) {
    output.error(`Unprocessed LLM response:\n${nextInput}`);
  }

  return nextCommandAction;
}
