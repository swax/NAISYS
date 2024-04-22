import xterm from "@xterm/headless";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import stripAnsi from "strip-ansi";
import * as config from "../config.js";
import * as output from "../utils/output.js";
import * as pathService from "../utils/pathService.js";
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

let _terminal: xterm.Terminal | undefined;
let _bufferChangeEvent: xterm.IDisposable | undefined;
let _currentBufferType: "normal" | "alternate" = "normal";

let _resolveCurrentCommand: ((value: string) => void) | undefined;
let _currentCommandTimeout: NodeJS.Timeout | undefined;

/** How we know the command has completed when running the command inside a shell like bash or wsl */
const _commandDelimiter = "__COMMAND_END_X7YUTT__";

let _wrapperSuspended = false;

const _queuedOutput: {
  rawDataStr: Buffer;
  eventType: ShellEvent;
  pid: number;
}[] = [];

async function ensureOpen() {
  if (_process) {
    return;
  }

  resetCommand();

  const spawnCmd = os.platform() === "win32" ? "wsl" : "bash";

  _process = spawn(spawnCmd, [], { stdio: "pipe" });

  const pid = _process.pid;

  if (!pid) {
    throw "Shell process failed to start";
  }

  _currentProcessId = pid;

  _process.stdout.on("data", (data: Buffer) => {
    processOutput(data, ShellEvent.Ouptput, pid);
  });

  _process.stderr.on("data", (data: Buffer) => {
    processOutput(data, ShellEvent.Error, pid);
  });

  _process.on("close", (code) => {
    processOutput(Buffer.from(`${code}`), ShellEvent.Exit, pid);
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

function processOutput(rawDataStr: Buffer, eventType: ShellEvent, pid: number) {
  if (_wrapperSuspended) {
    _queuedOutput.push({ rawDataStr, eventType, pid });
    return;
  }

  let dataStr = stripAnsi(rawDataStr.toString());

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
    output.error("SHELL EXIT. PID: " + _process?.pid + " CODE: " + dataStr);

    let finalOutput =
      _currentBufferType == "alternate"
        ? _getTerminalActiveBuffer()
        : _commandOutput.trim();

    finalOutput += `\nNAISYS: Command killed.`;

    resetProcess();

    _completeCommand(finalOutput);
    return;
  }

  // Should only happen back in normal mode, so we don't need to modify the rawDataStr
  const endDelimiterPos = dataStr.indexOf(_commandDelimiter);
  if (endDelimiterPos != -1) {
    dataStr = dataStr.slice(0, endDelimiterPos);
  }

  if (_currentBufferType == "normal") {
    _commandOutput += dataStr;
  }

  // get token size of buffer, if too big, switch it front/middle/back

  // use function for endDelimiter, only use callback in alternate mode, test that this hopefully fixes 'yes'

  _terminal?.write(rawDataStr); // Not syncronous, second param takes a call back, don't need to wait for it AFAIK

  if (endDelimiterPos != -1) {
    // AFAIK this shoudln't happen, but if it does log it so I can figure out why/how and what to do about it
    if (_currentBufferType == "alternate") {
      output.error("UNEXPECTED END DELIMITER IN ALTERNATE BUFFER: " + dataStr);
    }

    const finalOutput = _commandOutput.trim();

    resetCommand();

    _completeCommand(finalOutput);
  }
}

export async function executeCommand(command: string) {
  if (_wrapperSuspended) {
    throw "Use continueCommand to send input to a shell command in process";
  }

  command = command.trim();

  await ensureOpen();

  if (_currentPath && command.split("\n").length > 1) {
    command = await putMultilineCommandInAScript(command);
  }

  return new Promise<string>((resolve, reject) => {
    _resolveCurrentCommand = resolve;

    if (!_process) {
      reject("Shell process is not open");
      return;
    }

    const commandWithDelimiter = `${command}\necho "${_commandDelimiter}"\n`;
    _process.stdin.write(commandWithDelimiter);

    // Set timeout to wait for response from command
    setCommandTimeout();
  });
}

/** The LLM made its decision on how it wants to continue with the shell that previously timed out */
export function continueCommand(command: string) {
  if (!_wrapperSuspended) {
    throw "Shell is not suspended, use execute command";
  }

  command = command.trim();

  _wrapperSuspended = false;

  let choice: "wait" | "kill" | "input";

  if (command != "wait" && command != "kill") {
    choice = "input";
  } else {
    choice = command;
  }

  return new Promise<string>((resolve, reject) => {
    _resolveCurrentCommand = resolve;

    // If new output from the shell was queued while waiting for the LLM to decide what to do
    if (_queuedOutput.length > 0) {
      for (const output of _queuedOutput) {
        processOutput(output.rawDataStr, output.eventType, output.pid);
      }
      _queuedOutput.length = 0;

      // If processing queue resolved the command, then we're done
      if (!_resolveCurrentCommand) {
        return;
      }

      // Used to return here if LLM was sending if output was generated while waiting for the LLM
      // In normal mode this would make the log confusing and out of order
      // But since we only use the terminal in alternate mode, this is fine and works
      // with commands like `mtr` changing the display type
    }

    // LLM wants to wait for more output
    if (choice == "wait") {
      setCommandTimeout();
      return;
    }
    // Else LLM wants to kill the process
    else if (choice == "kill") {
      if (!_currentProcessId) {
        reject("No process to kill");
      } else if (resetShell(_currentProcessId)) {
        return; // Wait for exit event
      } else {
        reject("Unable to kill. Process not found");
      }

      return;
    }
    // Else LLM wants to send input to the process
    else {
      if (!_process) {
        reject("Shell process is not open");
        return;
      }

      _process.stdin.write(command + "\n");
      setCommandTimeout();
    }
  });
}

function setCommandTimeout() {
  _currentCommandTimeout = setTimeout(() => {
    returnControlToNaisys();
  }, config.shellCommand.timeoutSeconds * 1000);
}

function returnControlToNaisys() {
  _wrapperSuspended = true;
  _queuedOutput.length = 0;

  // Flush the output to the consol, and give the LLM instructions of how it might continue
  let outputWithInstruction =
    _currentBufferType == "alternate"
      ? _getTerminalActiveBuffer()
      : _commandOutput.trim();

  _commandOutput = "";

  // Don't clear the alternate buffer, it's a special terminal full screen mode that the
  // LLM might want to see updates too
  if (_currentBufferType != "alternate") {
    resetTerminal();
  }

  outputWithInstruction += `\nNAISYS: Command interrupted after waiting ${config.shellCommand.timeoutSeconds} seconds.`;

  _completeCommand(outputWithInstruction);
}

function resetShell(pid: number) {
  if (!_process || _process.pid != pid) {
    output.comment("Ignoring timeout for old shell process " + pid);
    return false;
  }

  // There is still an issue here when running on linux where if a command like 'ping' is running
  // then kill() won't actually kill the 'bash' process hosting the ping, it will just hang here indefinitely
  // A not fail proof workaround is to tell the LLM to prefix long running commands with 'timeout 10s' or similar
  const killResponse = _process.kill();

  output.error(
    `KILL SIGNAL SENT TO PID: ${_process.pid}, RESPONSE: ${killResponse ? "SUCCESS" : "FAILED"}`,
  );

  // TODO: Timeout to 'hard close' basically create a new process and ignore the old one

  // Should trigger the process close event from here
  return true;
}

export async function getCurrentPath() {
  // If wrapper suspended just give the last known path
  if (_wrapperSuspended) {
    return _currentPath;
  }

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

  resetTerminal();

  clearTimeout(_currentCommandTimeout);
}

function resetTerminal() {
  _bufferChangeEvent?.dispose();
  _terminal?.dispose();

  _terminal = new xterm.Terminal({
    allowProposedApi: true,
    rows: process.stdout.rows,
    cols: process.stdout.columns,
  });

  _currentBufferType = "normal";

  _bufferChangeEvent = _terminal.buffer.onBufferChange((buffer) => {
    // If changing back to normal, copy the alternate buffer back to the output
    // so it shows up when the command is resolved
    if (_currentBufferType == "alternate" && buffer.type == "normal") {
      output.comment("NAISYS: BUFFER CHANGE BACK TO NORMAL");
      _commandOutput += "\n" + _getTerminalActiveBuffer() + "\n";
    }

    _currentBufferType = buffer.type;
  });
}

function resetProcess() {
  resetCommand();
  _process?.removeAllListeners();
  _process = undefined;

  _terminal?.dispose();
  _terminal = undefined;
}

/** Wraps multi line commands in a script to make it easier to diagnose the source of errors based on line number
 * May also help with common escaping errors */
function putMultilineCommandInAScript(command: string) {
  const scriptPath = new NaisysPath(
    `${config.naisysFolder}/agent-data/${config.agent.username}/multiline-command.sh`,
  );

  pathService.ensureFileDirExists(scriptPath);

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

function _completeCommand(output: string) {
  if (!_resolveCurrentCommand) {
    throw "No command to resolve";
  }

  _resolveCurrentCommand(output);
  _resolveCurrentCommand = undefined;
}

export function isShellSuspended() {
  return _wrapperSuspended;
}

/**
 * The alternate/active buffer is a special terminal mode that runs full screen
 *  independent of the 'normal' buffer that is more like a log
 */
function _getTerminalActiveBuffer() {
  let output = "";
  const bufferLineCount = _terminal?.buffer.normal?.length || 0;

  for (let i = 0; i < bufferLineCount; i++) {
    const line = _terminal?.buffer.alternate
      ?.getLine(i)
      ?.translateToString()
      .trim();

    if (line) {
      output += line + "\n";
    }
  }

  return output.trim();
}
