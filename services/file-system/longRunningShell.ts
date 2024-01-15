import { ChildProcessWithoutNullStreams, exec, spawn } from "child_process";
import { consoleService } from "../consoleService.js";

export class LongRunningShell {
  shell: ChildProcessWithoutNullStreams;
  output = "";
  resolveCurrentCommand?: (value: string) => void;
  commandDelimiter = "__COMMAND_END_X7YUTT__";

  constructor() {
    this.shell = spawn("wsl", [], { stdio: "pipe" });

    this.shell.stdout.on("data", (data) => {
      this.processOutput(data.toString(), "stdout");
    });

    this.shell.stderr.on("data", (data) => {
      this.processOutput(data.toString(), "stderr");
    });
  }

  processOutput(dataStr: string, eventType: "stdout" | "stderr") {
    if (!this.resolveCurrentCommand) {
      consoleService.comment(eventType + " without handler: " + dataStr);
      return;
    }

    if (eventType === "stderr") {
      this.output += "stderr: ";
    }

    this.output += dataStr;

    if (dataStr.includes(this.commandDelimiter)) {
      this.output = this.output.replace(this.commandDelimiter, "");
      this.resolveCurrentCommand(this.output.trim());
      this.output = "";
    }
  }

  executeCommand(command: string) {
    return new Promise<string>((resolve) => {
      this.resolveCurrentCommand = resolve;
      this.shell.stdin.write(`${command}\necho "${this.commandDelimiter}"\n`);
    });
  }
}
