import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { injectable } from "inversify";
import { ConsoleService } from "./consoleService.js";
import { EnvService } from "./envService.js";

@injectable()
export class ShellService {
  private _shellProcess?: ChildProcessWithoutNullStreams;
  private _output = "";
  private _resolveCurrentCommand?: (value: string) => void;
  private _commandDelimiter = "__COMMAND_END_X7YUTT__";

  constructor(
    private _consoleService: ConsoleService,
    private _envService: EnvService,
  ) {}

  async ensureOpen() {
    if (this._shellProcess) {
      return;
    }

    this._shellProcess = spawn("wsl", [], { stdio: "pipe" });

    this._shellProcess.stdout.on("data", (data) => {
      this.processOutput(data.toString(), "stdout");
    });

    this._shellProcess.stderr.on("data", (data) => {
      this.processOutput(data.toString(), "stderr");
    });

    this._shellProcess.on("close", (code) => {
      this.processOutput(`${code}`, "exit");
      this._shellProcess = undefined;
    });

    this._consoleService.commentIfNotEmpty(
      await this.executeCommand(
        "mkdir -p /mnt/c/naisys/home/" + this._envService.username,
      ),
    );
    this._consoleService.commentIfNotEmpty(
      await this.executeCommand(
        "cd /mnt/c/naisys/home/" + this._envService.username,
      ),
    );
  }

  processOutput(dataStr: string, eventType: "stdout" | "stderr" | "exit") {
    if (!this._resolveCurrentCommand) {
      this._consoleService.comment(eventType + " without handler: " + dataStr);
      return;
    }

    /*if (eventType === "stderr") {
      this.output += "stderr: ";
    }*/

    this._output += dataStr;

    if (dataStr.includes(this._commandDelimiter) || eventType === "exit") {
      this._output = this._output.replace(this._commandDelimiter, "");
      this._resolveCurrentCommand(this._output.trim());
      this._output = "";
    }
  }

  async executeCommand(command: string) {
    await this.ensureOpen();

    return new Promise<string>((resolve) => {
      this._resolveCurrentCommand = resolve;
      this._shellProcess?.stdin.write(
        `${command}\necho "${this._commandDelimiter}"\n`,
      );
    });
  }

  async getCurrentPath() {
    await this.ensureOpen();

    return await this.executeCommand("pwd");
  }

  async terminate() {
    /*const exitCode = */ await this.executeCommand("exit");

    // For some reason showing the exit code clears the console
  }
}
