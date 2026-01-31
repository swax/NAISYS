import { DatabaseService } from "@naisys/database";
import { createCommandHandler } from "../command/commandHandler.js";
import { createCommandLoop } from "../command/commandLoop.js";
import { createCommandProtection } from "../command/commandProtection.js";
import { createCommandRegistry } from "../command/commandRegistry.js";
import { createDebugCommands } from "../command/debugCommand.js";
import { createPromptBuilder } from "../command/promptBuilder.js";
import { createShellCommand } from "../command/shellCommand.js";
import { createShellWrapper } from "../command/shellWrapper.js";
import { createGenImg } from "../features/genImg.js";
import { createLynxService } from "../features/lynx.js";
import { createSessionService } from "../features/session.js";
import { createSubagentService } from "../features/subagent.js";
import { createWorkspacesFeature } from "../features/workspaces.js";
import { GlobalConfig } from "../globalConfig.js";
import { HubClient } from "../hub/hubClient.js";
import { createCommandTools } from "../llm/commandTool.js";
import { createContextManager } from "../llm/contextManager.js";
import { createCostTracker } from "../llm/costTracker.js";
import { createLLModels } from "../llm/llModels.js";
import { createLLMService } from "../llm/llmService.js";
import { createSessionCompactor } from "../llm/sessionCompactor.js";
import { createSystemMessage } from "../llm/systemMessage.js";
import { createMailService } from "../mail/mail.js";
import { createMailAddress } from "../mail/mailAddress.js";
import { createMailDisplayService } from "../mail/mailDisplayService.js";
import { HostService } from "../services/hostService.js";
import { createLogService } from "../services/logService.js";
import { createRunService } from "../services/runService.js";
import { getPlatformConfig } from "../services/shellPlatform.js";
import { createInputMode } from "../utils/inputMode.js";
import { createOutputService } from "../utils/output.js";
import { createPromptNotificationService } from "../utils/promptNotificationService.js";
import { createAgentConfig } from "./agentConfig.js";
import { IAgentManager } from "./agentManagerInterface.js";
import { UserService } from "./userService.js";

export async function createAgentRuntime(
  agentManager: IAgentManager,
  localUserId: string,
  dbService: DatabaseService,
  globalConfig: GlobalConfig,
  hostService: HostService,
  hubClient: HubClient,
  userService: UserService,
) {
  /*
   * Simple form of dependency injection
   * actually a bit better than the previous module system as this implicitly prevents cirucular dependencies
   * We can also see from this why modern dependency injection frameworks exist
   */

  // Base services
  const agentConfig = createAgentConfig(localUserId, globalConfig, userService);

  const runService = await createRunService(
    agentConfig,
    globalConfig,
    hubClient,
    localUserId,
  );
  const logService = createLogService(
    globalConfig,
    hubClient,
    runService,
    localUserId,
  );
  const output = createOutputService(logService);

  // Shell and workspaces (needed by contextManager)
  const shellWrapper = createShellWrapper(globalConfig, agentConfig, output);
  const workspaces = createWorkspacesFeature(shellWrapper);

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
    hostService,
    localUserId,
  );
  const contextManager = createContextManager(
    agentConfig,
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
  const mailAddress = createMailAddress(dbService);
  const mailDisplayService = createMailDisplayService(
    dbService,
    mailAddress,
    localUserId,
  );
  const promptNotification = createPromptNotificationService();
  const mailService = createMailService(
    globalConfig,
    agentConfig,
    dbService,
    hostService,
    mailAddress,
    mailDisplayService,
    localUserId,
    promptNotification,
    contextManager,
  );
  const subagentService = createSubagentService(
    agentConfig,
    mailService,
    output,
    agentManager,
    inputMode,
    userService,
    localUserId,
    promptNotification,
    contextManager,
  );
  const lynxService = createLynxService(
    globalConfig,
    agentConfig,
    llmService,
    costTracker,
    llModels,
    output,
  );
  // Command components
  const platformConfig = getPlatformConfig();
  const promptBuilder = createPromptBuilder(
    globalConfig,
    agentConfig,
    shellWrapper,
    contextManager,
    output,
    inputMode,
    platformConfig,
    promptNotification,
  );
  const shellCommand = createShellCommand(
    globalConfig,
    shellWrapper,
    contextManager,
    inputMode,
  );
  const sessionService = createSessionService(
    globalConfig,
    agentConfig,
    sessionCompactor,
    shellCommand,
    mailService,
    output,
    inputMode,
  );
  const commandProtection = createCommandProtection(
    globalConfig,
    agentConfig,
    promptBuilder,
    llmService,
    output,
  );
  // Debug commands
  const debugCommands = createDebugCommands(
    agentConfig,
    contextManager,
    output,
    inputMode,
    systemMessage,
  );

  const commandRegistry = createCommandRegistry([
    lynxService,
    genimg,
    subagentService,
    mailService,
    costTracker,
    sessionService,
    hostService,
    workspaces,
    ...debugCommands,
    agentConfig,
  ]);
  const commandHandler = createCommandHandler(
    globalConfig,
    agentConfig,
    commandProtection,
    promptBuilder,
    shellCommand,
    commandRegistry,
    contextManager,
    output,
    inputMode,
  );
  const commandLoop = createCommandLoop(
    globalConfig,
    agentConfig,
    commandHandler,
    promptBuilder,
    shellCommand,
    lynxService,
    sessionCompactor,
    contextManager,
    workspaces,
    llmService,
    systemMessage,
    output,
    logService,
    inputMode,
    runService,
    promptNotification,
  );

  const abortController = new AbortController();

  const config = agentConfig.agentConfig();

  return {
    agentUserId: localUserId,
    agentUsername: config.username,
    agentTitle: config.title,
    agentTaskDescription: config.taskDescription,
    output,
    subagentService,
    promptNotification,
    runCommandLoop: () => commandLoop.run(abortController.signal),
    requestShutdown: async (reason: string) => {
      abortController.abort(reason);

      // Wait a bit for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, 5000));
    },
    completeShutdown: (reason: string) => {
      logService.cleanup();
      subagentService.cleanup(reason);
      mailService.cleanup();
    },
  };
}

export type AgentRuntime = Awaited<ReturnType<typeof createAgentRuntime>>;
