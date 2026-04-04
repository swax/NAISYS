import chalk from "chalk";
import stringArgv from "string-argv";

import type { AgentConfig } from "../agent/agentConfig.js";
import type { GlobalConfig } from "../globalConfig.js";
import type { ContextManager } from "../llm/contextManager.js";
import { ContentSource } from "../llm/llmDtos.js";
import type { InputModeService } from "../utils/inputMode.js";
import type { OutputService } from "../utils/output.js";
import { OutputColor } from "../utils/output.js";
import type { CommandProtection } from "./commandProtection.js";
import type {
  CommandRegistry,
  NextCommandResponse,
} from "./commandRegistry.js";
import { NextCommandAction } from "./commandRegistry.js";
import type { PromptBuilder } from "./promptBuilder.js";
import type { ShellCommand } from "./shellCommand.js";
import type { ShellWrapper } from "./shellWrapper.js";

export function createCommandHandler(
  _globalConfig: GlobalConfig,
  { agentConfig }: AgentConfig,
  commandProtection: CommandProtection,
  promptBuilder: PromptBuilder,
  shellCommand: ShellCommand,
  shellWrapper: ShellWrapper,
  commandRegistry: CommandRegistry,
  contextManager: ContextManager,
  output: OutputService,
  inputMode: InputModeService,
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
          contextManager.append(input, ContentSource.LlmPromptResponse);
          output.write(prompt + chalk[OutputColor.llm](input));
        } else {
          // Check if multiple commands are disabled
          if (!firstCommand && !agentConfig().multipleCommandsEnabled) {
            output.errorAndLog(
              `Multiple commands disabled. Blocked command: ${input}`,
            );
            break;
          }
          output.commentAndLog(
            `Continuing with next command from same LLM response...`,
          );
          contextManager.append(input, ContentSource.LLM);
        }

        // Skip write protection for internal NAISYS commands
        const commandName = stringArgv(input)[0];
        if (!commandRegistry.get(commandName)) {
          const { commandAllowed, rejectReason } =
            await commandProtection.validateCommand(input);

          if (!commandAllowed) {
            output.errorAndLog(`Write Protection Triggered`);
            contextManager.append(rejectReason || "Unknown");
            break;
          }
        }
      }

      const argv = stringArgv(input);
      const command = argv[0];
      // cmdArgs is everything after the command name
      const cmdArgs = input.slice(command.length).trim();

      // Check command registry first
      const registeredCommand = commandRegistry.get(command);
      if (registeredCommand) {
        const expandedArgs = await expandShellArgs(cmdArgs);

        const response = await registeredCommand.handleCommand(expandedArgs);

        // Handle string or CommandResponse
        if (typeof response === "string") {
          contextManager.append(response);
        } else {
          contextManager.append(response.content);

          // If command provides a next command response, return it directly
          if (response.nextCommandResponse) {
            return response.nextCommandResponse;
          }
        }
      } else {
        const exitApp = await shellCommand.handleCommand(input);

        nextCommandAction = exitApp
          ? NextCommandAction.ExitApplication
          : NextCommandAction.Continue;
      }

      if (command != "ns-comment" && firstCommand) {
        firstCommand = false;
      }

      // After the first real command, check if we've exceeded the token limit.
      // Break early so the LLM can re-evaluate and decide to compact.
      if (
        !firstCommand &&
        commandList.length > 0 &&
        contextManager.getTokenCount() > agentConfig().tokenMax
      ) {
        output.errorAndLog(
          `Token limit exceeded mid-response, breaking to allow session compaction`,
        );
        break;
      }
    } // End loop processing LLM response

    // display unprocessed lines to aid in debugging
    if (commandList.length) {
      output.errorAndLog(
        `Unprocessed LLM commands:\n${commandList.map((c, i) => `${i + 1}: ${c}`).join("\n")}`,
      );
    }

    return {
      nextCommandAction,
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
    else if (nextInput.startsWith(`ns-comment "`)) {
      // Find next double quote in nextInput that isn't escaped
      let endQuote = nextInput.indexOf(`"`, 12);
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
      (nextInput.startsWith("ns-comment ") ||
        nextInput.startsWith("ns-genimg ") ||
        nextInput.startsWith("ns-look ") ||
        nextInput.startsWith("ns-session "))
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

  /**
   * Expand env vars, command substitutions ($(...)), and ~ in args via the
   * shell.  Parses args first so each one is expanded individually,
   * preserving argument boundaries (plain `echo $args` flattens all quoting
   * and breaks multi-word values).
   */
  async function expandShellArgs(cmdArgs: string): Promise<string> {
    if (!/[$~]/.test(cmdArgs)) {
      return cmdArgs;
    }

    const parsedArgs = stringArgv(cmdArgs);
    const expandedParts: string[] = [];
    let anyExpanded = false;

    for (let arg of parsedArgs) {
      // Convert ~ to $HOME so it expands inside double quotes
      if (arg.startsWith("~")) {
        arg = "$HOME" + arg.slice(1);
      }

      if (/\$/.test(arg)) {
        // Escape \, ", and ` but keep $ for shell expansion
        const safe = arg
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"')
          .replace(/`/g, "\\`");
        const expanded = (
          await shellWrapper.executeCommand(`printf '%s' "${safe}"`)
        ).trimEnd();
        expandedParts.push(expanded);
        anyExpanded = true;
      } else {
        expandedParts.push(arg);
      }
    }

    if (!anyExpanded) {
      return cmdArgs;
    }

    // Re-encode as quoted args so downstream stringArgv preserves boundaries
    return expandedParts
      .map((part) => {
        const escaped = part.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        return `"${escaped}"`;
      })
      .join(" ");
  }

  return {
    processCommand,
    exportedForTesting: {
      popFirstCommand,
    },
  };
}

export type CommandHandler = ReturnType<typeof createCommandHandler>;
