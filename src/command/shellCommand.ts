import { createConfig } from "../config.js";
import { createContextManager } from "../llm/contextManager.js";
import { createInputMode } from "../utils/inputMode.js";
import * as utilities from "../utils/utilities.js";
import { createShellWrapper } from "./shellWrapper.js";

export function createShellCommand(
  config: Awaited<ReturnType<typeof createConfig>>,
  shellWrapper: ReturnType<typeof createShellWrapper>,
  contextManager: ReturnType<typeof createContextManager>,
  inputMode: ReturnType<typeof createInputMode>,
) {
  const isShellSuspended = () => shellWrapper.isShellSuspended();
  const getCommandElapsedTimeString = () =>
    shellWrapper.getCommandElapsedTimeString();

  async function handleCommand(input: string): Promise<boolean> {
    const cmdParams = input.split(" ");
    let response: string;

    if (!isShellSuspended()) {
      if (["nano", "vi", "vim"].includes(cmdParams[0])) {
        // Route user to context friendly edit commands that can read/write the entire file in one go
        // Having EOF in quotes is important as it prevents the shell from replacing $variables with bash values
        throw `${cmdParams[0]} not supported. Use \`cat\` to read a file and \`cat > filename << 'EOF'\` to write a file`;
      }

      if (cmdParams[0] == "lynx" && cmdParams[1] != "--dump") {
        throw `Interactive mode with lynx is not supported. Use --dump with lynx to view a website`;
      }

      if (cmdParams[0] == "exit") {
        if (inputMode.isLLM()) {
          throw "Use 'endsession' to end the session and clear the console log.";
        }
        // Only the debug user is allowed to exit the shell
        else if (inputMode.isDebug()) {
          await shellWrapper.terminate();
          return true;
        }
      }

      response = await shellWrapper.executeCommand(input);
    }
    // Else shell is suspended, continue
    else {
      response = await shellWrapper.continueCommand(input);
    }

    let outputLimitExceeded = false;
    const tokenCount = utilities.getTokenCount(response);

    // Prevent too much output from blowing up the context
    const tokenMax = config.shellCommand.outputTokenMax;

    if (tokenCount > tokenMax) {
      outputLimitExceeded = true;

      const trimLength = (response.length * tokenMax) / tokenCount;

      response =
        response.slice(0, trimLength / 2) +
        "\n\n...\n\n" +
        response.slice(-trimLength / 2);
    }

    if (outputLimitExceeded) {
      response += `\nThe shell command generated too much output (${tokenCount} tokens). Only ${tokenMax} tokens worth are shown above.`;
    }

    if (response.endsWith(": command not found")) {
      response +=
        "\nPlease enter a valid Linux or NAISYS command after the prompt. Use the 'comment' command for thoughts.";
    }

    // TODO: move this into the command handler to remove the context manager dependency
    await contextManager.append(response);

    return false;
  }

  return {
    isShellSuspended,
    getCommandElapsedTimeString,
    handleCommand,
  };
}
