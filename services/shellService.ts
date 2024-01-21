import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as consoleService from "./consoleService.js";
import * as envService from "./envService.js";

let _shellProcess: ChildProcessWithoutNullStreams | undefined;
let _output = "";
let _resolveCurrentCommand: ((value: string) => void) | undefined;
const _commandDelimiter = "__COMMAND_END_X7YUTT__";

async function _ensureOpen() {
  if (_shellProcess) {
    return;
  }

  _shellProcess = spawn("wsl", [], { stdio: "pipe" });

  _shellProcess.stdout.on("data", (data) => {
    processOutput(data.toString(), "stdout");
  });

  _shellProcess.stderr.on("data", (data) => {
    processOutput(data.toString(), "stderr");
  });

  _shellProcess.on("close", (code) => {
    processOutput(`${code}`, "exit");
    _shellProcess = undefined;
  });

  consoleService.commentIfNotEmpty(
    await executeCommand("mkdir -p /mnt/c/naisys/home/" + envService.username),
  );
  consoleService.commentIfNotEmpty(
    await executeCommand("cd /mnt/c/naisys/home/" + envService.username),
  );
}

export function processOutput(
  dataStr: string,
  eventType: "stdout" | "stderr" | "exit",
) {
  if (!_resolveCurrentCommand) {
    consoleService.comment(eventType + " without handler: " + dataStr);
    return;
  }

  /*if (eventType === "stderr") {
      output += "stderr: ";
    }*/

  _output += dataStr;

  if (dataStr.includes(_commandDelimiter) || eventType === "exit") {
    _output = _output.replace(_commandDelimiter, "");
    _resolveCurrentCommand(_output.trim());
    _output = "";
  }
}

export async function executeCommand(command: string) {
  await _ensureOpen();

  return new Promise<string>((resolve) => {
    _resolveCurrentCommand = resolve;
    _shellProcess?.stdin.write(`${command}\necho "${_commandDelimiter}"\n`);
  });
}

export async function getCurrentPath() {
  await _ensureOpen();

  return await executeCommand("pwd");
}

export async function terminate() {
  /*const exitCode = */ await executeCommand("exit");

  // For some reason showing the exit code clears the console
}
