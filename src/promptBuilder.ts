import chalk from "chalk";
import * as readline from "readline";
import * as llmail from "./apps/llmail.js";
import * as config from "./config.js";
import * as contextManager from "./contextManager.js";
import * as inputMode from "./inputMode.js";
import { InputMode } from "./inputMode.js";
import * as output from "./output.js";
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
  if (pauseSeconds && inputMode.current == InputMode.Debug) {
    const value =
      pauseSeconds == config.WAKE_ON_MSG ? "<WakeOnMsg>" : pauseSeconds + "s";
    pause = ` [Paused: ${value}]`;
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

    if (pauseSeconds) {
      if (pauseSeconds == config.WAKE_ON_MSG) {
        pauseSeconds = 2_000_000; // About 20 days, the max allowed by setTimeout()
      }

      const abortQuestion = () => {
        cancelTimeouts();
        ac.abort();
        resolve("");
      };

      timeout = setTimeout(() => {
        abortQuestion();
        output.comment(`Wait expired. Continuing...`);
      }, pauseSeconds * 1000);

      // Break timeout if new message is received
      let firstError = true;

      interval = setInterval(() => {
        llmail
          .getUnreadThreadIds()
          .then((unreadThreadIds) => {
            if (unreadThreadIds.length) {
              abortQuestion();
              output.comment(`Wait broken by new mail notification.`);
            }
          })
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
