import chalk from "chalk";
import stringArgv from "string-argv";
import { AgentConfig } from "../agent/agentConfig.js";
import { GenImg } from "../features/genimg.js";
import { LLMail } from "../features/llmail.js";
import { LLMynx } from "../features/llmynx.js";
import { SubagentService } from "../features/subagent.js";
import { GlobalConfig } from "../globalConfig.js";
import { ContextManager } from "../llm/contextManager.js";
import { CostTracker } from "../llm/costTracker.js";
import { ContentSource } from "../llm/llmDtos.js";
import { SessionCompactor } from "../llm/sessionCompactor.js";
import { RunService } from "../services/runService.js";
import { InputModeService } from "../utils/inputMode.js";
import { OutputColor, OutputService } from "../utils/output.js";
import * as utilities from "../utils/utilities.js";
import { CommandProtection } from "./commandProtection.js";
import { PromptBuilder } from "./promptBuilder.js";
import { ShellCommand } from "./shellCommand.js";

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
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  commandProtection: CommandProtection,
  promptBuilder: PromptBuilder,
  shellCommand: ShellCommand,
  genimg: GenImg,
  subagent: SubagentService,
  llmail: LLMail,
  llmynx: LLMynx,
  sessionCompactor: SessionCompactor,
  contextManager: ContextManager,
  costTracker: CostTracker,
  output: OutputService,
  inputMode: InputModeService,
  runService: RunService,
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
      if (inputMode.isLLM()) {
        if (firstLine) {
          firstLine = false;
          await contextManager.append(input, ContentSource.LlmPromptResponse);
          output.write(prompt + chalk[OutputColor.llm](input));
        } else {
          // Check if multiple commands are disabled
          if (!firstCommand && agentConfig().disableMultipleCommands) {
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

      const argv = stringArgv(input);
      const command = argv[0];
      // cmdArgs is everything after the command name
      const cmdArgs = input.slice(command.length).trim();

      switch (command) {
        case "comment": {
          // Important - Hint the LLM to turn their thoughts into accounts
          // ./bin/comment shell script has the same message
          await contextManager.append(
            "Comment noted. Try running commands now to achieve your goal.",
          );
          break;
        }
        case "trimsession": {
          if (!globalConfig().trimSessionEnabled) {
            throw 'The "trimsession" command is not enabled in this environment.';
          }
          const trimSummary = contextManager.trim(cmdArgs);
          await contextManager.append(trimSummary);
          break;
        }
        case "endsession": {
          if (!globalConfig().endSessionEnabled) {
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

          await sessionCompactor.run();

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

          if (inputMode.isLLM()) {
            await contextManager.append("Message sent!");
          } else if (inputMode.isDebug()) {
            inputMode.setLLM();
            const respondCommand = agentConfig().mailEnabled
              ? "llmail"
              : "talk";
            await contextManager.append(
              `Message from admin: ${talkMsg}. Respond via the ${respondCommand} command.`,
            );
            inputMode.setDebug();
          }

          break;
        }

        case "pause": {
          const pauseSeconds = argv[1] ? parseInt(argv[1]) : 0;

          // Don't allow the LLM to hang itself
          if (inputMode.isLLM() && !pauseSeconds) {
            await contextManager.append(
              "Pause command requires a number of seconds to pause for",
            );
            break;
          }

          return {
            nextCommandAction: NextCommandAction.Continue,
            pauseSeconds,
            wakeOnMessage: agentConfig().wakeOnMessage,
          };
        }

        case "completetask": {
          const taskResult = utilities.trimChars(cmdArgs, '"');

          if (!taskResult) {
            await output.errorAndLog(
              "The 'completetask' command requires a result parameter",
            );
            break;
          }

          const leadAgent = agentConfig().leadAgent;

          if (leadAgent && agentConfig().mailEnabled) {
            await output.commentAndLog(
              "Sub agent has completed the task. Notifying lead agent and exiting process.",
            );
            await llmail.sendMessage([leadAgent], "Task Completed", taskResult);
          } else {
            await output.commentAndLog("Task completed. Exiting process.");
          }

          return {
            nextCommandAction: NextCommandAction.ExitApplication,
            pauseSeconds: 0, // Hold until message or input is received
            wakeOnMessage: agentConfig().wakeOnMessage,
          };
        }

        case "cost": {
          if (argv[1] === "reset") {
            const userId = agentConfig().spendLimitDollars
              ? runService.getUserId()
              : undefined;
            await costTracker.clearCosts(userId);
            await contextManager.append(
              `Cost tracking data cleared for ${userId ? `${agentConfig().username}` : "all users"}.`,
            );
          } else if (argv[1]) {
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

      if (command != "comment" && firstCommand) {
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
      pauseSeconds: agentConfig().debugPauseSeconds,
      wakeOnMessage: agentConfig().wakeOnMessage,
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

export type CommandHandler = ReturnType<typeof createCommandHandler>;
