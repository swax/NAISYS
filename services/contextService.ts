import { consoleService } from "./consoleService.js";
import { envService } from "./envService.js";

class ContextService {
  private _context: string = "";
  get context() {
    return this._context;
  }

  public append(
    input: string,
    prompt: "startPrompt" | "endPrompt" | undefined = undefined
  ) {
    if (envService.inputMode === "gpt") {
      this._context += input;

      // End the line except for the start prompt which needs the following input appended to it on the same line
      if (prompt != "startPrompt") {
        this._context += "\n";
      }

      // Prompts are manually added to the console log
      if (!prompt) {
        consoleService.output(input);
      }
    } 
    // Root runs in a shadow mode where their activity is not recorded in the context
    // Mark with a # to make it clear that it is not part of the context
    else if (envService.inputMode === "root") {
      consoleService.comment(input);
    }
  }

  public clear() {
    this._context = "";
  }
}

export const contextService = new ContextService();
