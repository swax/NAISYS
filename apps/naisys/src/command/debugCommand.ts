import { GlobalConfig } from "../globalConfig.js";
import { ContextManager } from "../llm/contextManager.js";
import { LlmRole } from "../llm/llmDtos.js";
import { InputModeService } from "../utils/inputMode.js";
import { OutputService } from "../utils/output.js";
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
    commandName: "ns-context",
    helpText: "Print the current LLM context",
    isDebug: true,
    handleCommand: () => {
      output.comment("#####################");
      output.comment(printContext());
      output.comment("#####################");
      return Promise.resolve("");
    },
  };

  const nsTalk: RegistrableCommand = {
    commandName: "ns-talk",
    helpText: "Send a message to the agent",
    isDebug: true,
    handleCommand: async (cmdArgs) => {
      if (inputMode.isLLM()) {
        return "Message sent!";
      } else if (inputMode.isDebug()) {
        inputMode.setLLM();
        await contextManager.append(
          `Message from admin: ${cmdArgs}. Respond via the ns-mail command.`,
        );
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
      commandName: "ns-reset-superadmin-password",
      helpText:
        "Change the supervisor superadmin password: ns-reset-superadmin-password <newpassword>",
      isDebug: true,
      handleCommand: async (cmdArgs) => {
        return "todo";
      },
    };

    commands.push(nsAdminPw);
  }

  return commands;
}
