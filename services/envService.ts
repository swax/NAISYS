class EnvService {
  public username = "jill";
  public hostname = "system-01";
  public previousSessionNotes = "";

  public getPromptPrefix() {
    return `${this.username}@${this.hostname}`;
  }
}

export const envService = new EnvService();