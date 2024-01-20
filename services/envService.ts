class EnvService {
  public username = "jill";

  public hostname = "system-01";

  public tokenMax = 4000; // gpt4 has a 8k token max, but also $0.03 per 1k tokens

  public previousSessionNotes = "";

  public inputMode: "root" | "gpt" = "root";

  public toggleInputMode(forceMode: "root" | "gpt" | undefined = undefined) {
    if (forceMode) {
      envService.inputMode = forceMode;
    } else if (envService.inputMode == "root") {
      envService.inputMode = "gpt";
    } else if (envService.inputMode == "gpt") {
      envService.inputMode = "root";
    }
  }
}

export const envService = new EnvService();
