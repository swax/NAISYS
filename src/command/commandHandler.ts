import chalk from "chalk";
import * as llmail from "../apps/llmail.js";
import * as llmynx from "../apps/llmynx.js";
import * as config from "../config.js";
import * as contextManager from "../llm/contextManager.js";
import { ContentSource } from "../llm/contextManager.js";
import * as costTracker from "../llm/costTracker.js";
import * as inputMode from "../utils/inputMode.js";
import { InputMode } from "../utils/inputMode.js";
import * as logService from "../utils/logService.js";
import * as output from "../utils/output.js";
import { OutputColor } from "../utils/output.js";
import * as promptBuilder from "./promptBuilder.js";
import * as shellCommand from "./shellCommand.js";

export enum NextCommandAction {
  Continue,
  EndSession,
  ExitApplication,
}

interface NextCommandResponse {
  nextCommandAction: NextCommandAction;
  pauseSeconds?: number;
  wakeOnMessage?: boolean;
}

export let previousSessionNotes = await logService.getPreviousEndSessionNote();

export async function consoleInput(
  prompt: string,
  consoleInput: string,
): Promise<NextCommandResponse> {
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
    const newLinePos = nextInput.indexOf("\n");

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
    }
    // Else for single line custom NAISYS commands, only process the first line as there may be follow up shell commands
    else if (newLinePos > 0 && nextInput.startsWith("comment ")) {
      input = nextInput.slice(0, newLinePos);
      nextInput = nextInput.slice(newLinePos).trim();
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
        await contextManager.append(input, ContentSource.LlmPromptResponse);
        output.write(prompt + chalk[OutputColor.llm](input));
      } else {
        await output.commentAndLog(
          "Continuing with next command from same LLM response...",
        );
        await contextManager.append(input, ContentSource.LLM);
      }
    }

    const cmdParams = input.split(" ");
    const cmdArgs = input.slice(cmdParams[0].length).trim();

    switch (cmdParams[0]) {
      case "comment": {
        // Important - Hint the LLM to turn their thoughts into accounts
        await contextManager.append(
          "Comment noted. Try running commands now to achieve your goal.",
        );
        break;
      }
      case "endsession": {
        previousSessionNotes = cmdArgs;
        await output.commentAndLog(
          "------------------------------------------------------",
        );
        nextCommandAction = NextCommandAction.EndSession;
        processNextLLMpromptBlock = false;
        break;
      }

      // Hidden for now as the LLM will use this instead of llmail
      case "talk": {
        const talkMsg = cmdArgs;

        if (inputMode.current === InputMode.LLM) {
          await contextManager.append("Message sent!");
        } else if (inputMode.current === InputMode.Debug) {
          inputMode.toggle(InputMode.LLM);
          await contextManager.append(
            `Message from admin@${config.hostname}: ${talkMsg}`,
          );
          inputMode.toggle(InputMode.Debug);
        }

        break;
      }

      // With no argument, in debug mode, pause will pause forever,
      // in LLM mode it will pause until a message is receieved
      //    Don't want the llm to hang itself, but it still can if it's the only agent or if all the agents pause..
      // The setting only lasts for the next command, next loop it uses the agent default
      case "pause": {
        return {
          nextCommandAction: NextCommandAction.Continue,
          pauseSeconds: cmdArgs ? parseInt(cmdArgs) : 0,
          wakeOnMessage: inputMode.current === InputMode.LLM,
        };
      }

      case "cost": {
        const totalCost = await costTracker.getTotalCosts();
        output.comment(
          `Total cost so far $${totalCost.toFixed(2)} of $${config.agent.spendLimitDollars} limit`,
        );
        break;
      }

      case "llmynx": {
        const llmynxResponse = await llmynx.handleCommand(cmdArgs);
        await contextManager.append(llmynxResponse);
        break;
      }

      case "llmail": {
        const mailResponse = await llmail.handleCommand(cmdArgs);
        await contextManager.append(mailResponse);
        break;
      }

      case "context":
        contextManager.printContext();
        break;

      default: {
        const shellResponse = await shellCommand.handleCommand(input);

        if (shellResponse.hasErrors && nextInput) {
          await output.errorAndLog(`Error detected processing shell command:`);
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
    await output.errorAndLog(`Unprocessed LLM response:\n${nextInput}`);
  }

  return {
    nextCommandAction,
    pauseSeconds: config.agent.debugPauseSeconds,
    wakeOnMessage: config.agent.wakeOnMessage,
  };
}
