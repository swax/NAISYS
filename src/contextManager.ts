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

export let messages: Array<{
  role: "assistant" | "user";
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

  if (source == ContentSource.StartPrompt || source == ContentSource.Console) {
    messages.push({ role: "user", content: text });
  } else if (source == ContentSource.EndPrompt || source == ContentSource.LLM) {
    messages.push({ role: "assistant", content: text });
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
