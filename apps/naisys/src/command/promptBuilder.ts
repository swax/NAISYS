import chalk from "chalk";
import * as readline from "readline";
import { AgentConfig } from "../agent/agentConfig.js";
import { GlobalConfig } from "../globalConfig.js";
import { ContextManager } from "../llm/contextManager.js";
import { isElevated, PlatformConfig } from "../services/shellPlatform.js";
import { InputModeService } from "../utils/inputMode.js";
import { OutputService } from "../utils/output.js";
import { PromptNotificationService } from "../utils/promptNotificationService.js";
import { getSharedReadline } from "../utils/sharedReadline.js";
import { writeEventManager } from "../utils/writeEventManager.js";
import { ShellWrapper } from "./shellWrapper.js";

export function createPromptBuilder(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  shellWrapper: ShellWrapper,
  contextManager: ContextManager,
  output: OutputService,
  inputMode: InputModeService,
  platformConfig: PlatformConfig,
  promptNotification: PromptNotificationService,
) {
  /**
   * When actual output is entered by the user we want to cancel any auto-continue timers and/or wake on message
   * We don't want to cancel if the user is entering a chords like ctrl+b then down arrow, when using tmux
   * This is why we can't put the event listener on the standard process.stdin/keypress event.
   * There is no 'data entered' output event so this monkey patch does that
   *
   * Using a shared writeEventManager singleton to avoid conflicts when multiple agents are running
   */
  writeEventManager.hookStdout();

  async function getPrompt(pauseSeconds: number, wakeOnMessage: boolean) {
    const promptSuffix = isElevated()
      ? platformConfig.adminPromptSuffix
      : platformConfig.promptSuffix;

    const tokenMax = agentConfig().tokenMax;
    const usedTokens = contextManager.getTokenCount();
    const tokenSuffix = ` [Tokens: ${usedTokens}/${tokenMax}]`;

    let pause = "";

    if (inputMode.isDebug()) {
      if (pauseSeconds) {
        pause += ` [Paused: ${pauseSeconds}s]`;
      }
      if (wakeOnMessage) {
        pause += " [WakeOnMsg]";
      }
    }

    return `${await getUserHostPathPrompt()}${tokenSuffix}${pause}${promptSuffix} `;
  }

  async function getUserHostPathPrompt() {
    const currentPath = await shellWrapper.getCurrentPath();

    return `${getUserHostPrompt()}${platformConfig.promptDivider}${currentPath}`;
  }

  function getUserHostPrompt() {
    return `${agentConfig().username}@${globalConfig().hostname}`;
  }

  function getInput(commandPrompt: string, pauseSeconds: number) {
    return new Promise<string>((resolve) => {
      const questionController = new AbortController();
      let timeout: NodeJS.Timeout | undefined;
      let notificationInterval: NodeJS.Timeout | undefined;
      let timeoutCancelled = false;
      let unsubscribeWrite: (() => void) | undefined;

      function clearTimers() {
        timeoutCancelled = true;
        if (unsubscribeWrite) {
          unsubscribeWrite();
          unsubscribeWrite = undefined;
        }

        clearTimeout(timeout);
        clearInterval(notificationInterval);
      }

      /** Cancels waiting for user input */
      const cancelWaitingForUserInput = (
        questionAborted: boolean,
        buffer?: string,
      ) => {
        // Don't allow console escape commands like \x1B[1G to cancel the timeout
        if (timeoutCancelled || (buffer && !/^[a-zA-Z0-9 ]+$/.test(buffer))) {
          return;
        }

        clearTimers();

        if (questionAborted) {
          return;
        }
        // Else timeout interrupted by user input

        // Clear out the timeout information from the prompt to prevent the user from thinking the timeout still applies
        let pausePos = commandPrompt.indexOf("[Paused:");
        pausePos =
          pausePos == -1 ? commandPrompt.indexOf("[WakeOnMsg]") : pausePos;

        if (pausePos > 0) {
          // BUG: When the user hits delete, the prompt is reset to the original which is confusing as user will think timeout is still active
          // Fix is probably to reset the entire the question when the timeout is interrupted
          const charsBack = commandPrompt.length - pausePos - 1; // pluse 1 for the space after the #
          readline.moveCursor(process.stdout, -charsBack, 0);
          process.stdout.write("-".repeat(charsBack - 3));
          readline.moveCursor(process.stdout, 3, 0);
        }
      };

      /**
       * Using a shared readline interface singleton to avoid conflicts when multiple agents are running.
       * Only one agent should be active on the console at a time (controlled by output.isWriteEnabled).
       */
      const readlineInterface = output.isConsoleEnabled()
        ? getSharedReadline()
        : undefined;

      if (readlineInterface) {
        readlineInterface.question(
          chalk.greenBright(commandPrompt),
          { signal: questionController.signal },
          (answer) => {
            clearTimers();
            readlineInterface.pause();
            resolve(answer);
          },
        );

        // If user starts typing in prompt, cancel any auto timeouts or wake on msg
        unsubscribeWrite = writeEventManager.onWrite(cancelWaitingForUserInput);
      } else {
        // Agent not in focus - just output to buffer and wait for events
        // Don't actively cycle with timeouts as stdout writes interfere with readline
        output.comment(commandPrompt + "<agent not in focus>");
      }

      function abortQuestion() {
        cancelWaitingForUserInput(true);
        questionController.abort();
        try {
          readlineInterface?.pause();
        } catch {
          // On Windows, the readline interface may already be closed after abort
        }
        resolve("");
      }

      // This pauses the app for a specified time before the next llm call
      // This is how `llmail wait` and `ns-session pause` are implemented
      // It also allows the user to wake the debug prompt on incoming mail or switching the in focus agent
      if (pauseSeconds) {
        timeout = setTimeout(abortQuestion, pauseSeconds * 1000);
      }

      // Poll for prompt notifications that should wake/interrupt
      notificationInterval = setInterval(() => {
        if (promptNotification.hasPending("wake")) {
          abortQuestion();
        }
      }, 250);
    });
  }

  function getCommandConfirmation() {
    return new Promise<string>((resolve) => {
      const prompt = "Allow command to run? [y/n] ";

      if (!output.isConsoleEnabled()) {
        output.comment(prompt + "<denied because console disabled>");
        resolve("n");
        return;
      } else {
        const readlineInterface = getSharedReadline();

        readlineInterface.question(chalk.greenBright(prompt), (answer) => {
          readlineInterface.pause();
          resolve(answer);
        });
      }
    });
  }

  return {
    getPrompt,
    getUserHostPathPrompt,
    getUserHostPrompt,
    getInput,
    getCommandConfirmation,
  };
}

export type PromptBuilder = ReturnType<typeof createPromptBuilder>;
