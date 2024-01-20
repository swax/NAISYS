import chalk from "chalk";

export enum ConsoleColor {
  comment = "greenBright",
  error = "redBright",
  gpt = "magenta",
  console = "white"
}

class ConsoleService {

  // color available on chalk
  public output(
    msg: string,
    color: ConsoleColor = ConsoleColor.console
  ) {
    console.log(chalk[color](msg));
  }

  /** Meant for non-content output we show in the console, but is not added to the context */
  public comment(msg: string) {
    this.output(msg, ConsoleColor.comment);
  }

  public error(msg: string) {
    this.output(msg, ConsoleColor.error);
  }
}

export const consoleService = new ConsoleService();
