import { injectable } from "inversify";
import { InputMode } from "../enums.js";

@injectable()
export class EnvService {
  public username = "jill";

  public hostname = "system-01";

  public tokenMax = 4000; // gpt4 has a 8k token max, but also $0.03 per 1k tokens

  public previousSessionNotes = "";

  public inputMode = InputMode.Debug;

  public toggleInputMode(forceMode?: InputMode) {
    if (forceMode) {
      this.inputMode = forceMode;
    } else if (this.inputMode == InputMode.Debug) {
      this.inputMode = InputMode.LLM;
    } else if (this.inputMode == InputMode.LLM) {
      this.inputMode = InputMode.Debug;
    }
  }
}
