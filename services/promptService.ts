import { envService } from "./envService.js";
import { sandboxFileSystem } from "./sandboxFileSystemService.js";

class PromptService {
  public getPrompt() {
    const promptSuffix = envService.inputMode == "root" ? "#" : "$";

    return `${this.getPromptPrefix()}:${sandboxFileSystem.getCurrentPath()}${promptSuffix} `;
  }

  public getPromptPrefix() {
    const username =
      envService.inputMode == "root" ? "root" : envService.username;

    return `${username}@${envService.hostname}`;
  }
}

export const promptService = new PromptService();
