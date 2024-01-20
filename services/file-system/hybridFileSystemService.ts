import { consoleService } from "../consoleService.js";
import { contextService } from "../contextService.js";
import { promptService } from "../promptService.js";
import { LongRunningShell } from "./longRunningShell.js";

class HybridFileSystem {
  _shell = new LongRunningShell();
  _initd = false;

  getName() {
    return "Hybrid";
  }

  async getCurrentPath() {
    if (!this._initd) {
      this._initd = true;
      await this._shell.executeCommand("mkdir webserver");
      await this._shell.executeCommand("cd webserver");
      this._initd = true;
    }

    return await this._shell.executeCommand("pwd");
  }

  async handleCommand(line: string, consoleInputLines: string[]) {
    const cmdParams = line.trim().split(" ");

    // Route user to context friendly edit commands that can read/write the entire file in one go
    if (["nano", "vi", "vim"].includes(cmdParams[0])) {
      contextService.append(
        `${cmdParams[0]} not supported. Use 'cat' to view a file and 'cat > filename << EOF' to write a file`
      );

      return {
        commandHandled: true,
        processNextLine: false,
      };
    }

    let allInput = line;
    const promptPrefix = promptService.getPromptPrefix();

    while (consoleInputLines.length) {
      const nextLine = consoleInputLines.shift() || "";
      if (nextLine.startsWith(promptPrefix)) {
        consoleInputLines.unshift(nextLine);
        break;
      } else {
        contextService.append(nextLine, "gpt");
      }

      allInput += "\n" + nextLine;
    }

    const output = await this._shell.executeCommand(allInput);

    if (output) {
      contextService.append(output);
    }

    return {
      commandHandled: true,
      processNextLine: false,
    };
  }
}

export const hybridFileSystem = new HybridFileSystem();
