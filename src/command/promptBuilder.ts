import chalk from "chalk";
import * as readline from "readline";
import * as llmail from "../apps/llmail.js";
import * as config from "../config.js";
import * as contextManager from "../llm/contextManager.js";
import * as inputMode from "../utils/inputMode.js";
import { InputMode } from "../utils/inputMode.js";
import * as output from "../utils/output.js";
import * as shellWrapper from "./shellWrapper.js";

readline.emitKeypressEvents(process.stdin);

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

    function cancelTimeouts() {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (interval) {
        clearInterval(interval);
      }

      process.stdin.off("keypress", cancelTimeouts);
    }

    // If user starts typing in prompt, cancel any auto timeouts or wake on msg
    process.stdin.on("keypress", cancelTimeouts);

    _readlineInterface.question(
      chalk.greenBright(commandPrompt),
      { signal: ac.signal },
      (answer) => {
        cancelTimeouts();
        resolve(answer);
      },
    );

    const abortQuestion = () => {
      cancelTimeouts();
      ac.abort();
      resolve("");
    };

    if (pauseSeconds) {
      timeout = setTimeout(() => {
        abortQuestion();
        output.comment(`Wait expired. Continuing...`);
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
              output.comment(`Wait broken by new mail notification.`);
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