import chalk from "chalk";

export enum OutputColor {
  comment = "greenBright",
  error = "redBright",
  llm = "magenta",
  console = "white",
  loading = "yellow",
}

// color available on chalk
export function write(msg: string, color: OutputColor = OutputColor.console) {
  console.log(chalk[color](msg));
}

/** Meant for non-content output we show in the console, but is not added to the context */
export function comment(msg: string) {
  write(msg, OutputColor.comment);
}

export function commentIfNotEmpty(msg: string) {
  if (msg) {
    comment(msg);
  }
}

export function error(msg: string) {
  write(msg, OutputColor.error);
}
