import { get_encoding } from "tiktoken";
import * as inputMode from "./inputMode.js";
import { InputMode } from "./inputMode.js";
import * as output from "./output.js";
import { OutputColor } from "./output.js";

const _gpt2encoding = get_encoding("gpt2");

export let content = "";

export function append(
  input: string,
  source: "startPrompt" | "endPrompt" | "console" | "llm" = "console",
) {
  if (inputMode.current === InputMode.LLM) {
    content += input;

    // End the line except for the start prompt which needs the following input appended to it on the same line
    if (source != "startPrompt") {
      content += "\n";
    }

    // Prompts are manually added to the console log
    if (source != "startPrompt" && source != "endPrompt") {
      output.write(
        input,
        source == "llm" ? OutputColor.llm : OutputColor.console,
      );
    }
  }
  // Root runs in a shadow mode where their activity is not recorded in the context
  // Mark with a # to make it clear that it is not part of the context
  else if (inputMode.current === InputMode.Debug) {
    output.comment(input);
  }
}

export function clear() {
  content = "";
}

export function getTokenCount() {
  return _gpt2encoding.encode(content).length;
}
