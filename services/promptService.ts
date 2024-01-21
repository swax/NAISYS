import { InputMode } from "../enums.js";
import { contextService } from "./contextService.js";
import { envService } from "./envService.js";
import { realShellService } from "./real-shell/realShellService.js";

class PromptService {
  public async getPrompt() {
    const promptSuffix = envService.inputMode == InputMode.Debug ? "#" : "$";
    const currentPath = await realShellService.getCurrentPath();

    let tokenSuffix = "";
    if (envService.inputMode == InputMode.LLM) {
      const tokenMax = envService.tokenMax;
      const usedTokens = contextService.getTokenCount();
      tokenSuffix = ` [Tokens: ${usedTokens}/${tokenMax}]`;
    }

    return `${this.getPromptPrefix()}:${currentPath}${tokenSuffix}${promptSuffix} `;
  }

  public getPromptPrefix() {
    const username =
      envService.inputMode == InputMode.Debug ? "debug" : envService.username;

    return `${username}@${envService.hostname}`;
  }
}

export const promptService = new PromptService();
