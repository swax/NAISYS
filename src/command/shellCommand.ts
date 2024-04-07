import * as config from "../config.js";
import * as contextManager from "../llm/contextManager.js";
import * as inputMode from "../utils/inputMode.js";
import { InputMode } from "../utils/inputMode.js";
import * as utilities from "../utils/utilities.js";
import * as shellWrapper from "./shellWrapper.js";

interface HandleShellCommandResponse {
  hasErrors: boolean;
  terminate?: boolean;
}

export async function handleCommand(
  input: string,
): Promise<HandleShellCommandResponse> {
  const cmdParams = input.split(" ");
  const response: HandleShellCommandResponse = {
    hasErrors: true,
  };

  // Route user to context friendly edit commands that can read/write the entire file in one go
  // Having EOF in quotes is important as it prevents the shell from replacing $variables with bash values
  if (["nano", "vi", "vim"].includes(cmdParams[0])) {
    await contextManager.append(
      `${cmdParams[0]} not supported. Use \`cat\` to read a file and \`cat > filename << 'EOF'\` to write a file`,
    );

    return response;
  }

  if (cmdParams[0] == "lynx" && cmdParams[1] != "--dump") {
    await contextManager.append(
      `Interactive mode with lynx is not supported. Use --dump with lynx to view a website`,
    );

    return response;
  }

  if (cmdParams[0] == "exit") {
    if (inputMode.current == InputMode.LLM) {
      await contextManager.append(
        "Use 'endsession' to end the session and clear the console log.",
      );
    } else if (inputMode.current == InputMode.Debug) {
      await shellWrapper.terminate();
      response.terminate = true;
    }

    return response;
  }

  const commandResponse = await shellWrapper.executeCommand(input);

  if (commandResponse.value) {
    let response = commandResponse.value;
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

    await contextManager.append(response);

    if (outputLimitExceeded) {
      await contextManager.append(
        `\nThe shell command generated too much output (${tokenCount} tokens). Only 2,000 tokens worth are shown above.`,
      );
    }

    if (response.endsWith(": command not found")) {
      await contextManager.append(
        "Please enter a valid Linux or NAISYS command after the prompt. Use the 'comment' command for thoughts.",
      );
    }
  }

  response.hasErrors = commandResponse.hasErrors;

  return response;
}
