import chalk from "chalk";

export enum ConsoleColor {
  comment = "greenBright",
  error = "redBright",
  llm = "magenta",
  console = "white",
}

// color available on chalk
export function output(
  msg: string,
  color: ConsoleColor = ConsoleColor.console,
) {
  console.log(chalk[color](msg));
}

/** Meant for non-content output we show in the console, but is not added to the context */
export function comment(msg: string) {
  output(msg, ConsoleColor.comment);
}

export function commentIfNotEmpty(msg: string) {
  if (msg) {
    comment(msg);
  }
}

export function error(msg: string) {
  output(msg, ConsoleColor.error);
}
