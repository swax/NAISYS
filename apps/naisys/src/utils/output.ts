import chalk from "chalk";
import { LlmMessageType, LlmRole } from "../llm/llmDtos.js";
import { LogService } from "../services/logService.js";

export enum OutputColor {
  comment = "greenBright",
  error = "redBright",
  llm = "magenta",
  console = "white",
  loading = "yellow",
  subagent = "cyan",
}

export function createOutputService(logService: LogService) {
  const consoleBuffer: string[] = [];

  /** Whether the output for this agent should be piped to the console */
  let consoleEnabled = false;

  function isConsoleEnabled() {
    return consoleEnabled;
  }

  function setConsoleEnabled(enabled: boolean) {
    const flush = enabled && !consoleEnabled;
    consoleEnabled = enabled;

    if (flush) {
      flushBuffer();
    }
  }

  const BUFFER_MAX_LINES = 10;

  // color available on chalk
  function write(msg: string, color: OutputColor = OutputColor.console) {
    if (consoleEnabled) {
      console.log(chalk[color](msg));
    } else {
      consoleBuffer.push(chalk[color](msg));
      if (consoleBuffer.length > BUFFER_MAX_LINES) {
        consoleBuffer.splice(0, consoleBuffer.length - BUFFER_MAX_LINES);
      }
    }
  }

  function flushBuffer() {
    if (!consoleEnabled) {
      throw new Error("Console is not enabled"); // do nothing
    }

    if (consoleBuffer.length) {
      consoleBuffer.forEach((line) => console.log(line));
      consoleBuffer.length = 0;
    }
  }

  /** Meant for non-content output we show in the console, but is not added to the context */
  function comment(msg: string) {
    write(msg, OutputColor.comment);
  }

  async function commentAndLog(msg: string) {
    comment(msg);

    await writeDbLog(msg, "comment");
  }

  function error(msg: string) {
    write(msg, OutputColor.error);
  }

  async function errorAndLog(msg: string) {
    error(msg);

    await writeDbLog(msg, "error");
  }

  async function writeDbLog(msg: string, type: LlmMessageType) {
    await logService.write({
      role: LlmRole.User,
      content: msg,
      type,
    });
  }

  return {
    write,
    comment,
    commentAndLog,
    error,
    errorAndLog,
    consoleBuffer,
    isConsoleEnabled,
    setConsoleEnabled,
  };
}

export type OutputService = ReturnType<typeof createOutputService>;
