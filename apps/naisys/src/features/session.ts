import { ADMIN_USERNAME } from "@naisys/common";
import stringArgv from "string-argv";

import type { AgentConfig } from "../agent/agentConfig.js";
import type { UserService } from "../agent/userService.js";
import { sessionCmd } from "../command/commandDefs.js";
import type {
  CommandResponse,
  RegistrableCommand,
} from "../command/commandRegistry.js";
import {
  NextCommandAction,
  noWait,
  timedWait,
} from "../command/commandRegistry.js";
import type { ShellCommand } from "../command/shellCommand.js";
import type { GlobalConfig } from "../globalConfig.js";
import type { ContextManager } from "../llm/contextManager.js";
import { ContentSource } from "../llm/llmDtos.js";
import type { LLMService } from "../llm/llmService.js";
import type { ChatService } from "../mail/chat.js";
import type { MailService } from "../mail/mail.js";
import type { LogService } from "../services/logService.js";
import type { OutputService } from "../utils/output.js";
import { getTokenCount, trimChars } from "../utils/utilities.js";

export function createSessionService(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  shellCommand: ShellCommand,
  output: OutputService,
  contextManager: ContextManager,
  systemMessage: string,
  llmService: LLMService,
  mailService: MailService,
  chatService: ChatService,
  userService: UserService,
  logService: LogService,
  localUserId: number,
  /** Saved summary shipped inline on AGENT_START when continuity = "summary". */
  preloadedRestoreSummary: string | undefined,
) {
  let restoreInfo =
    agentConfig().continuity === "summary"
      ? (preloadedRestoreSummary ?? "")
      : "";
  let resumeWaitSeconds: number | undefined;

  if (restoreInfo) {
    output.commentAndLog(
      `Loaded restore summary from hub (${getTokenCount(restoreInfo)} tokens).`,
    );
  }

  /** Extracted from handleCompact so handleComplete can reuse the LLM call
   *  without triggering a session restart. */
  async function produceRestoreSummary(): Promise<void> {
    contextManager.append(
      "Process this session log and reduce it down to important things to remember - " +
        "references, plans, project structure, schemas, file locations, urls, and more. Focus on the near term, next logical steps. " +
        "Check for and fix any inconsistencies in the current context to avoid passing them on the next session. " +
        "The next session should be able to start with minimal bootstrapping or scanning of existing files. " +
        "What are the things the next session should do when restored - tasks, goals, etc.. And ensure it has " +
        "all the important context to do those things, as it will be starting from a blank slate. \n\n" +
        "# Write the restored-session seed below (no preamble).",
    );

    const queryResult = await llmService.query(
      agentConfig().shellModel,
      systemMessage,
      contextManager.getCombinedMessages(),
      "compact",
    );

    restoreInfo = queryResult.responses.join("\n");

    logService.write({
      role: "assistant",
      source: ContentSource.LLM,
      type: "compact",
      content: restoreInfo,
    });
  }

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
      case "continue-wait":
        return handleWait(argv[1]);

      case "compact":
        return handleCompact();

      case "preemptive-compact":
        return handlePreemptiveCompact(argv[1]);

      case "restore":
        return handleRestore();

      case "complete":
        return handleComplete(args.slice(subcommand.length).trim());

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
    const waitSeconds = secondsArg ? parseInt(secondsArg) : NaN;

    // Indefinite waits are kept internal so unattended agents do not hang the system.
    if (isNaN(waitSeconds) || waitSeconds <= 0) {
      return `Please specify the number of seconds to wait, for example: ns-session wait 60`;
    }

    return {
      content: "",
      nextCommandResponse: {
        nextCommandAction: NextCommandAction.Continue,
        wait: timedWait(waitSeconds),
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

    output.commentAndLog(`Compacting...`);

    await produceRestoreSummary();

    output.commentAndLog(
      `Session compacted to ${getTokenCount(restoreInfo)} tokens. Restarting Session.`,
    );
    output.commentAndLog(
      "------------------------------------------------------",
    );

    return {
      content: "",
      nextCommandResponse: {
        nextCommandAction: NextCommandAction.CompactSession,
        wait: noWait(),
      },
    };
  }

  async function handlePreemptiveCompact(
    remainingSecondsArg: string | undefined,
  ): Promise<string | CommandResponse> {
    if (!globalConfig().preemptiveCompactEnabled) {
      throw new Error("Preemptive compact is not enabled");
    }

    if (!agentConfig().autoCompact) {
      throw new Error("Auto compact is not enabled for this agent");
    }

    const remaining = remainingSecondsArg ? parseInt(remainingSecondsArg) : 0;
    if (isNaN(remaining) || remaining < 0) {
      throw new Error(
        "Preemptive compact requires a valid remaining seconds argument",
      );
    }

    if (remaining > 0) {
      output.commentAndLog(
        `Pre-emptively compacting session before read cache expires. Will continue waiting ${remaining} seconds on resume...`,
      );
      resumeWaitSeconds = remaining;
    } else {
      output.commentAndLog(
        `Pre-emptively compacting session before read cache expires...`,
      );
    }
    return handleCompact();
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

  async function handleComplete(
    resultArg: string,
  ): Promise<string | CommandResponse> {
    if (!agentConfig().completeSessionEnabled) {
      return 'The "ns-session complete" command is not enabled for you, please use wait command instead.';
    }

    const result = trimChars(resultArg, '"');

    if (!result) {
      return 'Please provide a result message, for example: ns-session complete "Task finished successfully"';
    }

    // Capture a fresh seed before exit so the next run can resume.
    if (agentConfig().continuity === "summary") {
      output.commentAndLog("Saving session summary before completing...");
      try {
        await produceRestoreSummary();
      } catch (e) {
        output.errorAndLog(`Failed to produce restore summary: ${e}`);
      }
    }

    const localUser = userService.getUserById(localUserId);
    const recipientId =
      localUser?.leadUserId ??
      userService.getUserByName(ADMIN_USERNAME)?.userId;

    const recipient = recipientId
      ? userService.getUserById(recipientId)
      : undefined;

    if (recipient) {
      const useMail =
        globalConfig().mailServiceEnabled && agentConfig().mailEnabled;
      if (useMail) {
        await mailService.sendMessage([recipient], "Session Completed", result);
      } else {
        await chatService.sendToUser(
          recipient.userId,
          `Session Completed: ${result}`,
        );
      }
      output.commentAndLog(
        `Session completed. Result sent to ${recipient.username}. Exiting process.`,
      );
    } else {
      output.commentAndLog("Session completed. Exiting process.");
    }

    return {
      content: "",
      nextCommandResponse: {
        nextCommandAction: NextCommandAction.SessionComplete,
        wait: noWait(),
      },
    };
  }

  const registrableCommand: RegistrableCommand = {
    command: sessionCmd,
    handleCommand,
  };

  function getResumeCommands(): string[] {
    const commands: string[] = [];

    if (restoreInfo) {
      commands.push("ns-session restore");
    }

    if (resumeWaitSeconds && resumeWaitSeconds > 0) {
      commands.push(`ns-session continue-wait ${resumeWaitSeconds}`);
      resumeWaitSeconds = undefined;
    }

    return commands;
  }

  return {
    ...registrableCommand,
    getResumeCommands,
  };
}

export type SessionService = ReturnType<typeof createSessionService>;
