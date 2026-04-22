import { ADMIN_USERNAME } from "@naisys/common";

import type { IAgentManager } from "../agent/agentManagerInterface.js";
import type { ContextManager } from "../llm/contextManager.js";
import type { LlmRole } from "../llm/llmDtos.js";
import type { InputModeService } from "../utils/inputMode.js";
import type { OutputService } from "../utils/output.js";
import { contextCmd, exitCmd, pauseCmd, talkCmd } from "./commandDefs.js";
import type { CommandResponse, RegistrableCommand } from "./commandRegistry.js";
import { NextCommandAction } from "./commandRegistry.js";

export function createDebugCommands(
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

  let firstTalkMessage = true;

  const nsTalk: RegistrableCommand = {
    command: talkCmd,
    handleCommand: (cmdArgs): CommandResponse => {
      if (inputMode.isLLM()) {
        return { content: "Message sent!" };
      } else if (inputMode.isDebug()) {
        inputMode.setLLM();
        // Dont say specifically mail/chat was used for admin message so agent can choose from available reply methods (mail/chat/comment)
        contextManager.append(`Message from ${ADMIN_USERNAME}: ${cmdArgs}`);
        if (firstTalkMessage) {
          contextManager.append(
            `Reply with: ns-chat send ${ADMIN_USERNAME} "<message>"`,
          );
          firstTalkMessage = false;
        }
        inputMode.setDebug();
        return {
          content: "",
          nextCommandResponse: {
            nextCommandAction: NextCommandAction.Continue,
            triggerLlm: true,
          },
        };
      }
      return { content: "" };
    },
  };

  const nsPause: RegistrableCommand = {
    command: pauseCmd,
    handleCommand: (cmdArgs) => {
      const agent = agentManager.runningAgents.find(
        (a) => a.agentUserId === localUserId,
      );
      if (!agent) {
        return "Agent not running";
      }
      const arg = cmdArgs.trim().toLowerCase();
      const next =
        arg === "on" ? true : arg === "off" ? false : !agent.isPaused();
      const changed = agent.setPaused(next);
      return changed
        ? `Session ${next ? "paused" : "resumed"}`
        : `Session already ${next ? "paused" : "resumed"}`;
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
        await agentManager.stopAll("exit all", localUserId);

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

  return [nsContext, nsTalk, nsPause, nsExit];
}
