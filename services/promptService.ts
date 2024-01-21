import { injectable } from "inversify";
import { ContextService } from "./contextService.js";
import { EnvService } from "./envService.js";
import { InputMode, InputModeService } from "./inputModeService.js";
import { ShellService } from "./shellService.js";

@injectable()
export class PromptService {
  constructor(
    private _contextService: ContextService,
    private _envService: EnvService,
    private _inputModeService: InputModeService,
    private _shellService: ShellService,
  ) {}

  public async getPrompt() {
    const promptSuffix =
      this._inputModeService.current == InputMode.Debug ? "#" : "$";
    const currentPath = await this._shellService.getCurrentPath();

    let tokenSuffix = "";
    if (this._inputModeService.current == InputMode.LLM) {
      const tokenMax = this._envService.tokenMax;
      const usedTokens = this._contextService.getTokenCount();
      tokenSuffix = ` [Tokens: ${usedTokens}/${tokenMax}]`;
    }

    return `${this.getPromptPrefix()}:${currentPath}${tokenSuffix}${promptSuffix} `;
  }

  public getPromptPrefix() {
    const username =
      this._inputModeService.current == InputMode.Debug
        ? "debug"
        : this._envService.username;

    return `${username}@${this._envService.hostname}`;
  }
}
