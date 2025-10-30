import chalk from "chalk";
import * as readline from "readline";
import { createConfig } from "../config.js";
import { createLLMail } from "../features/llmail.js";
import { createSubagentService } from "../features/subagent.js";
import { createContextManager } from "../llm/contextManager.js";
import { createInputMode } from "../utils/inputMode.js";
import { createOutputService } from "../utils/output.js";
import { sharedReadline } from "../utils/sharedReadline.js";
import { writeEventManager } from "../utils/writeEventManager.js";
import { createShellWrapper } from "./shellWrapper.js";

export function createPromptBuilder(
  config: Awaited<ReturnType<typeof createConfig>>,
  shellWrapper: ReturnType<typeof createShellWrapper>,
  subagent: ReturnType<typeof createSubagentService>,
  llmail: ReturnType<typeof createLLMail>,
  contextManager: ReturnType<typeof createContextManager>,
  output: ReturnType<typeof createOutputService>,
  inputMode: ReturnType<typeof createInputMode>,
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
    const promptSuffix = inputMode.isDebug() ? "#" : "$";

    const tokenMax = config.agent.tokenMax;
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

    return `${getUserHostPrompt()}:${currentPath}`;
  }

  function getUserHostPrompt() {
    const username = inputMode.isDebug() ? "debug" : config.agent.username;

    return `${username}@${config.hostname}`;
  }

  function getInput(
    commandPrompt: string,
    pauseSeconds: number,
    wakeOnMessage: boolean,
  ) {
    return new Promise<string>((resolve) => {
      const questionController = new AbortController();
      let timeout: NodeJS.Timeout | undefined;
      let mailInterval: NodeJS.Timeout | undefined;
      let subagentInterval: NodeJS.Timeout | undefined;
      let timeoutCancelled = false;
      let unsubscribeWrite: (() => void) | undefined;

      function clearTimers() {
        timeoutCancelled = true;
        if (unsubscribeWrite) {
          unsubscribeWrite();
          unsubscribeWrite = undefined;
        }

        clearTimeout(timeout);
        clearInterval(mailInterval);
        clearInterval(subagentInterval);
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
        ? sharedReadline
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
        output.comment(commandPrompt + "<agent not in focus>");
      }

      function abortQuestion() {
        cancelWaitingForUserInput(true);
        questionController.abort();
        readlineInterface?.pause();
        resolve("");
      }

      if (pauseSeconds) {
        timeout = setTimeout(abortQuestion, pauseSeconds * 1000);
      }

      if (wakeOnMessage) {
        mailInterval = setInterval(() => {
          // setInterval does not support async/await, but that's okay as this call easily runs within the 3s interval
          llmail.getUnreadThreads().then((unreadThreadIds) => {
            if (unreadThreadIds.length) {
              abortQuestion();
            }
          });
        }, 5000);

        subagentInterval = setInterval(() => {
          // Check for terminated subagents
          const terminationEvents = subagent.getTerminationEvents();
          if (terminationEvents.length) {
            abortQuestion();
          }

          // If the active agent has been switched, abort input
          if (subagent.switchEventTriggered()) {
            abortQuestion();
          }
        }, 500);
      }
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
        const readlineInterface = sharedReadline;

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
