import { get_encoding } from "tiktoken";
import * as consoleService from "./consoleService.js";
import { ConsoleColor } from "./consoleService.js";
import * as inputModeService from "./inputModeService.js";
import { InputMode } from "./inputModeService.js";

const _gpt2encoding = get_encoding("gpt2");

export let context = "";

export function append(
  input: string,
  source: "startPrompt" | "endPrompt" | "console" | "llm" = "console",
) {
  if (inputModeService.current === InputMode.LLM) {
    context += input;

    // End the line except for the start prompt which needs the following input appended to it on the same line
    if (source != "startPrompt") {
      context += "\n";
    }

    // Prompts are manually added to the console log
    if (source != "startPrompt" && source != "endPrompt") {
      consoleService.output(
        input,
        source == "llm" ? ConsoleColor.llm : ConsoleColor.console,
      );
    }
  }
  // Root runs in a shadow mode where their activity is not recorded in the context
  // Mark with a # to make it clear that it is not part of the context
  else if (inputModeService.current === InputMode.Debug) {
    consoleService.comment(input);
  }
}

export function clear() {
  context = "";
}

export function getTokenCount() {
  return _gpt2encoding.encode(context).length;
}
