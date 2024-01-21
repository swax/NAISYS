import * as contextService from "./contextService.js";
import * as envService from "./envService.js";
import * as inputModeService from "./inputModeService.js";
import { InputMode } from "./inputModeService.js";
import * as shellService from "./shellService.js";

export async function getPrompt() {
  const promptSuffix = inputModeService.current == InputMode.Debug ? "#" : "$";
  const currentPath = await shellService.getCurrentPath();

  let tokenSuffix = "";
  if (inputModeService.current == InputMode.LLM) {
    const tokenMax = envService.tokenMax;
    const usedTokens = contextService.getTokenCount();
    tokenSuffix = ` [Tokens: ${usedTokens}/${tokenMax}]`;
  }

  return `${getPromptPrefix()}:${currentPath}${tokenSuffix}${promptSuffix} `;
}

export function getPromptPrefix() {
  const username =
    inputModeService.current == InputMode.Debug ? "debug" : envService.username;

  return `${username}@${envService.hostname}`;
}
