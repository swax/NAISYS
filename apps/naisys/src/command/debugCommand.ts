import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

import { GlobalConfig } from "../globalConfig.js";
import { ContextManager } from "../llm/contextManager.js";
import { LlmRole } from "../llm/llmDtos.js";
import { InputModeService } from "../utils/inputMode.js";
import { OutputService } from "../utils/output.js";
import { contextCmd, superadminPasswordCmd, talkCmd } from "./commandDefs.js";
import { RegistrableCommand } from "./commandRegistry.js";

export function createDebugCommands(
  globalConfig: GlobalConfig,
  contextManager: ContextManager,
  output: OutputService,
  inputMode: InputModeService,
  systemMessage: string,
): RegistrableCommand[] {
  function roleToString(role: LlmRole) {
    switch (role) {
      case LlmRole.Assistant:
        return "LLM/Assistant";
      case LlmRole.User:
        return "NAISYS/User";
      case LlmRole.System:
        return "NAISYS/System";
      default:
        return "Unknown";
    }
  }

  function printContext() {
    let content = `------ System ------`;
    content += `\n${systemMessage}`;

    contextManager.getCombinedMessages().forEach((message) => {
      content += `\n\n------ ${roleToString(message.role)} ------`;
      if (message.cachePoint) {
        content += `\n[-- CACHE POINT --]`;
      }
      content += `\n${message.content}`;
    });

    return content;
  }

  const nsContext: RegistrableCommand = {
    command: contextCmd,
    handleCommand: () => {
      output.comment("#####################");
      output.comment(printContext());
      output.comment("#####################");
      return Promise.resolve("");
    },
  };

  const nsTalk: RegistrableCommand = {
    command: talkCmd,
    handleCommand: async (cmdArgs) => {
      if (inputMode.isLLM()) {
        return "Message sent!";
      } else if (inputMode.isDebug()) {
        inputMode.setLLM();
        // Dont say specifically mail/chat was used for admin message so agent can choose from available reply methods (mail/chat/comment)
        await contextManager.append(`Message from admin: ${cmdArgs}`);
        inputMode.setDebug();
        return "";
      }
      return "";
    },
  };

  const commands: RegistrableCommand[] = [nsContext, nsTalk];

  const supervisorPort = globalConfig.globalConfig().supervisorPort;
  if (supervisorPort) {
    const nsAdminPw: RegistrableCommand = {
      command: superadminPasswordCmd,
      handleCommand: (cmdArgs) => {
        const serverUrl = import.meta.resolve("@naisys-supervisor/server");
        const serverPath = fileURLToPath(serverUrl);

        const args = [serverPath, "--reset-password"];
        const parts = cmdArgs.trim().split(/\s+/);
        args.push("--username", "superadmin");
        if (parts[0]) {
          args.push("--password", parts[0]);
        }

        const result = spawnSync("node", args, {
          stdio: "inherit",
        });

        if (result.status !== 0) {
          return `Reset password failed with exit code ${result.status}`;
        }

        return "Password reset complete.";
      },
    };

    commands.push(nsAdminPw);
  }

  return commands;
}
