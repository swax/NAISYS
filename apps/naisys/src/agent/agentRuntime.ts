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
import { createCostDisplayService } from "../llm/costDisplayService.js";
import { createCostTracker } from "../llm/costTracker.js";
import { createLLModels } from "../llm/llModels.js";
import { createLLMService } from "../llm/llmService.js";
import { createSessionCompactor } from "../llm/sessionCompactor.js";
import { createSystemMessage } from "../llm/systemMessage.js";
import { createMailService } from "../mail/mail.js";
import { createMailDisplayService } from "../mail/mailDisplayService.js";
import { createLogService } from "../services/logService.js";
import { createRunService } from "../services/runService.js";
import { getPlatformConfig } from "../services/shellPlatform.js";
import { createInputMode } from "../utils/inputMode.js";
import { createOutputService } from "../utils/output.js";
import { PromptNotificationService } from "../utils/promptNotificationService.js";
import { createAgentConfig } from "./agentConfig.js";
import { IAgentManager } from "./agentManagerInterface.js";
import { createUserDisplayService } from "./userDisplayService.js";
import { UserService } from "./userService.js";

export async function createAgentRuntime(
  agentManager: IAgentManager,
  localUserId: string,
  globalConfig: GlobalConfig,
  hubClient: HubClient | undefined,
  userService: UserService,
  promptNotification: PromptNotificationService,
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
    hubClient,
    localUserId,
  );
  const logService = createLogService(hubClient, runService, localUserId);
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
    runService,
    hubClient,
    localUserId,
  );
  const costDisplayService = createCostDisplayService(
    globalConfig,
    agentConfig,
    costTracker,
    llModels,
    output,
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
  const userDisplayService = createUserDisplayService(userService, inputMode);
  const mailDisplayService = hubClient
    ? createMailDisplayService(hubClient, localUserId)
    : null;
  const mailService = createMailService(
    globalConfig,
    agentConfig,
    hubClient,
    userService,
    mailDisplayService,
    localUserId,
    promptNotification,
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
    hubClient,
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
    localUserId,
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
    agentConfig,
    promptBuilder,
    llmService,
    output,
  );

  const debugCommands = createDebugCommands(
    contextManager,
    output,
    inputMode,
    systemMessage,
  );

  const commandRegistry = createCommandRegistry(inputMode, [
    lynxService,
    genimg,
    subagentService,
    mailService,
    costDisplayService,
    sessionService,
    workspaces,
    userDisplayService,
    ...debugCommands,
    agentConfig,
    ...(hubClient ? [hubClient] : []),
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
    localUserId,
  );

  const abortController = new AbortController();

  const config = agentConfig.agentConfig();

  return {
    agentUserId: localUserId,
    agentUsername: config.username,
    agentTitle: config.title,
    output,
    subagentService,
    runCommandLoop: () => commandLoop.run(abortController.signal),
    requestShutdown: async (reason: string) => {
      abortController.abort(reason);

      // Wait a bit for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, 5000));
    },
    completeShutdown: (reason: string) => {
      costTracker.cleanup();
      logService.cleanup();
      subagentService.cleanup(reason);
      mailService.cleanup();
    },
  };
}

export type AgentRuntime = Awaited<ReturnType<typeof createAgentRuntime>>;
