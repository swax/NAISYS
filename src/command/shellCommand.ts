import * as config from "../config.js";
import * as contextManager from "../llm/contextManager.js";
import * as inputMode from "../utils/inputMode.js";
import { InputMode } from "../utils/inputMode.js";
import * as utilities from "../utils/utilities.js";
import * as shellWrapper from "./shellWrapper.js";

export async function handleCommand(input: string): Promise<boolean> {
  const cmdParams = input.split(" ");

  // Route user to context friendly edit commands that can read/write the entire file in one go
  // Having EOF in quotes is important as it prevents the shell from replacing $variables with bash values
  if (["nano", "vi", "vim"].includes(cmdParams[0])) {
    throw `${cmdParams[0]} not supported. Use \`cat\` to read a file and \`cat > filename << 'EOF'\` to write a file`;
  }

  if (cmdParams[0] == "lynx" && cmdParams[1] != "--dump") {
    throw `Interactive mode with lynx is not supported. Use --dump with lynx to view a website`;
  }

  if (cmdParams[0] == "exit") {
    if (inputMode.current == InputMode.LLM) {
      throw "Use 'endsession' to end the session and clear the console log.";
    }
    // Only the debug user is allowed to exit the shell
    else if (inputMode.current == InputMode.Debug) {
      await shellWrapper.terminate();
      return true;
    }
  }

  let response = await shellWrapper.executeCommand(input);

  let outputLimitExceeded = false;
  const tokenCount = utilities.getTokenCount(response);

  // Prevent too much output from blowing up the context
  if (tokenCount > config.shellCommand.outputTokenMax) {
    outputLimitExceeded = true;

    const trimLength =
      (response.length * config.shellCommand.outputTokenMax) / tokenCount;

    response =
      response.slice(0, trimLength / 2) +
      "\n\n...\n\n" +
      response.slice(-trimLength / 2);
  }

  if (outputLimitExceeded) {
    response += `\nThe shell command generated too much output (${tokenCount} tokens). Only 2,000 tokens worth are shown above.`;
  }

  if (response.endsWith(": command not found")) {
    response +=
      "Please enter a valid Linux or NAISYS command after the prompt. Use the 'comment' command for thoughts.";
  }

  // todo move this into the command handler to remove the context manager dependency
  await contextManager.append(response);

  return false;
}
