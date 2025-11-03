import { AgentManager } from "./agentManager.js";
import { createCommandHandler } from "./command/commandHandler.js";
import { createCommandLoop } from "./command/commandLoop.js";
import { createCommandProtection } from "./command/commandProtection.js";
import { createPromptBuilder } from "./command/promptBuilder.js";
import { createShellCommand } from "./command/shellCommand.js";
import { createShellWrapper } from "./command/shellWrapper.js";
import { createConfig } from "./config.js";
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
import { createInputMode } from "./utils/inputMode.js";
import { createOutputService } from "./utils/output.js";

let runtimeId = 1;

export async function createAgentRuntime(
  agentManger: AgentManager,
  agentPath: string,
) {
  /*
   * Simple form of dependency injection
   * actually a bit better than the previous module system as this implicitly prevents cirucular dependencies
   * We can also see from this why modern dependency injection frameworks exist
   */

  const agentRuntimeId = runtimeId++;

  // Base services
  const config = await createConfig(agentPath, agentRuntimeId);
  const dbService = await createDatabaseService(config);
  const logService = createLogService(config, dbService);
  const output = createOutputService(logService);
  const workspaces = createWorkspacesFeature(config, output);

  // LLM
  const inputMode = createInputMode();
  const systemMessage = createSystemMessage(config);
  const llModels = createLLModels(config);
  const tools = createCommandTools(config);
  const costTracker = createCostTracker(config, llModels, dbService, output);
  const contextManager = createContextManager(
    config,
    workspaces,
    systemMessage,
    output,
    logService,
    inputMode,
  );
  const llmService = createLLMService(config, costTracker, tools, llModels);
  const dreamMaker = createDreamMaker(
    config,
    contextManager,
    llmService,
    dbService,
    output,
  );

  // Features
  const genimg = createGenImg(config, costTracker, output);
  const llmail = createLLMail(config, dbService);
  const subagentService = createSubagentService(
    config,
    llmail,
    output,
    agentManger,
    inputMode,
  );
  const llmynx = createLLMynx(
    config,
    llmService,
    costTracker,
    llModels,
    output,
  );

  // Command components
  const shellWrapper = createShellWrapper(config, output);
  const promptBuilder = createPromptBuilder(
    config,
    shellWrapper,
    subagentService,
    llmail,
    contextManager,
    output,
    inputMode,
  );
  const shellCommand = createShellCommand(
    config,
    shellWrapper,
    contextManager,
    inputMode,
  );
  const commandProtection = createCommandProtection(
    config,
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
    inputMode,
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
    inputMode,
  );

  const abortController = new AbortController();

  return {
    agentRuntimeId,
    config,
    output,
    subagentService,
    runCommandLoop: () => commandLoop.run(abortController.signal),
    requestShutdown: async (reason: string) => {
      abortController.abort(reason);

      // Wait a bit for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, 5000));
    },
    completeShutdown: (reason: string) => {
      // Cleanup database interval
      dbService.cleanup();
      subagentService.cleanup(reason);
    },
  };
}

export type AgentRuntime = Awaited<ReturnType<typeof createAgentRuntime>>;
