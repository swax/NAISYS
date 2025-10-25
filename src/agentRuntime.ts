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
import { createCommandTools } from "./llm/commandTool.js";
import { createContextManager } from "./llm/contextManager.js";
import { createCostTracker } from "./llm/costTracker.js";
import { createDreamMaker } from "./llm/dreamMaker.js";
import { createLLModels } from "./llm/llModels.js";
import { createLLMService } from "./llm/llmService.js";
import { createSystemMessage } from "./llm/systemMessage.js";
import { createDatabaseService } from "./services/dbService.js";
import { createLogService } from "./services/logService.js";
import { createOutputService } from "./utils/output.js";

export async function createAgentRuntime(_agentPath: string) {
  const config = await loadConfigFromPath(_agentPath);

  /*
   * Simple form of dependency injection
   * actually a bit better than the previous module system as this implicitly prevents cirucular dependencies
   * We can also see from this why modern dependency injection frameworks exist
   */

  const dbService = await createDatabaseService();
  const logService = createLogService(dbService);
  const output = createOutputService(logService);
  const workspaces = createWorkspacesFeature(output);

  // LLM
  const systemMessage = createSystemMessage();
  const llModels = createLLModels();
  const tools = createCommandTools();
  const costTracker = createCostTracker(llModels, dbService, output);
  const contextManager = createContextManager(
    workspaces,
    systemMessage,
    output,
    logService,
  );
  const llmService = createLLMService(costTracker, tools, llModels);
  const dreamMaker = createDreamMaker(
    contextManager,
    llmService,
    dbService,
    output,
  );

  // Features
  const genimg = createGenImg(costTracker, output);
  const llmail = createLLMail(dbService);
  const subagentService = createSubagentService(llmail, output);
  const llmynx = createLLMynx(llmService, costTracker, llModels, output);

  // Command components
  const shellWrapper = createShellWrapper(output);
  const promptBuilder = createPromptBuilder(
    shellWrapper,
    subagentService,
    llmail,
    contextManager,
    output,
  );
  const shellCommand = createShellCommand(shellWrapper, contextManager);
  const commandProtection = createCommandProtection(
    promptBuilder,
    llmService,
    output,
  );
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
    costTracker,
    output,
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
    llmService,
    systemMessage,
    output,
    logService,
  );

  return {
    commandLoop,
  };
}
