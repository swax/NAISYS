import chalk from "chalk";
import * as events from "events";
import * as readline from "readline";
import * as llmail from "../apps/llmail.js";
import * as config from "../config.js";
import * as contextManager from "../llm/contextManager.js";
import * as inputMode from "../utils/inputMode.js";
import { InputMode } from "../utils/inputMode.js";
import * as output from "../utils/output.js";
import * as shellWrapper from "./shellWrapper.js";

// When actual output is entered by the user we want to cancel any auto-continue timers and/or wake on message
// We don't want to cancel if the user is entering a chords like ctrl+b then down arrow, when using tmux
// This is why we can't put the event listener on the standard process.stdin/keypress event.
// There is no 'data entered' output event so this monkey patch does that
const _writeEventName = "write";
const _outputEmitter = new events.EventEmitter();
const _originalWrite = process.stdout.write.bind(process.stdout);

process.stdout.write = (...args) => {
  _outputEmitter.emit(_writeEventName);
  return _originalWrite.apply(process.stdout, <any>args);
};

const _readlineInterface = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

export async function getPrompt(pauseSeconds?: number) {
  const promptSuffix = inputMode.current == InputMode.Debug ? "#" : "$";

  const tokenMax = config.tokenMax;
  const usedTokens = contextManager.getTokenCount();
  const tokenSuffix = ` [Tokens: ${usedTokens}/${tokenMax}]`;

  let pause = "";

  if (inputMode.current == InputMode.Debug) {
    if (pauseSeconds) {
      pause += ` [Paused: ${pauseSeconds}s]`;
    }
    if (config.agent.wakeOnMessage) {
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

export function getInput(commandPrompt: string, pauseSeconds?: number) {
  return new Promise<string>((resolve) => {
    const ac = new AbortController();
    let timeout: NodeJS.Timeout;
    let interval: NodeJS.Timeout;

    function cancelTimeouts(expired?: boolean) {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (interval) {
        clearInterval(interval);
      }

      _outputEmitter.off(_writeEventName, cancelTimeouts);

      // If timeout interrupted by user input, clear out the timeout information from the prompt
      // to prevent the user from thinking the timeout still applies
      // BUG: When the user hits delete, the prompt is reset to the original which is confusing as user will think timeout is still active
      // Fix is probably to reset the entire the question when the timeout is interrupted
      if (!expired) {
        let pausePos = commandPrompt.indexOf("[Paused:");
        pausePos = pausePos == -1 ? commandPrompt.indexOf("[WakeOnMsg]") : pausePos;
        
        if (pausePos > 0) {
          const charsBack = commandPrompt.length - pausePos - 1; // pluse 1 for the space after the #
          readline.moveCursor(process.stdout, -charsBack, 0);
          process.stdout.write("-".repeat(charsBack - 3));
          readline.moveCursor(process.stdout, 3, 0);
        }
      }
    }

    _readlineInterface.question(
      chalk.greenBright(commandPrompt),
      { signal: ac.signal  },
      (answer) => {
        resolve(answer);
      },
    );

    // If user starts typing in prompt, cancel any auto timeouts or wake on msg
    _outputEmitter.on(_writeEventName, cancelTimeouts);

    const abortQuestion = () => {
      cancelTimeouts(true);
      ac.abort();
      resolve("");
    };

    if (pauseSeconds) {
      timeout = setTimeout(() => {
        abortQuestion();
      }, pauseSeconds * 1000);
    }

    if (config.agent.wakeOnMessage) {
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
