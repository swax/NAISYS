import chalk from "chalk";
import { createConfig } from "../config.js";
import { LlmMessageType, LlmRole } from "../llm/llmDtos.js";
import { createLogService } from "../services/logService.js";

export enum OutputColor {
  comment = "greenBright",
  error = "redBright",
  llm = "magenta",
  console = "white",
  loading = "yellow",
  subagent = "cyan",
}

export function createOutputService(
  logService: ReturnType<typeof createLogService>,
  config: Awaited<ReturnType<typeof createConfig>>,
) {
  const consoleBufer: string[] = [];

  // color available on chalk
  function write(msg: string, color: OutputColor = OutputColor.console) {
    if (config.consoleEnabled) {
      console.log(chalk[color](msg));
    } else {
      consoleBufer.push(chalk[color](msg));
    }
  }

  function flushBuffer() {
    if (!config.consoleEnabled) {
      throw new Error("Console is not enabled"); // do nothing
    }

    if (consoleBufer.length === 0) {
      comment("No buffered output to this agent to flush.");
      return;
    }

    consoleBufer.forEach((line) => console.log(line));
    consoleBufer.length = 0;
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
    flushBuffer,
  };
}
