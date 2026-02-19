import { AgentConfig } from "../agent/agentConfig.js";
import { UserService } from "../agent/userService.js";
import { GlobalConfig } from "../globalConfig.js";
import { ContextManager } from "../llm/contextManager.js";
import { LlmRole } from "../llm/llmDtos.js";
import { InputModeService } from "../utils/inputMode.js";
import { OutputService } from "../utils/output.js";
import { RegistrableCommand } from "./commandRegistry.js";

export function createDebugCommands(
  globalConfig: GlobalConfig,
  agentConfig: AgentConfig,
  userService: UserService,
  localUserId: number,
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
      commandName: "ns-admin-pw",
      helpText: "Change the supervisor admin password: ns-admin-pw <newpassword>",
      isDebug: true,
      handleCommand: async (cmdArgs) => {
        const username = agentConfig.agentConfig().username;
        if (username !== "admin") {
          return "Only the admin agent can change the admin password.";
        }

        const newPassword = cmdArgs.trim();
        if (!newPassword || newPassword.length < 6) {
          return "Usage: ns-admin-pw <password> (minimum 6 characters)";
        }

        const apiKey = userService.getUserById(localUserId)?.apiKey;
        if (!apiKey) {
          return "No API key available. Cannot authenticate with supervisor.";
        }

        try {
          const response = await fetch(
            `http://localhost:${supervisorPort}/api/supervisor/users/me/password`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
              },
              body: JSON.stringify({ password: newPassword }),
            },
          );

          if (!response.ok) {
            const body = await response.text();
            return `Failed to change password: ${response.status} ${body}`;
          }

          return "Admin password changed successfully.";
        } catch (err) {
          return `Failed to change password: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    };

    commands.push(nsAdminPw);
  }

  return commands;
}
