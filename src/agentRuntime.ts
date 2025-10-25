import { createCommandHandler } from "./command/commandHandler.js";
import { createCommandLoop } from "./command/commandLoop.js";
import { createCommandProtection } from "./command/commandProtection.js";
import { createPromptBuilder } from "./command/promptBuilder.js";
import { createShellCommand } from "./command/shellCommand.js";
import { createShellWrapper } from "./command/shellWrapper.js";
import { loadConfigFromPath } from "./config.js";

export async function createAgentRuntime(_agentPath: string) {
  const config = await loadConfigFromPath(_agentPath);

  // Simple form of dependency injection
  const shellWrapper = createShellWrapper();
  const promptBuilder = createPromptBuilder(shellWrapper);
  const shellCommand = createShellCommand(shellWrapper);
  const commandProtection = createCommandProtection(promptBuilder);
  const commandHandler = createCommandHandler(
    config,
    commandProtection,
    promptBuilder,
    shellCommand,
  );
  const commandLoop = createCommandLoop(
    config,
    commandHandler,
    promptBuilder,
    shellCommand,
  );

  return {
    commandLoop,
  };
}
