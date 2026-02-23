import xterm from "@xterm/headless";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import crypto from "crypto";
import * as fs from "fs";
import os from "os";
import path from "path";
import stripAnsi from "strip-ansi";
import treeKill from "tree-kill";

import { AgentConfig } from "../agent/agentConfig.js";
import { UserService } from "../agent/userService.js";
import { GlobalConfig } from "../globalConfig.js";
import * as pathService from "../services/pathService.js";
import { getPlatformConfig } from "../services/shellPlatform.js";
import { OutputService } from "../utils/output.js";

enum ShellEvent {
  Ouptput = "stdout",
  Error = "stderr",
  Exit = "exit",
}

export function createShellWrapper(
  { globalConfig }: GlobalConfig,
  { agentConfig }: AgentConfig,
  output: OutputService,
  userService: UserService,
  localUserId: number,
) {
  const _apiKey = userService.getUserById(localUserId)?.apiKey;

  let _process: ChildProcessWithoutNullStreams | undefined;
  let _currentProcessId: number | undefined;
  let _commandOutput = "";
  let _currentPath: string | undefined;

  let _terminal: xterm.Terminal | undefined;
  let _bufferChangeEvent: xterm.IDisposable | undefined;
  let _currentBufferType: "normal" | "alternate" = "normal";

  let _resolveCurrentCommand: ((value: string) => void) | undefined;
  let _currentCommandTimeout: NodeJS.Timeout | undefined;
  let _currentCommandText: string | undefined;

  /** How we know the command has completed when running the command inside a shell like bash or wsl */
  const _commandDelimiter = "__COMMAND_END_X7YUTT__";

  let _wrapperSuspended = false;

  const _queuedOutput: {
    rawDataStr: Buffer;
    eventType: ShellEvent;
    pid: number;
  }[] = [];

  // Flow control watermarks to prevent xterm buffer overflow
  const HIGH_WATERMARK = 100000; // Pause input when buffer exceeds this (bytes)
  const LOW_WATERMARK = 10000; // Resume input when buffer drops below this (bytes)
  let _writeWatermark = 0;

  const platformConfig = getPlatformConfig();

  /**
   * Create clean env variables to pass to a spawned process.
   * Starts from system env (for PATH, HOME, etc.) and overlays .env vars,
   * then removes NAISYS-specific vars that could conflict with the spawned process.
   */
  function getCleanEnv() {
    const cleanEnv = { ...process.env, ...globalConfig().variableMap };
    delete cleanEnv.OPENAI_API_KEY;
    delete cleanEnv.GOOGLE_API_KEY;
    delete cleanEnv.ANTHROPIC_API_KEY;
    delete cleanEnv.WEBSITE_URL;
    if (_apiKey) {
      cleanEnv.NAISYS_API_KEY = _apiKey;
    }
    return cleanEnv;
  }

  async function ensureOpen() {
    if (_process) {
      return;
    }

    resetCommand();

    _process = spawn(platformConfig.shellCommand, platformConfig.shellArgs, {
      stdio: "pipe",
      env: getCleanEnv(),
      shell: false,
    });

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
      await output.commentAndLog(
        `NEW ${platformConfig.shellName.toUpperCase()} SHELL OPENED. PID: ${pid}`,
      );

      // If we want to give agent a home folder, we can add mkir/cd ${username} folder in the initCommands of the agent
    } else {
      await output.commentAndLog(
        `${platformConfig.shellName.toUpperCase()} SHELL RESTORED. PID: ${pid}`,
      );

      await errorIfNotEmpty(
        await executeCommand(platformConfig.cdCommand(_currentPath)),
      );
    }

    // Stop running commands if one fails
    // Often the LLM will give us back all kinds of invalid commands, we want to break on the first one
    // Unfortunately this also causes the shell to exit on failures, so we need to handle that
    //commentIfNotEmpty(await executeCommand("set -e"));
  }

  /** Basically don't show anything in the console unless there is an error */
  async function errorIfNotEmpty(response: string) {
    if (response) {
      await output.errorAndLog(response);
    }
  }

  /** Filter out PowerShell noise from output */
  function filterPowerShellNoise(str: string): string {
    if (platformConfig.platform !== "windows") {
      return str;
    }
    // Get command lines to filter (the echoed command)
    const commandLines = _currentCommandText
      ? _currentCommandText.split("\n").map((l) => l.trim())
      : [];

    return str
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        // Filter out PS prompts (PS C:\...>)
        if (/^PS [A-Za-z]:\\.*>/.test(trimmed)) return false;
        // Filter out the delimiter echo
        if (
          trimmed.includes("Write-Host") &&
          trimmed.includes(_commandDelimiter)
        )
          return false;
        // Filter out PSReadline warnings
        if (trimmed.includes("Cannot load PSReadline module")) return false;
        if (trimmed.includes("Console is running without PSReadline"))
          return false;
        // Filter out our setup commands being echoed
        if (trimmed.startsWith("New-Item -ItemType Directory")) return false;
        if (trimmed.startsWith("Set-Location ")) return false;
        if (trimmed === "(Get-Location).Path") return false;
        // Filter out the echoed command itself
        if (commandLines.includes(trimmed)) return false;
        return true;
      })
      .join("\n");
  }

  function processOutput(
    rawDataStr: Buffer,
    eventType: ShellEvent,
    pid: number,
  ) {
    if (_wrapperSuspended) {
      _queuedOutput.push({ rawDataStr, eventType, pid });
      return;
    }

    let dataStr = stripAnsi(rawDataStr.toString());

    if (pid != _currentProcessId) {
      // This funcion cant be async, but the console write will still be synchronous, just the db write will have a small delay
      void output.commentAndLog(
        `Ignoring '${eventType}' from old shell process ${pid}: ` + dataStr,
      );
      return;
    }

    if (!_resolveCurrentCommand) {
      // Don't log if it's just empty noise (like a filtered PowerShell prompt)
      const filteredStr = filterPowerShellNoise(dataStr).trim();
      if (filteredStr) {
        void output.commentAndLog(
          `Ignoring '${eventType}' from process ${pid} with no resolve handler: ` +
            filteredStr,
        );
      }
      return;
    }

    if (eventType === ShellEvent.Exit) {
      void output.errorAndLog(
        `SHELL EXIT. PID: ${_process?.pid}, CODE: ${rawDataStr}`,
      );

      let finalOutput =
        _currentBufferType == "alternate"
          ? _getTerminalActiveBuffer()
          : filterPowerShellNoise(_commandOutput).trim();

      if (
        finalOutput.endsWith(platformConfig.commandNotFoundSuffix) ||
        finalOutput.includes("unexpected EOF") ||
        finalOutput.includes("is not recognized")
      ) {
        finalOutput += `\nNAISYS: Make sure that you are using valid ${platformConfig.shellName} commands, and that any non-commands are prefixed with the 'ns-comment' command.`;
      }

      finalOutput += `\nNAISYS: Command killed.`;

      resetProcess();

      _completeCommand(finalOutput);
      return;
    }

    // Should only happen back in normal mode, so we don't need to modify the rawDataStr
    let endDelimiterHit = false;
    // Use lastIndexOf to find the actual delimiter output, not an echoed command containing it
    const endDelimiterPos = dataStr.lastIndexOf(_commandDelimiter);

    if (
      endDelimiterPos != -1 &&
      // Quotes will only precede the delimiter if the echo command got in the output, so don't count it
      // For example running nano or vi will cause this
      dataStr[endDelimiterPos - 1] != '"'
    ) {
      endDelimiterHit = true;
      dataStr = dataStr.slice(0, endDelimiterPos);

      // If it does happen somehow, log it so I can figure out why/how and what to do about it
      if (_currentBufferType == "alternate") {
        void output.errorAndLog(
          "UNEXPECTED END DELIMITER IN ALTERNATE BUFFER: " + dataStr,
        );
      }
    }

    // If we're in alternate mode, just write the data to the terminal
    // When the buffer changes back to normal, the output will be copied back to the command output
    if (_currentBufferType == "normal") {
      _commandOutput += dataStr;
    }

    // TODO: get token size of buffer, if too big, switch it front/middle/back

    // Implement flow control to prevent xterm buffer overflow
    _writeWatermark += rawDataStr.length;
    _terminal?.write(rawDataStr, () => {
      // Callback fires when xterm finishes processing this chunk
      _writeWatermark = Math.max(_writeWatermark - rawDataStr.length, 0);

      // Resume streams if watermark drops below threshold
      if (_writeWatermark < LOW_WATERMARK) {
        if (_process?.stdout.isPaused()) {
          _process.stdout.resume();
        }
        if (_process?.stderr.isPaused()) {
          _process.stderr.resume();
        }
      }
    });

    // Pause streams if watermark exceeds threshold to prevent buffer overflow
    if (_writeWatermark > HIGH_WATERMARK) {
      _process?.stdout.pause();
      _process?.stderr.pause();
    }

    if (endDelimiterHit) {
      // Filter PowerShell noise from complete output (not during streaming due to chunking)
      const finalOutput = filterPowerShellNoise(_commandOutput).trim();

      resetCommand();

      _completeCommand(finalOutput);
    }
  }

  async function executeCommand(command: string) {
    if (_wrapperSuspended) {
      throw "Use continueCommand to send input to a shell command in process";
    }

    command = command.trim();
    _currentCommandText = command;

    await ensureOpen();

    if (_currentPath && command.split("\n").length > 1) {
      // } || command.includes("&&"))){
      command = putMultilineCommandInAScript(command);
    }

    return new Promise<string>((resolve, reject) => {
      _resolveCurrentCommand = resolve;

      if (!_process) {
        reject("Shell process is not open");
        return;
      }

      const commandWithDelimiter = `${command}\n${platformConfig.echoDelimiter(_commandDelimiter)}\n`;
      _process.stdin.write(commandWithDelimiter);

      // Set timeout to wait for response from command
      setCommandTimeout("start");
    });
  }

  /** The LLM made its decision on how it wants to continue with the shell that previously timed out */
  function continueCommand(command: string) {
    if (!_wrapperSuspended) {
      throw "Shell is not suspended, use execute command";
    }

    command = command.trim();

    _wrapperSuspended = false;

    let choice: "wait" | "kill" | "input";

    const cmdParts = command.split(" ");
    const baseCommand = cmdParts[0];

    if (baseCommand === "wait") {
      choice = "wait";
    } else if (baseCommand === "kill") {
      choice = "kill";
    } else {
      choice = "input";
    }

    return new Promise<string>(async (resolve, reject) => {
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
        const waitParam = cmdParts[1];
        setCommandTimeout("extend", waitParam);
        return;
      }
      // Else LLM wants to kill the process
      else if (choice == "kill") {
        if (!_currentProcessId) {
          reject("No process to kill");
        } else if (await resetShell(_currentProcessId)) {
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
        setCommandTimeout("start");
      }
    });
  }

  let _startCommandTime: Date | undefined;
  let _startWaitTime: Date | undefined;

  function setCommandTimeout(type: "start" | "extend", waitParam?: string) {
    _startWaitTime = new Date();

    if (type == "start") {
      _startCommandTime = new Date();
    }

    let waitSeconds = globalConfig().shellCommand.timeoutSeconds;

    // Parse wait time parameter if provided
    if (waitParam) {
      const waitTime = parseInt(waitParam, 10);
      if (!isNaN(waitTime) && waitTime > 0) {
        waitSeconds = waitTime;
      }
    }

    const maxTimeoutSeconds = globalConfig().shellCommand.maxTimeoutSeconds;
    if (waitSeconds > maxTimeoutSeconds) {
      waitSeconds = maxTimeoutSeconds;
    }

    _currentCommandTimeout = setTimeout(() => {
      returnControlToNaisys();
    }, waitSeconds * 1000);
  }

  function returnControlToNaisys() {
    _wrapperSuspended = true;
    _queuedOutput.length = 0;

    // Flush the output to the console, and give the LLM instructions of how it might continue
    let outputWithInstruction =
      _currentBufferType == "alternate"
        ? _getTerminalActiveBuffer()
        : filterPowerShellNoise(_commandOutput).trim();

    _commandOutput = "";

    // Don't clear the alternate buffer, it's a special terminal full screen mode that the
    // LLM might want to see updates too
    if (_currentBufferType != "alternate") {
      resetTerminal();
    }

    const actualWaitSeconds = _startWaitTime
      ? Math.round(
          (new Date().getTime() - _startWaitTime.getTime()) / 1000,
        ).toString()
      : "?";

    outputWithInstruction += `\nNAISYS: Command interrupted after waiting ${actualWaitSeconds} seconds.`;

    _completeCommand(outputWithInstruction);
  }

  async function resetShell(pid: number) {
    if (!_process || _process.pid != pid) {
      await output.commentAndLog(
        "Ignoring timeout for old shell process " + pid,
      );
      return false;
    }

    await output.errorAndLog(`KILL-TREE SIGNAL SENT TO PID: ${_process.pid}`);
    treeKill(pid, "SIGKILL");

    // Should trigger the process close event from here
    return true;
  }

  async function getCurrentPath() {
    // If wrapper suspended just give the last known path
    if (_wrapperSuspended) {
      return _currentPath;
    }

    await ensureOpen();

    _currentPath = await executeCommand(platformConfig.pwdCommand);

    return _currentPath;
  }

  async function terminate() {
    /*const exitCode = */ await executeCommand("exit");

    // For some reason showing the exit code clears the console
    resetProcess();
  }

  function resetCommand() {
    _commandOutput = "";
    _writeWatermark = 0;
    _currentCommandText = undefined;

    resetTerminal();

    clearTimeout(_currentCommandTimeout);
  }

  function resetTerminal() {
    _bufferChangeEvent?.dispose();
    _terminal?.dispose();

    _terminal = new xterm.Terminal({
      allowProposedApi: true,
      rows: process.stdout.rows || 24,
      cols: process.stdout.columns || 80,
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

  /** Hash of the process working directory, used to disambiguate script files
   *  when multiple instances run under the same username */
  const _cwdHash = crypto
    .createHash("sha256")
    .update(process.cwd())
    .digest("hex")
    .slice(0, 4);

  /** Wraps multi line commands in a script to make it easier to diagnose the source of errors based on line number
   * May also help with common escaping errors */
  function putMultilineCommandInAScript(command: string) {
    const naisysFolder = process.env.NAISYS_FOLDER;

    const scriptPath = naisysFolder
      ? path.join(
          naisysFolder,
          "agent-data",
          agentConfig().username,
          `multiline-command${platformConfig.scriptExtension}`,
        )
      : path.join(
          os.homedir(),
          ".naisys",
          "agent-data",
          `${agentConfig().username}-${_cwdHash}`,
          `multiline-command${platformConfig.scriptExtension}`,
        );

    pathService.ensureFileDirExists(scriptPath);

    // Build platform-specific script content
    let scriptContent: string;
    if (platformConfig.platform === "windows") {
      // PowerShell script
      scriptContent = `${platformConfig.scriptHeader}
${platformConfig.scriptSetError}
Set-Location "${_currentPath}"
${command.trim()}`;
    } else {
      // Bash script
      scriptContent = `${platformConfig.scriptHeader}
${platformConfig.scriptSetError}
cd "${_currentPath}"
${command.trim()}`;
    }

    // create/write file
    fs.writeFileSync(scriptPath, scriptContent);

    // `Path` is set to the ./bin folder because custom NAISYS commands that follow shell commands will be handled by the shell, which will fail
    // so we need to remind the LLM that 'naisys commands cannot be used with other commands on the same prompt'
    return platformConfig.sourceScript(globalConfig().binPath, scriptPath);
  }

  function _completeCommand(output: string) {
    if (!_resolveCurrentCommand) {
      throw "No command to resolve";
    }

    _resolveCurrentCommand(output);
    _resolveCurrentCommand = undefined;
  }

  function isShellSuspended() {
    return _wrapperSuspended;
  }

  function getCommandElapsedTimeString() {
    if (!_startCommandTime) {
      return 0;
    }

    const totalSeconds = Math.round(
      (new Date().getTime() - _startCommandTime.getTime()) / 1000,
    );
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
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

  return {
    executeCommand,
    continueCommand,
    getCurrentPath,
    terminate,
    isShellSuspended,
    getCommandElapsedTimeString,
  };
}

export type ShellWrapper = ReturnType<typeof createShellWrapper>;
