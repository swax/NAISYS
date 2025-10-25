import { createCommandHandler } from "./command/commandHandler.js";
import { createCommandLoop } from "./command/commandLoop.js";
import { createCommandProtection } from "./command/commandProtection.js";
import { createPromptBuilder } from "./command/promptBuilder.js";
import { createShellCommand } from "./command/shellCommand.js";
import { createShellWrapper } from "./command/shellWrapper.js";
import { loadConfigFromPath } from "./config.js";
import { createGenImg } from "./features/genimg.js";
import { createLLMail } from "./features/llmail.js";
import { createLLMynx } from "./features/llmynx.js";
import { createSubagentService } from "./features/subagent.js";
import { createWorkspacesFeature } from "./features/workspaces.js";
import { createContextManager } from "./llm/contextManager.js";
import { createDreamMaker } from "./llm/dreamMaker.js";

export async function createAgentRuntime(_agentPath: string) {
  const config = await loadConfigFromPath(_agentPath);

  /* 
   * Simple form of dependency injection
   * actually a bit better than the previous module system as this implicitly prevents cirucular dependencies
   * We can also see from this why modern dependency injection frameworks exist
   */

  const workspaces = createWorkspacesFeature();

  // LLM
  const contextManager = createContextManager(workspaces);
  const dreamMaker = createDreamMaker(contextManager);

  // Features
  const genimg = createGenImg();
  const llmail = createLLMail();
  const subagentService = createSubagentService(llmail);
  const llmynx = createLLMynx();

  // Command components
  const shellWrapper = createShellWrapper();
  const promptBuilder = createPromptBuilder(
    shellWrapper,
    subagentService,
    llmail,
    contextManager,
  );
  const shellCommand = createShellCommand(shellWrapper, contextManager);
  const commandProtection = createCommandProtection(promptBuilder);
  const commandHandler = createCommandHandler(
    config,
    commandProtection,
    promptBuilder,
    shellCommand,
    genimg,
    subagentService,
    llmail,
    llmynx,
    dreamMaker,
    contextManager,
  );
  const commandLoop = createCommandLoop(
    config,
    commandHandler,
    promptBuilder,
    shellCommand,
    subagentService,
    llmail,
    llmynx,
    dreamMaker,
    contextManager,
    workspaces,
  );

  return {
    commandLoop,
  };
}
