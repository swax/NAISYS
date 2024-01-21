import { injectable } from "inversify";
import { ContextService } from "./contextService.js";
import { InputMode, InputModeService } from "./inputModeService.js";
import { PromptService } from "./promptService.js";
import { ShellService } from "./shellService.js";

interface HandleShellCommandResponse {
  commandHandled: boolean;
  processNextLine?: boolean;
  terminate?: boolean;
}

@injectable()
export class ShellCommandService {
  constructor(
    private _contextService: ContextService,
    private _inputModeService: InputModeService,
    private _promptService: PromptService,
    private _shellService: ShellService,
  ) {}

  async handleCommand(
    line: string,
    consoleInputLines: string[],
  ): Promise<HandleShellCommandResponse> {
    const cmdParams = line.trim().split(" ");

    // Route user to context friendly edit commands that can read/write the entire file in one go
    if (["nano", "vi", "vim"].includes(cmdParams[0])) {
      this._contextService.append(
        `${cmdParams[0]} not supported. Use 'cat' to view a file and 'cat > filename << EOF' to write a file`,
      );

      return {
        commandHandled: true,
      };
    }

    if (cmdParams[0] == "exit") {
      let terminate = false;

      if (this._inputModeService.current == InputMode.LLM) {
        this._contextService.append(
          "Use 'endsession' to end the session and clear the console log.",
        );
      } else if (this._inputModeService.current == InputMode.Debug) {
        await this._shellService.terminate();
        terminate = true;
      }

      return {
        commandHandled: true,
        terminate,
      };
    }

    let allInput = line;
    const promptPrefix = this._promptService.getPromptPrefix();

    while (consoleInputLines.length) {
      const nextLine = consoleInputLines.shift() || "";
      if (nextLine.startsWith(promptPrefix)) {
        consoleInputLines.unshift(nextLine);
        break;
      } else {
        this._contextService.append(nextLine, "gpt");
      }

      allInput += "\n" + nextLine;
    }

    const output = await this._shellService.executeCommand(allInput);

    if (output) {
      this._contextService.append(output);
    }

    return {
      commandHandled: true,
      processNextLine: false,
    };
  }
}
