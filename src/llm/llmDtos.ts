export enum LlmRole {
  Assistant = "assistant",
  User = "user",
  /** Not supported by Google API */
  System = "system",
}

export type LlmMessageType = "comment" | "error" | "system" | "workspace";

export enum ContentSource {
  ConsolePrompt = "startPrompt",
  LlmPromptResponse = "endPrompt",
  Console = "console",
  LLM = "llm",
}

export interface LlmMessage {
  role: LlmRole;
  content: string;
  /** this is like a sub-type on the source/role, like the type of model, or the type of output like an error */
  type?: LlmMessageType;
  logId?: number;
  promptIndex?: number;
  source?: ContentSource;
}
