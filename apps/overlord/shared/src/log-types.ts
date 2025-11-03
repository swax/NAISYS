export type LogSource = "startPrompt" | "endPrompt" | "console" | "llm";
export type LogType = "comment" | "error" | "system" | "workspace";
export type LogRole = "NAISYS" | "LLM";

export interface LogEntry {
  id: number;
  username: string;
  role: LogRole;
  source: LogSource;
  type: LogType;
  message: string;
  date: string;
}
