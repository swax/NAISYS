import * as contextManager from "./contextManager.js";
import * as inputMode from "./inputMode.js";
import { InputMode } from "./inputMode.js";
import * as promptBuilder from "./promptBuilder.js";
import * as shellWrapper from "./shellWrapper.js";

interface HandleShellCommandResponse {
  commandHandled: boolean;
  processNextLine?: boolean;
  terminate?: boolean;
}

export async function handleCommand(
  line: string,
  consoleInputLines: string[],
): Promise<HandleShellCommandResponse> {
  const cmdParams = line.trim().split(" ");

  // Route user to context friendly edit commands that can read/write the entire file in one go
  if (["nano", "vi", "vim"].includes(cmdParams[0])) {
    contextManager.append(
      `${cmdParams[0]} not supported. Use 'cat' to view a file and 'cat > filename << EOF' to write a file`,
    );

    return {
      commandHandled: true,
    };
  }

  if (cmdParams[0] == "exit") {
    let terminate = false;

    if (inputMode.current == InputMode.LLM) {
      contextManager.append(
        "Use 'endsession' to end the session and clear the console log.",
      );
    } else if (inputMode.current == InputMode.Debug) {
      await shellWrapper.terminate();
      terminate = true;
    }

    return {
      commandHandled: true,
      terminate,
    };
  }

  let allInput = line;
  const promptPrefix = promptBuilder.getPromptPrefix();

  while (consoleInputLines.length) {
    const nextLine = consoleInputLines.shift() || "";
    if (nextLine.startsWith(promptPrefix)) {
      consoleInputLines.unshift(nextLine);
      break;
    } else {
      contextManager.append(nextLine, "llm");
    }

    allInput += "\n" + nextLine;
  }

  const output = await shellWrapper.executeCommand(allInput);

  if (output) {
    contextManager.append(output);
  }

  return {
    commandHandled: true,
    processNextLine: false,
  };
}
