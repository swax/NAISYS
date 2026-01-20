import stringArgv from "string-argv";
import { AgentConfig } from "../agent/agentConfig.js";
import {
  CommandResponse,
  NextCommandAction,
  RegistrableCommand,
} from "../command/commandRegistry.js";
import { ShellCommand } from "../command/shellCommand.js";
import { LLMail } from "./llmail.js";
import { GlobalConfig } from "../globalConfig.js";
import { ContextManager } from "../llm/contextManager.js";
import { SessionCompactor } from "../llm/sessionCompactor.js";
import { OutputService } from "../utils/output.js";
import * as utilities from "../utils/utilities.js";

export function createSessionService(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  contextManager: ContextManager,
  sessionCompactor: SessionCompactor,
  shellCommand: ShellCommand,
  llmail: LLMail,
  output: OutputService,
) {
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

      case "trim":
        return handleTrim(args.slice(subcommand.length).trim());

      case "compact":
        return handleCompact(args.slice(subcommand.length).trim());

      case "complete":
        return handleComplete(args.slice(subcommand.length).trim());

      default:
        return `Unknown subcommand: ${subcommand}\n\n${getHelpText()}`;
    }
  }

  function getHelpText(): string {
    let helpText = `ns-session <subcommand>
  help                    Show this help message`;

    if (globalConfig().trimSessionEnabled) {
      helpText += `
  trim <indexes>          Remove prompts by index to save tokens (e.g., "1-5, 8, 11-13")`;
    }

    if (globalConfig().compactSessionEnabled) {
      helpText += `
  compact "<note>"        End session, compact context, and start fresh
                          Note should contain your next goal and important things to remember`;
    }

    if (agentConfig().completeTaskEnabled) {
      helpText += `
  complete "<result>"     Mark task as complete and exit
                          Result should contain important output from the task`;
    }

    return helpText;
  }

  function handleTrim(args: string): string {
    if (!globalConfig().trimSessionEnabled) {
      return 'The "ns-session trim" command is not enabled in this environment.';
    }

    if (!args) {
      return 'Usage: ns-session trim <indexes>\nExample: ns-session trim "1-5, 8, 11-13"';
    }

    return contextManager.trim(args);
  }

  async function handleCompact(
    args: string,
  ): Promise<string | CommandResponse> {
    if (!globalConfig().compactSessionEnabled) {
      return 'The "ns-session compact" command is not enabled in this environment.';
    }

    if (shellCommand.isShellSuspended()) {
      return "Session cannot be compacted while a shell command is active.";
    }

    const sessionNotes = utilities.trimChars(args, '"');

    if (!sessionNotes) {
      return 'Session notes are required. Use ns-session compact "<notes>"';
    }

    await sessionCompactor.run();

    await output.commentAndLog(
      "------------------------------------------------------",
    );

    return {
      content: "",
      nextCommandResponse: {
        nextCommandAction: NextCommandAction.CompactSession,
        pauseSeconds: 0,
        wakeOnMessage: false,
      },
    };
  }

  async function handleComplete(
    args: string,
  ): Promise<string | CommandResponse> {
    if (!agentConfig().completeTaskEnabled) {
      return 'The "ns-session complete" command is not enabled for this agent.';
    }

    const taskResult = utilities.trimChars(args, '"');

    if (!taskResult) {
      return 'Task result is required. Use ns-session complete "<result>"';
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
      content: "",
      nextCommandResponse: {
        nextCommandAction: NextCommandAction.ExitApplication,
        pauseSeconds: 0,
        wakeOnMessage: false,
      },
    };
  }

  const registrableCommand: RegistrableCommand = {
    commandName: "ns-session",
    handleCommand,
  };

  return {
    ...registrableCommand,
  };
}

export type SessionService = ReturnType<typeof createSessionService>;
