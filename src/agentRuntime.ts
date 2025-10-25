import { createCommandHandler } from "./command/commandHandler.js";
import { createCommandLoop } from "./command/commandLoop.js";
import { createCommandProtection } from "./command/commandProtection.js";
import { createPromptBuilder } from "./command/promptBuilder.js";
import { loadConfigFromPath } from "./config.js";

export async function createAgentRuntime(_agentPath: string) {
  const config = await loadConfigFromPath(_agentPath);

  // Simple form of dependency injection
  const promptBuilder = createPromptBuilder();
  const commandProtection = createCommandProtection(promptBuilder);
  const commandHandler = createCommandHandler(
    config,
    commandProtection,
    promptBuilder,
  );
  const commandLoop = createCommandLoop(config, commandHandler, promptBuilder);

  return {
    commandLoop,
  };
}
