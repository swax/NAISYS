import { SUPER_ADMIN_USERNAME } from "@naisys/common";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

import type { IAgentManager } from "../agent/agentManagerInterface.js";
import type { GlobalConfig } from "../globalConfig.js";
import type { ContextManager } from "../llm/contextManager.js";
import type { LlmRole } from "../llm/llmDtos.js";
import type { InputModeService } from "../utils/inputMode.js";
import type { OutputService } from "../utils/output.js";
import {
  contextCmd,
  exitCmd,
  superadminPasswordCmd,
  talkCmd,
} from "./commandDefs.js";
import type { CommandResponse, RegistrableCommand } from "./commandRegistry.js";
import { NextCommandAction } from "./commandRegistry.js";

export function createDebugCommands(
  globalConfig: GlobalConfig,
  contextManager: ContextManager,
  output: OutputService,
  inputMode: InputModeService,
  systemMessage: string,
  agentManager: IAgentManager,
  localUserId: number,
): RegistrableCommand[] {
  function roleToString(role: LlmRole) {
    switch (role) {
      case "assistant":
        return "LLM/Assistant";
      case "user":
        return "NAISYS/User";
      case "system":
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
    handleCommand: (cmdArgs) => {
      if (inputMode.isLLM()) {
        return "Message sent!";
      } else if (inputMode.isDebug()) {
        inputMode.setLLM();
        // Dont say specifically mail/chat was used for admin message so agent can choose from available reply methods (mail/chat/comment)
        contextManager.append(`Message from admin: ${cmdArgs}`);
        inputMode.setDebug();
        return "";
      }
      return "";
    },
  };

  const nsExit: RegistrableCommand = {
    command: exitCmd,
    handleCommand: async (cmdArgs): Promise<CommandResponse> => {
      if (cmdArgs.trim() === "all") {
        const otherAgents = agentManager.runningAgents.filter(
          (a) => a.agentUserId !== localUserId,
        );

        output.comment(
          `Stopping agents: ${otherAgents.map((a) => a.agentUsername).join(", ")}...`,
        );
        await Promise.all(
          otherAgents.map((agent) =>
            agentManager.stopAgent(agent.agentUserId, "exit all"),
          ),
        );

        output.comment(`Stopped ${otherAgents.length} agent(s)`);
      }

      return {
        content: "",
        nextCommandResponse: {
          nextCommandAction: NextCommandAction.ExitApplication,
        },
      };
    },
  };

  const commands: RegistrableCommand[] = [nsContext, nsTalk, nsExit];

  if (globalConfig.globalConfig().supervisorUrl) {
    const nsAdminPw: RegistrableCommand = {
      command: superadminPasswordCmd,
      handleCommand: (cmdArgs) => {
        const serverUrl = import.meta.resolve("@naisys/supervisor");
        const serverPath = fileURLToPath(serverUrl);

        const args = [serverPath, "--reset-password"];
        const parts = cmdArgs.trim().split(/\s+/);
        args.push("--username", SUPER_ADMIN_USERNAME);
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
