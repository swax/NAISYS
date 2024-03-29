import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as config from "../config.js";
import * as output from "../utils/output.js";
import { unixToHostPath } from "../utils/utilities.js";

type CommandResponse = {
  value: string;
  hasErrors: boolean;
};

enum ShellEvent {
  Ouptput = "stdout",
  Error = "stderr",
  Exit = "exit",
}

let _process: ChildProcessWithoutNullStreams | undefined;
//let _log = "";
let _commandOutput = "";
let _hasErrors = false;
let _currentPath: string | undefined;

let _resolveCurrentCommand: ((value: CommandResponse) => void) | undefined;
let _currentCommandTimeout: NodeJS.Timeout | undefined;

const _commandDelimiter = "__COMMAND_END_X7YUTT__";

async function ensureOpen() {
  if (_process) {
    return;
  }

  //_log = "";
  resetCommand();

  const spawnProcess = os.platform() === "win32" ? "wsl" : "bash";

  _process = spawn(spawnProcess, [], { stdio: "pipe" });

  _process.stdout.on("data", (data) => {
    processOutput(data.toString(), ShellEvent.Ouptput);
  });

  _process.stderr.on("data", (data) => {
    processOutput(data.toString(), ShellEvent.Error);
  });

  _process.on("close", (code) => {
    processOutput(`${code}`, ShellEvent.Exit);
    _process = undefined;
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
function errorIfNotEmpty(response: CommandResponse) {
  if (response.value) {
    output.error(response.value);
  }
}

function processOutput(dataStr: string, eventType: ShellEvent) {
  if (!_resolveCurrentCommand) {
    output.comment(eventType + " without handler: " + dataStr);
    return;
  }

  if (eventType === ShellEvent.Exit) {
    output.error("SHELL EXITED. PID: " + _process?.pid + " CODE: " + dataStr);
  } else {
    //_log += "OUTPUT: " + dataStr;
    _commandOutput += dataStr;
  }

  if (eventType === ShellEvent.Error) {
    _hasErrors = true;
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
  if (delimiterIndex != -1 || eventType === ShellEvent.Exit) {
    // trim everything after delimiter
    _commandOutput = _commandOutput.slice(0, delimiterIndex);

    const response = {
      value: _commandOutput.trim(),
      hasErrors: _hasErrors,
    };

    resetCommand();
    _resolveCurrentCommand(response);
  }
}
export async function executeCommand(command: string) {
  /*if (command == "shelllog") {
    _log.split("\n").forEach((line, i) => {
      output.comment(`${i}. ${line}`);
    });

    return <CommandResponse>{
      value: "",
      hasErrors: false,
    };
  }*/

  await ensureOpen();

  if (_currentPath && command.trim().split("\n").length > 1) {
    command = await runCommandFromScript(command);
  }

  return new Promise<CommandResponse>((resolve) => {
    _resolveCurrentCommand = resolve;
    const commandWithDelimiter = `${command.trim()}\necho "${_commandDelimiter} LINE:\${LINENO}"\n`;

    //_log += "INPUT: " + commandWithDelimiter;
    _process?.stdin.write(commandWithDelimiter);

    // If no response, kill and reset the shell, often hanging on some unescaped input
    _currentCommandTimeout = setTimeout(
      resetShell,
      config.shellCommmandTimeoutSeconds * 1000,
    );
  });
}

function resetShell() {
  if (!_resolveCurrentCommand) {
    return;
  }

  _process?.kill();

  output.error("SHELL TIMEMOUT/KILLED. PID: " + _process?.pid);

  const outputWithError =
    _commandOutput.trim() +
    `\nError: Command timed out after ${config.shellCommmandTimeoutSeconds} seconds.`;

  resetProcess();

  _resolveCurrentCommand({
    value: outputWithError,
    hasErrors: true,
  });
}

export async function getCurrentPath() {
  await ensureOpen();

  _currentPath = (await executeCommand("pwd")).value;

  return _currentPath;
}

export async function terminate() {
  /*const exitCode = */ await executeCommand("exit");

  // For some reason showing the exit code clears the console
  resetProcess();
}

function resetCommand() {
  _commandOutput = "";
  _hasErrors = false;
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
  const scriptPath = `${config.naisysFolder}/home/${config.agent.username}/.command.tmp.sh`;

  // set -e causes the script to exit on the first error
  const scriptContent = `#!/bin/bash
set -e
cd ${_currentPath}
${command.trim()}`;

  // create/writewrite file
  fs.writeFileSync(unixToHostPath(scriptPath), scriptContent);

  // `Path` is set to the ./bin folder because custom NAISYS commands that follow shell commands will be handled by the shell, which will fail
  // so we need to remind the LLM that 'naisys commands cannot be used with other commands on the same prompt'
  // `source` will run the script in the current shell, so any change directories in the script will persist in the current shell
  return `PATH=${config.binPath}:$PATH source ${scriptPath}`;
}
