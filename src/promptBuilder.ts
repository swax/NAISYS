import * as config from "./config.js";
import * as contextManager from "./contextManager.js";
import * as inputMode from "./inputMode.js";
import { InputMode } from "./inputMode.js";
import * as shellWrapper from "./shellWrapper.js";

export async function getPrompt() {
  const promptSuffix = inputMode.current == InputMode.Debug ? "#" : "$";
  const currentPath = await shellWrapper.getCurrentPath();

  let tokenSuffix = "";
  if (inputMode.current == InputMode.LLM) {
    const tokenMax = config.tokenMax;
    const usedTokens = contextManager.getTokenCount();
    tokenSuffix = ` [Tokens: ${usedTokens}/${tokenMax}]`;
  }

  return `${getPromptPrefix()}:${currentPath}${tokenSuffix}${promptSuffix} `;
}

export function getPromptPrefix() {
  const username =
    inputMode.current == InputMode.Debug ? "debug" : config.username;

  return `${username}@${config.hostname}`;
}
