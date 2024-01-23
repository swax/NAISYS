import * as contextManager from "./contextManager.js";
import * as inputMode from "./inputMode.js";
import { InputMode } from "./inputMode.js";
import * as shellWrapper from "./shellWrapper.js";

interface HandleShellCommandResponse {
  commandHandled: boolean;
  terminate?: boolean;
}

export async function handleCommand(
  input: string,
): Promise<HandleShellCommandResponse> {
  const cmdParams = input.split(" ");
  const response: HandleShellCommandResponse = {
    commandHandled: true,
  };

  // Route user to context friendly edit commands that can read/write the entire file in one go
  if (["nano", "vi", "vim"].includes(cmdParams[0])) {
    contextManager.append(
      `${cmdParams[0]} not supported. Use 'cat' to view a file and 'cat > filename << EOF' to write a file`,
    );

    return response;
  }

  if (cmdParams[0] == "lynx" && cmdParams[1] != "--dump") {
    contextManager.append(
      `Interactive mode with lynx is not supported. Use --dump with lynx to view a website`,
    );

    return response;
  }

  if (cmdParams[0] == "exit") {
    if (inputMode.current == InputMode.LLM) {
      contextManager.append(
        "Use 'endsession' to end the session and clear the console log.",
      );
    } else if (inputMode.current == InputMode.Debug) {
      await shellWrapper.terminate();
      response.terminate = true;
    }

    return response;
  }

  const output = await shellWrapper.executeCommand(input);

  if (output) {
    contextManager.append(output);
  }

  return response;
}
