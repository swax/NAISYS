import chalk from "chalk";
import { LlmMessageType, LlmRole } from "../llm/llmDtos.js";
import * as logService from "./logService.js";

export enum OutputColor {
  comment = "greenBright",
  error = "redBright",
  llm = "magenta",
  console = "white",
  loading = "yellow",
  subagent = "cyan",
}

// color available on chalk
export function write(msg: string, color: OutputColor = OutputColor.console) {
  console.log(chalk[color](msg));
}

/** Meant for non-content output we show in the console, but is not added to the context */
export function comment(msg: string) {
  write(msg, OutputColor.comment);
}

export async function commentAndLog(msg: string) {
  comment(msg);

  await writeDbLog(msg, "comment");
}

export function error(msg: string) {
  write(msg, OutputColor.error);
}

export async function errorAndLog(msg: string) {
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
