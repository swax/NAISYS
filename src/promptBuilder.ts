import * as config from "./config.js";
import * as contextManager from "./contextManager.js";
import * as inputMode from "./inputMode.js";
import { InputMode } from "./inputMode.js";
import * as shellWrapper from "./shellWrapper.js";

export async function getPrompt() {
  const promptSuffix = inputMode.current == InputMode.Debug ? "#" : "$";

  const tokenMax = config.tokenMax;
  const usedTokens = contextManager.getTokenCount();
  const tokenSuffix = ` [Tokens: ${usedTokens}/${tokenMax}]`;

  return `${await getUserHostPathPrompt()}${tokenSuffix}${promptSuffix} `;
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
