import { injectable } from "inversify";
import { ContextService } from "./contextService.js";
import { PromptService } from "./promptService.js";
import { ShellService } from "./shellService.js";

@injectable()
export class ShellCommandService {
  constructor(
    private _contextService: ContextService,
    private _promptService: PromptService,
    private _shellService: ShellService,
  ) {}

  async handleCommand(line: string, consoleInputLines: string[]) {
    await this._shellService.ensureOpen();

    const cmdParams = line.trim().split(" ");

    // Route user to context friendly edit commands that can read/write the entire file in one go
    if (["nano", "vi", "vim"].includes(cmdParams[0])) {
      this._contextService.append(
        `${cmdParams[0]} not supported. Use 'cat' to view a file and 'cat > filename << EOF' to write a file`,
      );

      return {
        commandHandled: true,
        processNextLine: false,
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
