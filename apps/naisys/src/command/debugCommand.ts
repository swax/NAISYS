import { AgentConfig } from "../agent/agentConfig.js";
import { ContextManager } from "../llm/contextManager.js";
import { InputModeService } from "../utils/inputMode.js";
import { OutputService } from "../utils/output.js";
import { RegistrableCommand } from "./commandRegistry.js";

export function createDebugCommands(
  agentConfig: AgentConfig,
  contextManager: ContextManager,
  output: OutputService,
  inputMode: InputModeService,
): RegistrableCommand[] {
  const nsContext: RegistrableCommand = {
    commandName: "ns-context",
    helpText: "Print the current LLM context",
    isDebug: true,
    handleCommand: () => {
      output.comment("#####################");
      output.comment(contextManager.printContext());
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
        const respondCommand = agentConfig.agentConfig().mailEnabled
          ? "ns-mail"
          : "ns-talk";
        await contextManager.append(
          `Message from admin: ${cmdArgs}. Respond via the ${respondCommand} command.`,
        );
        inputMode.setDebug();
        return "";
      }
      return "";
    },
  };

  return [nsContext, nsTalk];
}
