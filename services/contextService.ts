import { consoleService } from "./consoleService.js";

class ContextService {
  private _context: string = "";
  get context() {
    return this._context;
  }

  public append(
    input: string,
    prompt: "startPrompt" | "endPrompt" | undefined = undefined
  ) {
    this._context += input;

    if (prompt != "startPrompt") {
      this._context += "\n";
    }

    if (!prompt) {
      consoleService.output(input);
    }
  }
}

export const contextService = new ContextService();
