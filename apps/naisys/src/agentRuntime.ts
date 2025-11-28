import { createAgentConfig } from "./agentConfig.js";
import { AgentManager } from "./agentManager.js";
import { createCommandHandler } from "./command/commandHandler.js";
import { createCommandLoop } from "./command/commandLoop.js";
import { createCommandProtection } from "./command/commandProtection.js";
import { createPromptBuilder } from "./command/promptBuilder.js";
import { createShellCommand } from "./command/shellCommand.js";
import { createShellWrapper } from "./command/shellWrapper.js";
import { createGenImg } from "./features/genimg.js";
import { createLLMail } from "./features/llmail.js";
import { createLLMynx } from "./features/llmynx.js";
import { createSubagentService } from "./features/subagent.js";
import { createWorkspacesFeature } from "./features/workspaces.js";
import { createCommandTools } from "./llm/commandTool.js";
import { createContextManager } from "./llm/contextManager.js";
import { createCostTracker } from "./llm/costTracker.js";
import { createSessionCompactor } from "./llm/sessionCompactor.js";
import { createLLModels } from "./llm/llModels.js";
import { createLLMService } from "./llm/llmService.js";
import { createSystemMessage } from "./llm/systemMessage.js";
import { createLogService } from "./services/logService.js";
import { createRunService } from "./services/runService.js";
import { createInputMode } from "./utils/inputMode.js";
import { createOutputService } from "./utils/output.js";

export async function createAgentRuntime(
  agentManger: AgentManager,
  agentPath: string,
) {
  const dbService = agentManger.dbService;
  const globalConfig = agentManger.globalConfig;

  /*
   * Simple form of dependency injection
   * actually a bit better than the previous module system as this implicitly prevents cirucular dependencies
   * We can also see from this why modern dependency injection frameworks exist
   */

  // Base services
  const agentConfig = createAgentConfig(agentPath, globalConfig);

  const runService = await createRunService(
    globalConfig,
    agentConfig,
    dbService,
  );
  const logService = createLogService(dbService, runService);
  const output = createOutputService(logService);
  const workspaces = createWorkspacesFeature(globalConfig, agentConfig, output);

  // LLM
  const inputMode = createInputMode();
  const systemMessage = createSystemMessage(globalConfig, agentConfig);
  const llModels = createLLModels(globalConfig);
  const tools = createCommandTools(agentConfig);
  const costTracker = createCostTracker(
    globalConfig,
    agentConfig,
    llModels,
    dbService,
    runService,
    output,
  );
  const contextManager = createContextManager(
    globalConfig,
    workspaces,
    systemMessage,
    output,
    logService,
    inputMode,
  );
  const llmService = createLLMService(
    globalConfig,
    agentConfig,
    costTracker,
    tools,
    llModels,
  );
  const sessionCompactor = createSessionCompactor(
    agentConfig,
    contextManager,
    llmService,
    output,
  );

  // Features
  const genimg = createGenImg(agentConfig, costTracker, output);
  const llmail = createLLMail(globalConfig, agentConfig, dbService, runService);
  const subagentService = createSubagentService(
    agentConfig,
    llmail,
    output,
    agentManger,
    inputMode,
    runService,
    dbService,
  );
  const llmynx = createLLMynx(
    globalConfig,
    agentConfig,
    llmService,
    costTracker,
    llModels,
    output,
  );

  // Command components
  const shellWrapper = createShellWrapper(globalConfig, agentConfig, output);
  const promptBuilder = createPromptBuilder(
    globalConfig,
    agentConfig,
    shellWrapper,
    subagentService,
    llmail,
    contextManager,
    output,
    inputMode,
  );
  const shellCommand = createShellCommand(
    globalConfig,
    shellWrapper,
    contextManager,
    inputMode,
  );
  const commandProtection = createCommandProtection(
    globalConfig,
    agentConfig,
    promptBuilder,
    llmService,
    output,
  );
  const commandHandler = createCommandHandler(
    globalConfig,
    agentConfig,
    commandProtection,
    promptBuilder,
    shellCommand,
    genimg,
    subagentService,
    llmail,
    llmynx,
    sessionCompactor,
    contextManager,
    costTracker,
    output,
    inputMode,
    runService,
  );
  const commandLoop = createCommandLoop(
    globalConfig,
    agentConfig,
    commandHandler,
    promptBuilder,
    shellCommand,
    subagentService,
    llmail,
    llmynx,
    sessionCompactor,
    contextManager,
    workspaces,
    llmService,
    systemMessage,
    output,
    logService,
    inputMode,
    runService,
  );

  const abortController = new AbortController();

  return {
    agentRunId: runService.getRunId(),
    agentUsername: agentConfig.agentConfig().username,
    agentTaskDescription: agentConfig.agentConfig().taskDescription,
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
      runService.cleanup();
      subagentService.cleanup(reason);
    },
  };
}

export type AgentRuntime = Awaited<ReturnType<typeof createAgentRuntime>>;
