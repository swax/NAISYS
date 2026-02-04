import stringArgv from "string-argv";
import { AgentConfig } from "../agent/agentConfig.js";
import {
  CommandResponse,
  NextCommandAction,
  RegistrableCommand,
} from "../command/commandRegistry.js";
import { ShellCommand } from "../command/shellCommand.js";
import { GlobalConfig } from "../globalConfig.js";
import { SessionCompactor } from "../llm/sessionCompactor.js";
import { MailService } from "../mail/mail.js";
import { InputModeService } from "../utils/inputMode.js";
import { OutputService } from "../utils/output.js";
import * as utilities from "../utils/utilities.js";

export function createSessionService(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  sessionCompactor: SessionCompactor,
  shellCommand: ShellCommand,
  mailService: MailService,
  output: OutputService,
  inputMode: InputModeService,
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

      case "pause":
        return handlePause(argv[1]);

      case "compact":
        return handleCompact(args.slice(subcommand.length).trim());

      case "complete":
        return handleComplete(argv[1], argv[2]);

      default:
        return `Unknown subcommand: ${subcommand}\n\n${getHelpText()}`;
    }
  }

  function getHelpText(): string {
    let helpText = `ns-session <subcommand>
  pause <seconds>         Pause session for the given number of seconds. 
                          Session will wake on new mail`;

    if (globalConfig().compactSessionEnabled) {
      helpText += `
  compact "<note>"        Compact context and reset the session
                          The note should contain your next goal and important things to remember`;
    }

    if (agentConfig().completeSessionEnabled) {
      helpText += `
  complete [<notify_user>] ["<result>"]
                          End the session
                          Optionally notify a user with important information or output`;
    }

    return helpText;
  }

  function handlePause(
    secondsArg: string | undefined,
  ): string | CommandResponse {
    const pauseSeconds = secondsArg ? parseInt(secondsArg) : 0;

    // Don't allow the LLM to hang itself
    if (inputMode.isLLM() && !pauseSeconds) {
      return "Pause command requires a number of seconds to pause for";
    }

    return {
      content: "",
      nextCommandResponse: {
        nextCommandAction: NextCommandAction.Continue,
        pauseSeconds,
        wakeOnMessage: agentConfig().wakeOnMessage,
      },
    };
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
    notifyUser: string | undefined,
    taskResult: string | undefined,
  ): Promise<string | CommandResponse> {
    if (!agentConfig().completeSessionEnabled) {
      return 'The "ns-session complete" command is not enabled for this agent.';
    }

    if (notifyUser) {
      await output.commentAndLog(
        `Session completed. Notifying ${notifyUser} and exiting process.`,
      );
      await mailService.sendMessage(
        [notifyUser],
        "Session Completed",
        taskResult || "Session completed",
      );
    } else {
      await output.commentAndLog("Session completed. Exiting process.");
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
    helpText: "Manage session (compact, pause, or end)",
    handleCommand,
  };

  return {
    ...registrableCommand,
  };
}

export type SessionService = ReturnType<typeof createSessionService>;
