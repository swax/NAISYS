import { envService } from "./envService.js";
import { inMemoryFileSystem } from "./inMemoryFileSystemService.js";

class PromptService {
  public getPrompt() {
    const promptSuffix = envService.inputMode == "root" ? "#" : "$";

    return `${this.getPromptPrefix()}:${inMemoryFileSystem.getCurrentPath()}${promptSuffix} `;
  }

  public getPromptPrefix() {
    const username =
      envService.inputMode == "root" ? "root" : envService.username;

    return `${username}@${envService.hostname}`;
  }
}

export const promptService = new PromptService();
