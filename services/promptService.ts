import { envService } from "./envService.js";
import { fileSystemService } from "./file-system/fileSystemService.js";

class PromptService {
  public async getPrompt() {
    const promptSuffix = envService.inputMode == "root" ? "#" : "$";

    const currentPath = await fileSystemService.getCurrentPath();

    return `${this.getPromptPrefix()}:${currentPath}${promptSuffix} `;
  }

  public getPromptPrefix() {
    const username =
      envService.inputMode == "root" ? "root" : envService.username;

    return `${username}@${envService.hostname}`;
  }
}

export const promptService = new PromptService();
