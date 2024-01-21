import * as contextService from "./contextService.js";
import * as inputModeService from "./inputModeService.js";
import { InputMode } from "./inputModeService.js";
import * as promptService from "./promptService.js";
import * as shellService from "./shellService.js";

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
    contextService.append(
      `${cmdParams[0]} not supported. Use 'cat' to view a file and 'cat > filename << EOF' to write a file`,
    );

    return {
      commandHandled: true,
    };
  }

  if (cmdParams[0] == "exit") {
    let terminate = false;

    if (inputModeService.current == InputMode.LLM) {
      contextService.append(
        "Use 'endsession' to end the session and clear the console log.",
      );
    } else if (inputModeService.current == InputMode.Debug) {
      await shellService.terminate();
      terminate = true;
    }

    return {
      commandHandled: true,
      terminate,
    };
  }

  let allInput = line;
  const promptPrefix = promptService.getPromptPrefix();

  while (consoleInputLines.length) {
    const nextLine = consoleInputLines.shift() || "";
    if (nextLine.startsWith(promptPrefix)) {
      consoleInputLines.unshift(nextLine);
      break;
    } else {
      contextService.append(nextLine, "llm");
    }

    allInput += "\n" + nextLine;
  }

  const output = await shellService.executeCommand(allInput);

  if (output) {
    contextService.append(output);
  }

  return {
    commandHandled: true,
    processNextLine: false,
  };
}
