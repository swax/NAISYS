import { get_encoding } from "tiktoken";
import * as inputMode from "./inputMode.js";
import { InputMode } from "./inputMode.js";
import * as output from "./output.js";
import { OutputColor } from "./output.js";

const _gpt2encoding = get_encoding("gpt2");

export enum ContentSource {
  StartPrompt = "startPrompt",
  EndPrompt = "endPrompt",
  Console = "console",
  LLM = "llm",
}

export let content = "";

export enum LlmRole {
  Assistant = "assistant",
  User = "user",
  /** Not supported by Google API */
  System = "system",
}

export let messages: Array<{
  role: LlmRole;
  content: string;
}> = [];

export function append(
  text: string,
  source: ContentSource = ContentSource.Console,
) {
  // Root runs in a shadow mode where their activity is not recorded in the context
  // Mark with a # to make it clear that it is not part of the context
  if (inputMode.current === InputMode.Debug) {
    output.comment(text);
    return;
  }

  // Else otherwise we're running in LLM mode
  content += text;

  const role =
    source == ContentSource.StartPrompt || source == ContentSource.Console
      ? LlmRole.User
      : source == ContentSource.EndPrompt || source == ContentSource.LLM
        ? LlmRole.Assistant
        : undefined;

  if (!role) {
    throw new Error("Invalid source");
  }

  // If last message is the same role then combine - Googl API requires alterntating roles
  let combined = false;

  if (messages.length > 0) {
    const lastMessage = messages[messages.length - 1];

    if (lastMessage.role == role) {
      lastMessage.content += `\n${text}`;
      combined = true;
    }
  }

  if (!combined) {
    messages.push({ role, content: text });
  }

  // End the line except for the start prompt which needs the following input appended to it on the same line
  if (source != "startPrompt") {
    content += "\n";
  }

  // Prompts are manually added to the console log
  if (source != "startPrompt" && source != "endPrompt") {
    output.write(text, source == "llm" ? OutputColor.llm : OutputColor.console);
  }
}

export function clear() {
  content = "";
  messages = [];
}

export function getTokenCount() {
  return _gpt2encoding.encode(content).length;
}

export function printContext() {
  output.comment("#####################");
  // output.comment(content);
  messages.forEach((message) => {
    output.comment(`${message.role}: ${message.content}`);
  });
  output.comment("#####################");
}
