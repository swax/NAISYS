import { injectable } from "inversify";

export enum InputMode {
  Debug = "debug",
  LLM = "llm",
}

@injectable()
export class InputModeService {
  public current = InputMode.Debug;

  public toggle(forceMode?: InputMode) {
    if (forceMode) {
      this.current = forceMode;
    } else if (this.current == InputMode.Debug) {
      this.current = InputMode.LLM;
    } else if (this.current == InputMode.LLM) {
      this.current = InputMode.Debug;
    }
  }
}
