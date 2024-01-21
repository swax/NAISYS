import { InputMode } from "../enums.js";

class EnvService {
  public username = "jill";

  public hostname = "system-01";

  public tokenMax = 4000; // gpt4 has a 8k token max, but also $0.03 per 1k tokens

  public previousSessionNotes = "";

  public inputMode = InputMode.Debug;

  public toggleInputMode(forceMode?: InputMode) {
    if (forceMode) {
      envService.inputMode = forceMode;
    } else if (envService.inputMode == InputMode.Debug) {
      envService.inputMode = InputMode.LLM;
    } else if (envService.inputMode == InputMode.LLM) {
      envService.inputMode = InputMode.Debug;
    }
  }
}

export const envService = new EnvService();
