import { getPlatformConfig } from "../services/runtime/shellPlatform.js";
import type { InputModeService } from "../utils/input/inputMode.js";
import type { PagedOutputBuffer } from "./pagedOutputBuffer.js";
import type { ShellWrapper } from "./shellWrapper.js";

export interface ShellCommandResult {
  response?: string;
  exitApp: boolean;
}

export function createShellCommand(
  shellWrapper: ShellWrapper,
  inputMode: InputModeService,
  pagedOutputBuffer: PagedOutputBuffer,
) {
  const platformConfig = getPlatformConfig();
  const isShellSuspended = () => shellWrapper.isShellSuspended();
  const isSecureContinuation = () => shellWrapper.isSecureContinuation();
  const getCommandElapsedTimeString = () =>
    shellWrapper.getCommandElapsedTimeString();
  const getCurrentCommandName = () => shellWrapper.getCurrentCommandName();

  async function handleCommand(input: string): Promise<ShellCommandResult> {
    const cmdParams = input.split(" ");
    let response: string;
    let label: string;

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
          throw "Use 'ns-session compact/complete' to finish the session";
        }
        // Only the debug user is allowed to exit the shell
        else if (inputMode.isDebug()) {
          await shellWrapper.terminate();
          return { exitApp: true };
        }
      }

      label = input.trim();
      response = await shellWrapper.executeCommand(input);
    }
    // Else shell is suspended, continue
    else {
      // Secure continuations carry a secret (password / API key) — label by
      // the running command so neither the source line nor the ns-more
      // prefix exposes it. Non-secure continuations use the typed input.
      label = isSecureContinuation()
        ? getCurrentCommandName()
        : input.trim();
      response = await shellWrapper.continueCommand({
        kind: "input",
        text: input,
      });
    }

    response = pagedOutputBuffer.setContent(label, response);

    if (
      response.endsWith(": command not found") ||
      response.includes("is not recognized")
    ) {
      response += "\n" + platformConfig.invalidCommandMessage;
    }

    return { response, exitApp: false };
  }

  return {
    isShellSuspended,
    isSecureContinuation,
    getCommandElapsedTimeString,
    getCurrentCommandName,
    handleCommand,
  };
}

export type ShellCommand = ReturnType<typeof createShellCommand>;
