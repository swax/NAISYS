export type LlmRole = "assistant" | "user" | "system";

export type LlmMessageType = "comment" | "error" | "system" | "workspace";

export enum ContentSource {
  ConsolePrompt = "startPrompt",
  LlmPromptResponse = "endPrompt",
  Console = "console",
  LLM = "llm",
}

// --- Content block types for multi-modal messages ---

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ImageBlock {
  type: "image";
  base64: string;
  mimeType: string;
}

export interface AudioBlock {
  type: "audio";
  base64: string;
  mimeType: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  isError?: boolean;
  resultContent: Array<TextBlock | ImageBlock>;
}

export type ContentBlock =
  | TextBlock
  | ImageBlock
  | AudioBlock
  | ToolUseBlock
  | ToolResultBlock;

/** Extract text content from a message's content field. Returns "[Image]" placeholder for image blocks. */
export function getTextContent(content: string | ContentBlock[]): string {
  if (typeof content === "string") {
    return content;
  }
  // For image/audio blocks, there should only be a single text block that is like [Image: filename.jpg]
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join(" | ");
}

export interface LlmMessage {
  role: LlmRole;
  content: string | ContentBlock[];
  /** this is like a sub-type on the source/role, like the type of model, or the type of output like an error */
  type?: LlmMessageType;
  source?: ContentSource;
  cachePoint?: boolean;
}
