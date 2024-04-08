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
let _commandOutput = "";
let _currentPath: string | undefined;

let _resolveCurrentCommand: ((value: string) => void) | undefined;
let _currentCommandTimeout: NodeJS.Timeout | undefined;
let _startTime: Date | undefined;

const _commandDelimiter = "__COMMAND_END_X7YUTT__";

async function ensureOpen() {
  if (_process) {
    return;
  }

  resetCommand();

  const spawnProcess = os.platform() === "win32" ? "wsl" : "bash";

  _process = spawn(spawnProcess, [], { stdio: "pipe" });

  _process.stdout.on("data", (data) => {
    // Extend the timeout of the current command, important to do before processing the output
    setOrExtendShellTimeout();

    processOutput(data.toString(), ShellEvent.Ouptput);
  });

  _process.stderr.on("data", (data) => {
    processOutput(data.toString(), ShellEvent.Error);
  });

  _process.on("close", (code) => {
    processOutput(`${code}`, ShellEvent.Exit);
  });

  // Init users home dir on first run, on shell crash/rerun go back to the current path
  if (!_currentPath) {
    output.comment("NEW SHELL OPENED. PID: " + _process.pid);

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
    output.comment("SHELL RESTORED. PID: " + _process.pid);

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

function processOutput(dataStr: string, eventType: ShellEvent) {
  if (!_resolveCurrentCommand) {
    output.comment(eventType + " without handler: " + dataStr);
    return;
  }

  if (eventType === ShellEvent.Exit) {
    output.error("SHELL EXITED. PID: " + _process?.pid + " CODE: " + dataStr);

    const elapsedSeconds = _startTime
      ? Math.round((new Date().getTime() - _startTime.getTime()) / 1000)
      : -1;

    const outputWithError =
      _commandOutput.trim() +
      `\nError: Command timed out after ${elapsedSeconds} seconds.`;

    resetProcess();

    _resolveCurrentCommand(outputWithError);
    return;
  } else {
    //_log += "OUTPUT: " + dataStr;
    _commandOutput += dataStr;
  }

  if (eventType === ShellEvent.Error) {
    //output += "stderr: ";
    // parse out the line number from '-bash: line 999: '
    /*if (dataStr.startsWith("-bash: line ")) {
      output.error(dataStr);

      const lineNum = dataStr.slice(11, dataStr.indexOf(": ", 11));
      output.error(`Detected error on line ${lineNum} of output`);

      // display the same line of _output
      const logLines = _log.split("\n");
      const lineIndex = parseInt(lineNum) - 1;
      if (logLines.length > lineIndex) {
        output.error(`Line ${lineIndex} in log: ` + logLines[lineIndex]);
      }

      // output all lines for debugging
      for (let i = 0; i < logLines.length; i++) {
        // if withing 10 lines of the error, show the line
        //if (Math.abs(i - lineIndex) < 10) {
          const lineStr = logLines[i].replace(/\n/g, "");
          output.error(`${i}: ${lineStr}`);
        //}
      }
    }*/
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
    command = await runCommandFromScript(command);
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

  if (timeWaiting > config.shellCommand.maxTimeoutSeconds) {
    return;
  }

  clearTimeout(_currentCommandTimeout);

  _currentCommandTimeout = setTimeout(
    resetShell,
    config.shellCommand.noResponseTimeoutSeconds * 1000,
  );
}

function resetShell() {
  if (!_process) {
    return;
  }

  output.error("COMMAND TIMEMOUT. KILL PID: " + _process.pid);

  _process.kill("SIGINT");

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
function runCommandFromScript(command: string) {
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
