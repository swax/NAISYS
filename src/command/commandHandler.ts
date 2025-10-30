import chalk from "chalk";
import { loadConfigFromPath } from "../config.js";
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
import { createCommandProtection } from "./commandProtection.js";
import { createPromptBuilder } from "./promptBuilder.js";
import { createShellCommand } from "./shellCommand.js";

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

export function createCommandHandler(
  config: Awaited<ReturnType<typeof loadConfigFromPath>>,
  commandProtection: ReturnType<typeof createCommandProtection>,
  promptBuilder: ReturnType<typeof createPromptBuilder>,
  shellCommand: ReturnType<typeof createShellCommand>,
) {
  async function processCommand(
    prompt: string,
    commandList: string[],
  ): Promise<NextCommandResponse> {
    // We process the lines one at a time so we can support multiple commands with line breaks
    let firstLine = true;
    let firstCommand = true;
    let processNextLLMpromptBlock = true;

    let nextCommandAction = NextCommandAction.Continue;

    while (processNextLLMpromptBlock && commandList.length) {
      const { input, splitResult } = await popFirstCommand(commandList);

      if (splitResult == "inputInPrompt") {
        continue;
      } else if (splitResult == "inputPromptMismatch" || !input.trim()) {
        break;
      }

      // First line is special because we want to append the output to the context without a line break
      if (inputMode.current == InputMode.LLM) {
        if (firstLine) {
          firstLine = false;
          await contextManager.append(input, ContentSource.LlmPromptResponse);
          output.write(prompt + chalk[OutputColor.llm](input));
        } else {
          // Check if multiple commands are disabled
          if (!firstCommand && config.agent.disableMultipleCommands) {
            await output.errorAndLog(
              `Multiple commands disabled. Blocked command: ${input}`,
            );
            break;
          }
          await output.commentAndLog(
            `Continuing with next command from same LLM response...`,
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

          if (shellCommand.isShellSuspended()) {
            await contextManager.append(
              "Session cannot be ended while a shell command is active.",
            );
            break;
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
              "Pause command requires a number of seconds to pause for",
            );
            break;
          }

          return {
            nextCommandAction: NextCommandAction.Continue,
            pauseSeconds,
            wakeOnMessage: config.agent.wakeOnMessage,
          };
        }

        case "completetask": {
          const taskResult = cmdArgs?.trim();

          if (!taskResult) {
            await output.errorAndLog(
              "The 'completetask' command requires a result parameter",
            );
            break;
          }

          if (config.agent.leadAgent && config.mailEnabled) {
            await output.commentAndLog(
              "Sub agent has completed the task. Notifying lead agent and exiting process.",
            );
            const leadAgent = config.agent.leadAgent;
            await llmail.newThread([leadAgent], "Task Completed", taskResult);
          } else {
            await output.commentAndLog("Task completed. Exiting process.");
          }

          return {
            nextCommandAction: NextCommandAction.ExitApplication,
            pauseSeconds: 0, // Hold until message or input is received
            wakeOnMessage: config.agent.wakeOnMessage,
          };
        }

        case "cost": {
          if (cmdArgs === "reset") {
            const username = config.agent.spendLimitDollars
              ? config.agent.username
              : undefined;
            await costTracker.clearCosts(username);
            await contextManager.append(
              `Cost tracking data cleared for ${username || "all users"}.`,
            );
          } else if (cmdArgs) {
            await output.errorAndLog(
              "The 'cost' command only supports the 'reset' parameter.",
            );
          } else {
            await costTracker.printCosts();
          }
          break;
        }

        case "llmynx": {
          const llmynxResponse = await llmynx.handleCommand(cmdArgs);
          await contextManager.append(llmynxResponse);
          break;
        }

        case "llmail": {
          const mailResponse = await llmail.handleCommand(cmdArgs);
          await contextManager.append(mailResponse.content);

          if (mailResponse.pauseSeconds) {
            return {
              nextCommandAction: NextCommandAction.Continue,
              pauseSeconds: mailResponse.pauseSeconds,
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
      } // End switch

      if (cmdParams[0] != "comment" && firstCommand) {
        firstCommand = false;
      }
    } // End loop processing LLM response

    // display unprocessed lines to aid in debugging
    if (commandList.length) {
      await output.errorAndLog(
        `Unprocessed LLM commands:\n${commandList.map((c, i) => `${i + 1}: ${c}`).join("\n")}`,
      );
    }

    return {
      nextCommandAction,
      pauseSeconds: config.agent.debugPauseSeconds,
      wakeOnMessage: config.agent.wakeOnMessage,
    };
  }

  type SplitResult =
    | "inputInPrompt"
    | "inputPromptMismatch"
    | "sliced"
    | "popped";
  /**
   * Pops the first command, but it some cases splits the first command, and pushes the rest back to the command list
   * If the command starts with the command prompt itself, slice that off
   * If the command starts with a NAISYS command, slice that off as welll as it needs to be processed internally by NAISYS and the the shell
   */
  async function popFirstCommand(commandList: string[]) {
    let nextInput = commandList.shift() || "";
    nextInput = nextInput.trim();

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
        splitResult = "inputInPrompt";
      }
      // Else prompt did not match, stop processing input
      else {
        splitResult = "inputPromptMismatch";
      }
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
        nextInput.startsWith("trimsession ") ||
        nextInput.startsWith("pause "))
    ) {
      input = nextInput.slice(0, newLinePos);
      nextInput = nextInput.slice(newLinePos).trim();
    }
    // If shell is suspended, the process can kill/wait the shell, and may run some commands after
    else if (
      newLinePos > 0 &&
      shellCommand.isShellSuspended() &&
      (nextInput.startsWith("kill") || nextInput.startsWith("wait"))
    ) {
      input = nextInput.slice(0, newLinePos);
      nextInput = nextInput.slice(newLinePos).trim();
    }
    // We can't validate that the working directory in the prompt is good until the commands are processed
    else if (nextPromptPos > 0) {
      input = nextInput.slice(0, nextPromptPos);
      nextInput = nextInput.slice(nextPromptPos).trim();
    }

    // Else process the entire input now
    else {
      input = nextInput;
      nextInput = "";
    }

    if (nextInput) {
      commandList.unshift(nextInput);
    }

    if (!splitResult) {
      splitResult = nextInput ? "sliced" : "popped";
    }

    return { input, splitResult };
  }

  return {
    processCommand,
    exportedForTesting: {
      popFirstCommand,
    },
  };
}
