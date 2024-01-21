import { injectable } from "inversify";
import { get_encoding } from "tiktoken";
import { InputMode } from "../enums.js";
import { ConsoleColor, ConsoleService } from "./consoleService.js";
import { EnvService } from "./envService.js";

@injectable()
export class ContextService {
  private _gpt2encoding = get_encoding("gpt2");

  private _context: string = "";
  get context() {
    return this._context;
  }

  constructor(
    private _consoleService: ConsoleService,
    private _envService: EnvService,
  ) {}

  public append(
    input: string,
    source: "startPrompt" | "endPrompt" | "console" | "gpt" = "console",
  ) {
    if (this._envService.inputMode === InputMode.LLM) {
      this._context += input;

      // End the line except for the start prompt which needs the following input appended to it on the same line
      if (source != "startPrompt") {
        this._context += "\n";
      }

      // Prompts are manually added to the console log
      if (source != "startPrompt" && source != "endPrompt") {
        this._consoleService.output(
          input,
          source == "gpt" ? ConsoleColor.gpt : ConsoleColor.console,
        );
      }
    }
    // Root runs in a shadow mode where their activity is not recorded in the context
    // Mark with a # to make it clear that it is not part of the context
    else if (this._envService.inputMode === InputMode.Debug) {
      this._consoleService.comment(input);
    }
  }

  public clear() {
    this._context = "";
  }

  public getTokenCount() {
    return this._gpt2encoding.encode(this._context).length;
  }
}
