import chalk from "chalk";
import * as config from "./config.js";
import * as contextManager from "./contextManager.js";
import * as inputMode from "./inputMode.js";
import { InputMode } from "./inputMode.js";
import * as llmynx from "./llmynx.js";
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
  let processNextLLMpromptBlock = true;
  const userHostPrompt = promptBuilder.getUserHostPrompt();

  let nextCommandAction = NextCommandAction.Continue;

  let nextInput = consoleInput.trim();

  while (processNextLLMpromptBlock && nextInput) {
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
    const cmdArgs = input.slice(cmdParams[0].length).trim();

    switch (cmdParams[0]) {
      case "suggest":
        contextManager.append("Suggestion noted. Thank you for your feedback!");
        break;

      case "endsession":
        previousSessionNotes = cmdArgs;
        output.comment(
          "------------------------------------------------------",
        );
        nextCommandAction = NextCommandAction.EndSession;
        processNextLLMpromptBlock = false;
        break;

      case "talk": {
        const talkMsg = cmdArgs;

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

      case "llmynx": {
        const argParams = cmdArgs.split(" ");
        const url = argParams[0];
        const goal = cmdArgs.slice(argParams[0].length).trim();
        const reducedUrlContent = await llmynx.run(url, goal, 2500);
        contextManager.append(reducedUrlContent);
        break;
      }

      case "context":
        output.comment("#####################");
        output.comment(contextManager.content);
        output.comment("#####################");
        break;

      default: {
        const shellResponse = await shellCommand.handleCommand(input);

        if (shellResponse.hasErrors) {
          output.error(`Error detected processing shell command:`);
          processNextLLMpromptBlock = false;
        }

        nextCommandAction = shellResponse.terminate
          ? NextCommandAction.ExitApplication
          : NextCommandAction.Continue;
      }
    }
  }

  // display unprocessed lines to aid in debugging
  if (nextInput.trim()) {
    output.error(`Unprocessed LLM response:\n${nextInput}`);
  }

  return nextCommandAction;
}
