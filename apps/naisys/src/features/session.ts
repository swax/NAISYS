import stringArgv from "string-argv";

import { AgentConfig } from "../agent/agentConfig.js";
import { sessionCmd } from "../command/commandDefs.js";
import {
  CommandResponse,
  NextCommandAction,
  RegistrableCommand,
} from "../command/commandRegistry.js";
import { ShellCommand } from "../command/shellCommand.js";
import { GlobalConfig } from "../globalConfig.js";
import { ContextManager } from "../llm/contextManager.js";
import { LLMService } from "../llm/llmService.js";
import { OutputService } from "../utils/output.js";
import { getTokenCount } from "../utils/utilities.js";

export function createSessionService(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  shellCommand: ShellCommand,
  output: OutputService,
  contextManager: ContextManager,
  systemMessage: string,
  llmService: LLMService,
) {
  let restoreInfo = "";

  async function handleCommand(
    args: string,
  ): Promise<string | CommandResponse> {
    const argv = stringArgv(args);
    const subcommand = argv[0];

    if (!subcommand) {
      return getHelpText();
    }

    switch (subcommand) {
      case "help":
        return getHelpText();

      // Changed nomenclature from pause to wait to better reflect that the session can wake on events
      case "wait":
        return handleWait(argv[1]);

      case "compact":
        return handleCompact();

      case "restore":
        return handleRestore();

      case "complete":
        return handleComplete();

      default:
        return `Unknown subcommand: ${subcommand}\n\n${getHelpText()}`;
    }
  }

  function getHelpText(): string {
    const subs = sessionCmd.subcommands!;

    let helpText = `${sessionCmd.name} <subcommand>
  ${subs.wait.usage.padEnd(20)}${subs.wait.description}`;

    if (globalConfig().compactSessionEnabled) {
      helpText += `
  ${subs.compact.usage.padEnd(20)}${subs.compact.description}`;
    }

    if (agentConfig().completeSessionEnabled) {
      helpText += `
  ${subs.complete.usage.padEnd(20)}${subs.complete.description}`;
    }

    return helpText;
  }

  function handleWait(
    secondsArg: string | undefined,
  ): string | CommandResponse {
    let waitSeconds = secondsArg ? parseInt(secondsArg) : 0;

    // We did support indefinite waiting, which you can do by returning a pauseSeconds value of -1
    // The problem was all the agents waiting indefinitely would end up hanging the entire system
    if (!waitSeconds) {
      return `Please specify the number of seconds to wait, for example: ns-session wait 60`;
    }

    return {
      content: "",
      nextCommandResponse: {
        nextCommandAction: NextCommandAction.Continue,
        pauseSeconds: waitSeconds,
      },
    };
  }

  async function handleCompact(): Promise<string | CommandResponse> {
    if (!globalConfig().compactSessionEnabled) {
      return 'The "ns-session compact" command is not enabled in this environment.';
    }

    if (shellCommand.isShellSuspended()) {
      return "Session cannot be compacted while a shell command is active.";
    }

    await output.commentAndLog("Compacting session...");

    contextManager.append(
      "Process this session log and reduce it down to important things to remember - " +
        "references, plans, project structure, schemas, file locations, urls, and more. Focus on the near term, next logical steps. " +
        "Check for and fix any inconsistencies in the current context to avoid passing them on the next session. " +
        "The next session should be able to start with minimal bootstrapping or scanning of existing files. " +
        "What are the things the next session should do when restored - tasks, goals, etc.. And ensure it has " +
        "all the important context to do those things, as it will be starting from a blank slate. \n\n" +
        "# Write the restored-session seed below (no preamble).",
    );

    await output.commentAndLog(`Compacting...`);

    const queryResult = await llmService.query(
      agentConfig().shellModel,
      systemMessage,
      contextManager.getCombinedMessages(),
      "compact",
    );

    restoreInfo = queryResult.responses.join("\n");

    await output.commentAndLog(
      `Session compacted to ${getTokenCount(restoreInfo)} tokens. Restarting Session.`,
    );
    await output.commentAndLog(
      "------------------------------------------------------",
    );

    return {
      content: "",
      nextCommandResponse: {
        nextCommandAction: NextCommandAction.CompactSession,
        pauseSeconds: 0,
      },
    };
  }

  function canRestore() {
    return !!restoreInfo;
  }

  function handleRestore(): string | CommandResponse {
    if (!restoreInfo) {
      return "No session restore information available.";
    }

    return {
      content: restoreInfo,
      nextCommandResponse: {
        nextCommandAction: NextCommandAction.Continue,
      },
    };
  }

  /**
   * Tried havin a user/message param on this command but even advanced LLMs were getting it confused.
   * Just tell it to notify whoever it needs to before running the command and keep this one simple.
   */
  async function handleComplete(): Promise<string | CommandResponse> {
    if (!agentConfig().completeSessionEnabled) {
      return 'The "ns-session complete" command is not enabled for you, please use wait command instead.';
    }

    await output.commentAndLog("Session completed. Exiting process.");

    return {
      content: "",
      nextCommandResponse: {
        nextCommandAction: NextCommandAction.ExitApplication,
        pauseSeconds: 0,
      },
    };
  }

  const registrableCommand: RegistrableCommand = {
    command: sessionCmd,
    handleCommand,
  };

  return {
    ...registrableCommand,
    canRestore,
  };
}

export type SessionService = ReturnType<typeof createSessionService>;
