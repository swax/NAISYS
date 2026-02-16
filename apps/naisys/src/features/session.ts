import stringArgv from "string-argv";
import { AgentConfig } from "../agent/agentConfig.js";
import { UserService } from "../agent/userService.js";
import {
  CommandResponse,
  NextCommandAction,
  RegistrableCommand,
} from "../command/commandRegistry.js";
import { ShellCommand } from "../command/shellCommand.js";
import { GlobalConfig } from "../globalConfig.js";
import { SessionCompactor } from "../llm/sessionCompactor.js";
import { MailService } from "../mail/mail.js";
import { OutputService } from "../utils/output.js";
import * as utilities from "../utils/utilities.js";

export function createSessionService(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  sessionCompactor: SessionCompactor,
  shellCommand: ShellCommand,
  mailService: MailService,
  output: OutputService,
  userService: UserService,
  localUserId: number,
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

      // Changed nomenclature from pause to wait to better reflect that the session can wake on events
      case "wait":
        return handleWait(argv[1]);

      case "compact":
        return handleCompact(args.slice(subcommand.length).trim());

      case "complete":
        return handleComplete();

      default:
        return `Unknown subcommand: ${subcommand}\n\n${getHelpText()}`;
    }
  }

  function getHelpText(): string {
    let helpText = `ns-session <subcommand>
  wait [<seconds>]    Wait for the given number of seconds or indefinitely if not specified.
                      Session will wake on new mail or other events`;

    if (globalConfig().compactSessionEnabled) {
      helpText += `
  compact "<note>"    Compact context and reset the session
                      The note should contain your next goal and important things to remember`;
    }

    if (agentConfig().completeSessionEnabled) {
      helpText += `
  complete            End the session
                      Make sure to notify who you need to with results before completing.`;
    }

    return helpText;
  }

  function handleWait(
    secondsArg: string | undefined,
  ): string | CommandResponse {
    let waitSeconds = secondsArg ? parseInt(secondsArg) : 0;

    // No wait implies indefinite wait, but for lead agents we want to put a cap on it to prevent system hangs
    if (!waitSeconds) {
      const localUser = userService.getUserById(localUserId);
      if (!localUser?.leadUserId) {
        waitSeconds = globalConfig().shellCommand.maxTimeoutSeconds;
      } else {
        waitSeconds = -1; // Indefinite wait until wake event
      }
    }

    return {
      content: "",
      nextCommandResponse: {
        nextCommandAction: NextCommandAction.Continue,
        pauseSeconds: waitSeconds,
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
    commandName: "ns-session",
    helpText: "Manage session (compact, wait, or end)",
    handleCommand,
  };

  return {
    ...registrableCommand,
  };
}

export type SessionService = ReturnType<typeof createSessionService>;
