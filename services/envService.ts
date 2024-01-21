import { injectable } from "inversify";

@injectable()
export class EnvService {
  public username = "jill";

  public hostname = "system-01";

  public tokenMax = 4000; // gpt4 has a 8k token max, but also $0.03 per 1k tokens
}
