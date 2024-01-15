class EnvService {
  public username = "jill";

  public hostname = "system-01";

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
