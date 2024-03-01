export enum LlmRole {
  Assistant = "assistant",
  User = "user",
  /** Not supported by Google API */
  System = "system",
}

export interface LlmMessage {
  role: LlmRole;
  content: string;
  /** this is like a sub-type on the source/role, like the type of model, or the type of output like an error */
  type?: string;
  logId?: number;
}
