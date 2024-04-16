import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as config from "../config.js";
import * as output from "../utils/output.js";
import { NaisysPath } from "../utils/pathService.js";

enum ShellEvent {
  Ouptput = "stdout",
  Error = "stderr",
  Exit = "exit",
}

let _process: ChildProcessWithoutNullStreams | undefined;
let _currentProcessId: number | undefined;
let _commandOutput = "";
let _currentPath: string | undefined;

let _resolveCurrentCommand: ((value: string) => void) | undefined;
let _currentCommandTimeout: NodeJS.Timeout | undefined;
let _startTime: Date | undefined;

/** How we know the command has completed when running the command inside a shell like bash or wsl */
const _commandDelimiter = "__COMMAND_END_X7YUTT__";

async function ensureOpen() {
  if (_process) {
    return;
  }

  resetCommand();

  const spawnProcess = os.platform() === "win32" ? "wsl" : "bash";

  _process = spawn(spawnProcess, [], { stdio: "pipe" });

  const pid = _process.pid;

  if (!pid) {
    throw "Shell process failed to start";
  }

  _currentProcessId = pid;

  _process.stdout.on("data", (data) => {
    processOutput(data.toString(), ShellEvent.Ouptput, pid);
  });

  _process.stderr.on("data", (data) => {
    processOutput(data.toString(), ShellEvent.Error, pid);
  });

  _process.on("close", (code) => {
    processOutput(`${code}`, ShellEvent.Exit, pid);
  });

  // Init users home dir on first run, on shell crash/rerun go back to the current path
  if (!_currentPath) {
    output.comment("NEW SHELL OPENED. PID: " + pid);

    errorIfNotEmpty(
      await executeCommand(
        `mkdir -p ${config.naisysFolder}/home/` + config.agent.username,
      ),
    );
    errorIfNotEmpty(
      await executeCommand(
        `cd ${config.naisysFolder}/home/` + config.agent.username,
      ),
    );
  } else {
    output.comment("SHELL RESTORED. PID: " + pid);

    errorIfNotEmpty(await executeCommand("cd " + _currentPath));
  }

  // Stop running commands if one fails
  // Often the LLM will give us back all kinds of invalid commands, we want to break on the first one
  // Unfortunately this also causes the shell to exit on failures, so we need to handle that
  //commentIfNotEmpty(await executeCommand("set -e"));
}

/** Basically don't show anything in the console unless there is an error */
function errorIfNotEmpty(response: string) {
  if (response) {
    output.error(response);
  }
}

function processOutput(dataStr: string, eventType: ShellEvent, pid: number) {
  if (pid != _currentProcessId) {
    output.comment(
      `Ignoring '${eventType}' from old shell process ${pid}: ` + dataStr,
    );
    return;
  }

  if (!_resolveCurrentCommand) {
    output.comment(
      `Ignoring '${eventType}' from process ${pid} with no resolve handler: ` +
        dataStr,
    );
    return;
  }

  if (eventType === ShellEvent.Exit) {
    output.error("SHELL EXITED. PID: " + _process?.pid + " CODE: " + dataStr);

    const elapsedSeconds = _startTime
      ? Math.round((new Date().getTime() - _startTime.getTime()) / 1000)
      : -1;

    const outputWithError =
      _commandOutput.trim() +
      `\nNAISYS: Command hit time out limit after ${elapsedSeconds} seconds. If possible figure out how to run the command faster or break it up into smaller parts.`;

    resetProcess();

    _resolveCurrentCommand(outputWithError);
    return;
  } else {
    // Extend the timeout of the current command
    setOrExtendShellTimeout();

    _commandOutput += dataStr;
  }

  const delimiterIndex = _commandOutput.indexOf(_commandDelimiter);
  if (delimiterIndex != -1) {
    // trim everything after delimiter
    _commandOutput = _commandOutput.slice(0, delimiterIndex);

    const response = _commandOutput.trim();

    resetCommand();
    _resolveCurrentCommand(response);
  }
}

export async function executeCommand(command: string) {
  await ensureOpen();

  if (_currentPath && command.trim().split("\n").length > 1) {
    command = await putMultilineCommandInAScript(command);
  }

  return new Promise<string>((resolve, reject) => {
    _resolveCurrentCommand = resolve;

    const commandWithDelimiter = `${command.trim()}\necho "${_commandDelimiter} LINE:\${LINENO}"\n`;

    if (!_process) {
      reject("Shell process is not open");
      return;
    }

    _process.stdin.write(commandWithDelimiter);

    _startTime = new Date();

    // If no response, kill and reset the shell, often hanging on some unescaped input
    setOrExtendShellTimeout();
  });
}

function setOrExtendShellTimeout() {
  // Don't extend if we've been waiting longer than the max timeout seconds
  const timeWaiting = new Date().getTime() - (_startTime?.getTime() || 0);

  if (
    !_process?.pid ||
    timeWaiting > config.shellCommand.maxTimeoutSeconds * 1000
  ) {
    return;
  }

  // Define the pid for use in the timeout closure, as _process.pid may change
  const pid = _process.pid;

  clearTimeout(_currentCommandTimeout);

  _currentCommandTimeout = setTimeout(() => {
    resetShell(pid);
  }, config.shellCommand.timeoutSeconds * 1000);
}

function resetShell(pid: number) {
  if (!_process || _process.pid != pid) {
    output.comment("Ignoring timeout for old shell process " + pid);
    return;
  }

  // There is still an issue here when running on linux where if a command like 'ping' is running
  // then kill() won't actually kill the 'bash' process hosting the ping, it will just hang here indefinitely
  // A not fail proof workaround is to tell the LLM to prefix long running commands with 'timeout 10s' or similar
  const killResponse = _process.kill();

  output.error(
    `KILL SIGNAL SENT TO PID: ${_process.pid}, RESPONSE: ${killResponse ? "SUCCESS" : "FAILED"}`,
  );

  // Should trigger the process close event from here
}

export async function getCurrentPath() {
  await ensureOpen();

  _currentPath = await executeCommand("pwd");

  return _currentPath;
}

export async function terminate() {
  /*const exitCode = */ await executeCommand("exit");

  // For some reason showing the exit code clears the console
  resetProcess();
}

function resetCommand() {
  _commandOutput = "";
  _startTime = undefined;

  clearTimeout(_currentCommandTimeout);
}

function resetProcess() {
  resetCommand();
  _process?.removeAllListeners();
  _process = undefined;
}

/** Wraps multi line commands in a script to make it easier to diagnose the source of errors based on line number
 * May also help with common escaping errors */
function putMultilineCommandInAScript(command: string) {
  const scriptPath = new NaisysPath(
    `${config.naisysFolder}/home/${config.agent.username}/.command.tmp.sh`,
  );

  // set -e causes the script to exit on the first error
  const scriptContent = `#!/bin/bash
set -e
cd ${_currentPath}
${command.trim()}`;

  // create/write file
  fs.writeFileSync(scriptPath.toHostPath(), scriptContent);

  // `Path` is set to the ./bin folder because custom NAISYS commands that follow shell commands will be handled by the shell, which will fail
  // so we need to remind the LLM that 'naisys commands cannot be used with other commands on the same prompt'
  // `source` will run the script in the current shell, so any change directories in the script will persist in the current shell
  return `PATH=${config.binPath}:$PATH source ${scriptPath.getNaisysPath()}`;
}
