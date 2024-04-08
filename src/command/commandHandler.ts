import chalk from "chalk";
import * as config from "../config.js";
import * as genimg from "../features/genimg.js";
import * as llmail from "../features/llmail.js";
import * as llmynx from "../features/llmynx.js";
import * as subagent from "../features/subagent.js";
import * as contextManager from "../llm/contextManager.js";
import * as costTracker from "../llm/costTracker.js";
import * as dreamMaker from "../llm/dreamMaker.js";
import { ContentSource } from "../llm/llmDtos.js";
import * as inputMode from "../utils/inputMode.js";
import { InputMode } from "../utils/inputMode.js";
import * as output from "../utils/output.js";
import { OutputColor } from "../utils/output.js";
import * as utilities from "../utils/utilities.js";
import * as commandProtection from "./commandProtection.js";
import * as promptBuilder from "./promptBuilder.js";
import * as shellCommand from "./shellCommand.js";

export enum NextCommandAction {
  Continue,
  EndSession,
  ExitApplication,
}

interface NextCommandResponse {
  nextCommandAction: NextCommandAction;
  pauseSeconds: number;
  wakeOnMessage: boolean;
}

export async function processCommand(
  prompt: string,
  consoleInput: string,
): Promise<NextCommandResponse> {
  // We process the lines one at a time so we can support multiple commands with line breaks
  let firstLine = true;
  let processNextLLMpromptBlock = true;

  let nextCommandAction = NextCommandAction.Continue;

  consoleInput = consoleInput.trim();

  while (processNextLLMpromptBlock && consoleInput) {
    const { input, nextInput, splitResult } =
      await splitMultipleInputCommands(consoleInput);

    consoleInput = nextInput;

    if (splitResult == SplitResult.InputIsPrompt) {
      continue;
    } else if (
      splitResult == SplitResult.InputPromptMismatch ||
      !input.trim()
    ) {
      break;
    }

    // First line is special because we want to append the output to the context without a line break
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

      // Run write protection checks if enabled
      const { commandAllowed, rejectReason } =
        await commandProtection.validateCommand(input);

      if (!commandAllowed) {
        await output.errorAndLog(`Write Protection Triggered`);
        await contextManager.append(rejectReason || "Unknown");
        break;
      }
    }

    const cmdParams = input.split(" ");
    const cmdArgs = input.slice(cmdParams[0].length).trim();

    switch (cmdParams[0]) {
      case "comment": {
        // Important - Hint the LLM to turn their thoughts into accounts
        // ./bin/comment shell script has the same message
        await contextManager.append(
          "Comment noted. Try running commands now to achieve your goal.",
        );
        break;
      }
      case "trimsession": {
        if (!config.trimSessionEnabled) {
          throw 'The "trimsession" command is not enabled in this environment.';
        }
        const trimSummary = contextManager.trim(cmdArgs);
        await contextManager.append(trimSummary);
        break;
      }
      case "endsession": {
        if (!config.endSessionEnabled) {
          throw 'The "trimsession" command is not enabled in this environment.';
        }
        // Don't need to check end line as this is the last command in the context, just read to the end
        const endSessionNotes = utilities.trimChars(cmdArgs, '"');

        if (!endSessionNotes) {
          await contextManager.append(
            `End session notes are required. Use endsession "<notes>"`,
          );
          break;
        }

        await dreamMaker.goodnight();

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

      case "pause": {
        const pauseSeconds = cmdArgs ? parseInt(cmdArgs) : 0;

        // Don't allow the LLM to hang itself
        if (inputMode.current === InputMode.LLM && !pauseSeconds) {
          await contextManager.append(
            "Puase command requires a number of seconds to pause for",
          );
          break;
        }

        return {
          nextCommandAction: NextCommandAction.Continue,
          pauseSeconds,
          wakeOnMessage: false, // llmail has a 'wait' command that is useful in multi-agent situations
        };
      }

      case "cost": {
        await costTracker.printCosts();
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

        if (mailResponse == llmail.waitingForMailMessage) {
          return {
            nextCommandAction: NextCommandAction.Continue,
            pauseSeconds: 0,
            wakeOnMessage: true,
          };
        }
        break;
      }

      case "genimg": {
        const genimgResponse = await genimg.handleCommand(cmdArgs);
        await contextManager.append(genimgResponse);
        break;
      }

      case "context":
        output.comment("#####################");
        output.comment(contextManager.printContext());
        output.comment("#####################");
        break;

      case "subagent": {
        const subagentResponse = await subagent.handleCommand(cmdArgs);
        await contextManager.append(subagentResponse);
        break;
      }
      default: {
        const exitApp = await shellCommand.handleCommand(input);

        nextCommandAction = exitApp
          ? NextCommandAction.ExitApplication
          : NextCommandAction.Continue;
      }
    }
  }

  // display unprocessed lines to aid in debugging
  if (consoleInput.trim()) {
    await output.errorAndLog(`Unprocessed LLM response:\n${consoleInput}`);
  }

  return {
    nextCommandAction,
    pauseSeconds: config.agent.debugPauseSeconds,
    wakeOnMessage: config.agent.wakeOnMessage,
  };
}

enum SplitResult {
  InputIsPrompt,
  InputPromptMismatch,
}

async function splitMultipleInputCommands(nextInput: string) {
  let input = "";
  let splitResult: SplitResult | undefined;

  // If the prompt exists in the input, save if for the next run
  const userHostPrompt = promptBuilder.getUserHostPrompt();
  const nextPromptPos = nextInput.indexOf(userHostPrompt);
  const newLinePos = nextInput.indexOf("\n");

  if (nextPromptPos == 0) {
    const pathPrompt = await promptBuilder.getUserHostPathPrompt();

    // Check working directory is the same
    if (nextInput.startsWith(pathPrompt)) {
      // Slice nextInput after $
      const endPrompt = nextInput.indexOf("$", pathPrompt.length);
      nextInput = nextInput.slice(endPrompt + 1).trim();
      splitResult = SplitResult.InputIsPrompt;
    }
    // Else prompt did not match, stop processing input
    else {
      splitResult = SplitResult.InputPromptMismatch;
    }
  }
  // We can't validate that the working directory in the prompt is good until the commands are processed
  else if (nextPromptPos > 0) {
    input = nextInput.slice(0, nextPromptPos);
    nextInput = nextInput.slice(nextPromptPos).trim();
  }
  // Most custom NAISYS commands are single line, but comment in quotes can span multiple lines so we need to handle that
  // because often the LLM puts shell commands after the comment
  else if (nextInput.startsWith(`comment "`)) {
    // Find next double quote in nextInput that isn't escaped
    let endQuote = nextInput.indexOf(`"`, 9);
    while (endQuote > 0 && nextInput[endQuote - 1] === "\\") {
      endQuote = nextInput.indexOf(`"`, endQuote + 1);
    }

    if (endQuote > 0) {
      input = nextInput.slice(0, endQuote + 1);
      nextInput = nextInput.slice(endQuote + 1).trim();
    } else {
      input = nextInput;
      nextInput = "";
    }
  }
  // If the LLM forgets the quote on the comment, treat it as a single line comment
  // Not something we want to use for multi-line commands like llmail and subagent
  else if (
    newLinePos > 0 &&
    (nextInput.startsWith("comment ") ||
      nextInput.startsWith("genimg ") ||
      nextInput.startsWith("trimsession "))
  ) {
    input = nextInput.slice(0, newLinePos);
    nextInput = nextInput.slice(newLinePos).trim();
  }
  // Else process the entire input now
  else {
    input = nextInput;
    nextInput = "";
  }

  return { input, nextInput, splitResult };
}

export const exportedForTesting = {
  splitMultipleInputCommands,
  SplitResult,
};
