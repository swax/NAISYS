class ConsoleService {
  public output(msg: string) {
    console.log(msg);
  }

  /** Meant for non-content output we show in the console, but is not added to the context */
  public comment(msg: string) {
    console.log(`# ${msg}`);
  }
}

export const consoleService = new ConsoleService();
