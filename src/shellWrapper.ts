import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as fs from "fs";
import * as config from "./config.js";
import * as output from "./output.js";

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
let _log = "";
let _commandOutput = "";
let _hasErrors = false;
let _currentPath: string | undefined;

let _resolveCurrentCommand: ((value: CommandResponse) => void) | undefined;
let _currentCommandTimeout: NodeJS.Timeout | undefined;

const _commandDelimiter = "__COMMAND_END_X7YUTT__";

async function _ensureOpen() {
  if (_process) {
    return;
  }

  _log = "";
  resetCommand();

  _process = spawn("wsl", [], { stdio: "pipe" });

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

    commentIfNotEmpty(
      await executeCommand("mkdir -p /mnt/c/naisys/home/" + config.username),
    );
    commentIfNotEmpty(
      await executeCommand("cd /mnt/c/naisys/home/" + config.username),
    );
  } else {
    output.comment("SHELL RESTORED. PID: " + _process.pid);

    commentIfNotEmpty(await executeCommand("cd " + _currentPath));
  }

  // Stop running commands if one fails
  // Often the LLM will give us back all kinds of invalid commands, we want to break on the first one
  // Unfortunately this also causes the shell to exit on failures, so we need to handle that
  //commentIfNotEmpty(await executeCommand("set -e"));
}

/** Basically don't show anything in the console unless there is an error */
function commentIfNotEmpty(response: CommandResponse) {
  if (response.value) {
    output.comment(response.value);
  }
}

export function processOutput(dataStr: string, eventType: ShellEvent) {
  if (!_resolveCurrentCommand) {
    output.comment(eventType + " without handler: " + dataStr);
    return;
  }

  if (eventType === ShellEvent.Exit) {
    output.error("SHELL EXITED. PID: " + _process?.pid + " CODE: " + dataStr);
  } else {
    _log += "OUTPUT: " + dataStr;
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

  await _ensureOpen();

  if (_currentPath && command.trim().split("\n").length > 1) {
    command = await runCommandFromScript(command);
  }

  return new Promise<CommandResponse>((resolve) => {
    _resolveCurrentCommand = resolve;
    const commandWithDelimiter = `${command.trim()}\necho "${_commandDelimiter} LINE:\${LINENO}"\n`;
    _log += "INPUT: " + commandWithDelimiter;
    _process?.stdin.write(commandWithDelimiter);

    // If no response after 5 seconds, kill and reset the shell, often hanging on some unescaped input
    const timeoutSeconds = 5;
    _currentCommandTimeout = setTimeout(() => {
      if (_resolveCurrentCommand) {
        _process?.kill();
        output.error("SHELL TIMEMOUT/KILLED. PID: " + _process?.pid);
        resetProcess();

        _resolveCurrentCommand({
          value: `Error: Command timed out after ${timeoutSeconds} seconds.`,
          hasErrors: true,
        });
      }
    }, timeoutSeconds * 1000);
  });
}

export async function getCurrentPath() {
  await _ensureOpen();

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
 * May also help with common escaping errors
 */
function runCommandFromScript(command: string) {
  const scriptPathWin = "C:\\naisys\\command.sh";
  const scriptPathUnix = "/mnt/c/naisys/command.sh";

  // set -e causes the script to exit on any error
  const scriptContent = `#!/bin/bash
set -e
cd ${_currentPath}
${command.trim()}`;

  // create/writewrite file
  fs.writeFileSync(scriptPathWin, scriptContent);

  return `bash ${scriptPathUnix}`;
}
