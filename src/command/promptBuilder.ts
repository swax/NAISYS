import chalk from "chalk";
import * as events from "events";
import * as readline from "readline";
import * as config from "../config.js";
import * as llmail from "../features/llmail.js";
import * as contextManager from "../llm/contextManager.js";
import * as inputMode from "../utils/inputMode.js";
import { InputMode } from "../utils/inputMode.js";
import * as output from "../utils/output.js";
import * as shellWrapper from "./shellWrapper.js";

/**
 * When actual output is entered by the user we want to cancel any auto-continue timers and/or wake on message
 * We don't want to cancel if the user is entering a chords like ctrl+b then down arrow, when using tmux
 * This is why we can't put the event listener on the standard process.stdin/keypress event.
 * There is no 'data entered' output event so this monkey patch does that
 */
const _writeEventEmitter = new events.EventEmitter();
const _writeEventName = "write";
const _originalWrite = process.stdout.write.bind(process.stdout);

process.stdout.write = (...args) => {
  _writeEventEmitter.emit(_writeEventName, false, ...args);
  return _originalWrite.apply(process.stdout, <any>args);
};

/**
 * Tried to make this local and have it cleaned up with close() after using it, but
 * due to the terminal settings below there are bugs with both terminal true and false
 * pause() actually is nice in that it queues up the input, and doesn't allow the user
 * to enter anything while the LLM is working
 */
const readlineInterface = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  // With this set to ture, after an abort the second input will not be processed, see:
  // https://gist.github.com/swax/964a2488494048c8e03d05493d9370f8
  // With this set to false, the stdout.write event above will not be triggered
  terminal: true,
});

readlineInterface.pause();

export async function getPrompt(pauseSeconds: number, wakeOnMessage: boolean) {
  const promptSuffix = inputMode.current == InputMode.Debug ? "#" : "$";

  const tokenMax = config.agent.tokenMax;
  const usedTokens = contextManager.getTokenCount();
  const tokenSuffix = ` [Tokens: ${usedTokens}/${tokenMax}]`;

  let pause = "";

  if (inputMode.current == InputMode.Debug) {
    if (pauseSeconds) {
      pause += ` [Paused: ${pauseSeconds}s]`;
    }
    if (wakeOnMessage) {
      pause += " [WakeOnMsg]";
    }
  }

  return `${await getUserHostPathPrompt()}${tokenSuffix}${pause}${promptSuffix} `;
}

export async function getUserHostPathPrompt() {
  const currentPath = await shellWrapper.getCurrentPath();

  return `${getUserHostPrompt()}:${currentPath}`;
}

export function getUserHostPrompt() {
  const username =
    inputMode.current == InputMode.Debug ? "debug" : config.agent.username;

  return `${username}@${config.hostname}`;
}

export function getInput(
  commandPrompt: string,
  pauseSeconds: number,
  wakeOnMessage: boolean,
) {
  return new Promise<string>((resolve) => {
    const questionController = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    let interval: NodeJS.Timeout | undefined;
    let timeoutCancelled = false;

    function clearTimers() {
      timeoutCancelled = true;
      _writeEventEmitter.off(_writeEventName, cancelWaitingForUserInput);

      clearTimeout(timeout);
      clearInterval(interval);
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
    _writeEventEmitter.on(_writeEventName, cancelWaitingForUserInput);

    function abortQuestion() {
      cancelWaitingForUserInput(true);
      questionController.abort();
      readlineInterface.pause();
      resolve("");
    }

    if (pauseSeconds) {
      timeout = setTimeout(abortQuestion, pauseSeconds * 1000);
    }

    if (wakeOnMessage) {
      // Break timeout if new message is received
      let firstError = true;

      interval = setInterval(() => {
        // setInterval does not support async/await, but that's okay as this call easily runs within the 3s interval
        llmail
          .getUnreadThreads()
          .then((unreadThreadIds) => {
            if (unreadThreadIds.length) {
              abortQuestion();
            }
          })
          // Catch and log errors, but don't break the interval on hopefully an intermittent error
          .catch((e) => {
            if (firstError) {
              output.error(`Mail interval check error: ${e}`);
              firstError = false;
            }
          });
      }, 3000);
    }
  });
}

export function getCommandConfirmation() {
  return new Promise<string>((resolve) => {
    readlineInterface.question(
      chalk.greenBright("Allow command to run? [y/n] "),
      (answer) => {
        readlineInterface.pause();
        resolve(answer);
      },
    );
  });
}
