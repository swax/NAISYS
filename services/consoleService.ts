import chalk from "chalk";
import { injectable } from "inversify";

export enum ConsoleColor {
  comment = "greenBright",
  error = "redBright",
  gpt = "magenta",
  console = "white",
}

@injectable()
export class ConsoleService {
  // color available on chalk
  public output(msg: string, color: ConsoleColor = ConsoleColor.console) {
    console.log(chalk[color](msg));
  }

  /** Meant for non-content output we show in the console, but is not added to the context */
  public comment(msg: string) {
    this.output(msg, ConsoleColor.comment);
  }

  public commentIfNotEmpty(msg: string) {
    if (msg) {
      this.comment(msg);
    }
  }

  public error(msg: string) {
    this.output(msg, ConsoleColor.error);
  }
}
