import { commentCmd } from "../command/commandDefs.js";
import { createCommandHandler } from "../command/commandHandler.js";
import { createCommandLoop } from "../command/commandLoop.js";
import { createCommandProtection } from "../command/commandProtection.js";
import { createCommandRegistry } from "../command/commandRegistry.js";
import { createDebugCommands } from "../command/debugCommand.js";
import { createPromptBuilder } from "../command/promptBuilder.js";
import { createShellCommand } from "../command/shellCommand.js";
import { createShellWrapper } from "../command/shellWrapper.js";
import { createComputerService } from "../computer-use/computerService.js";
import { createDesktopService } from "../computer-use/desktop.js";
import { createGenImg } from "../features/genImg.js";
import { createListenService } from "../features/listen.js";
import { createLookService } from "../features/look.js";
import { createLynxService } from "../features/lynx.js";
import { createSessionService } from "../features/session.js";
import { createSubagentService } from "../features/subagent.js";
import { createWorkspacesFeature } from "../features/workspaces.js";
import type { GlobalConfig } from "../globalConfig.js";
import type { HubClient } from "../hub/hubClient.js";
import type { HubCostBuffer } from "../hub/hubCostBuffer.js";
import type { HubLogBuffer } from "../hub/hubLogBuffer.js";
import { createCommandTools } from "../llm/commandTool.js";
import { createContextManager } from "../llm/contextManager.js";
import { createCostDisplayService } from "../llm/costDisplayService.js";
import { createCostTracker } from "../llm/costTracker.js";
import { createLLMService } from "../llm/llmService.js";
import { createSystemMessage } from "../llm/systemMessage.js";
import { createChatService } from "../mail/chat.js";
import { createMailService } from "../mail/mail.js";
import { createMailDisplayService } from "../mail/mailDisplayService.js";
import { createAttachmentService } from "../services/attachmentService.js";
import type { HostService } from "../services/hostService.js";
import { createLogService } from "../services/logService.js";
import type { ModelService } from "../services/modelService.js";
import { createRunService } from "../services/runService.js";
import { getPlatformConfig } from "../services/shellPlatform.js";
import { createInputMode } from "../utils/inputMode.js";
import { createOutputService } from "../utils/output.js";
import type { PromptNotificationService } from "../utils/promptNotificationService.js";
import { createAgentConfig } from "./agentConfig.js";
import type { IAgentManager } from "./agentManagerInterface.js";
import { createUserDisplayService } from "./userDisplayService.js";
import type { UserService } from "./userService.js";

export async function createAgentRuntime(
  agentManager: IAgentManager,
  localUserId: number,
  globalConfig: GlobalConfig,
  hubClient: HubClient | undefined,
  hubCostBuffer: HubCostBuffer | undefined,
  hubLogBuffer: HubLogBuffer | undefined,
  hostService: HostService,
  userService: UserService,
  modelService: ModelService,
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
  const attachmentService = createAttachmentService(
    hubClient,
    userService,
    localUserId,
  );
  const logService = createLogService(
    hubLogBuffer,
    runService,
    localUserId,
    attachmentService,
  );
  const output = createOutputService(logService);

  // Shell and workspaces (needed by contextManager)
  const shellWrapper = createShellWrapper(
    globalConfig,
    agentConfig,
    output,
    userService,
    localUserId,
  );
  const workspaces = createWorkspacesFeature(shellWrapper);

  // LLM
  const inputMode = createInputMode();
  const systemMessage = createSystemMessage(
    globalConfig,
    agentConfig,
    modelService,
  );
  const tools = createCommandTools(agentConfig);
  const costTracker = createCostTracker(
    globalConfig,
    agentConfig,
    modelService,
    runService,
    hubClient,
    hubCostBuffer,
    localUserId,
    promptNotification,
  );
  const costDisplayService = createCostDisplayService(
    globalConfig,
    agentConfig,
    costTracker,
    modelService,
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
  const computerService = await createComputerService(agentConfig);
  const llmService = createLLMService(
    globalConfig,
    agentConfig,
    costTracker,
    tools,
    modelService,
    computerService,
  );

  // Features
  const lookService = createLookService(
    agentConfig,
    modelService,
    contextManager,
    llmService,
    shellWrapper,
  );
  const listenService = createListenService(
    agentConfig,
    modelService,
    contextManager,
    llmService,
    shellWrapper,
  );
  const desktopService = createDesktopService(
    computerService,
    contextManager,
    output,
    agentConfig,
    modelService,
  );
  const genimg = createGenImg(
    globalConfig,
    agentConfig,
    costTracker,
    output,
    modelService.getImageModel,
  );
  const userDisplayService = createUserDisplayService(
    userService,
    inputMode,
    localUserId,
  );
  const mailDisplayService = hubClient
    ? createMailDisplayService(hubClient, localUserId)
    : null;
  const mailService = createMailService(
    hubClient,
    userService,
    mailDisplayService,
    localUserId,
    promptNotification,
    attachmentService,
    shellWrapper,
    globalConfig,
    agentManager,
  );
  const chatService = createChatService(
    hubClient,
    userService,
    localUserId,
    promptNotification,
    attachmentService,
    shellWrapper,
  );
  const subagentService = createSubagentService(
    mailService,
    output,
    agentManager,
    inputMode,
    userService,
    localUserId,
    promptNotification,
    hubClient,
  );
  const lynxService = createLynxService(globalConfig, costTracker, output);
  // Command components
  const platformConfig = getPlatformConfig();
  const promptBuilder = createPromptBuilder(
    globalConfig,
    agentConfig,
    shellWrapper,
    contextManager,
    costTracker,
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
    shellCommand,
    output,
    contextManager,
    systemMessage,
    llmService,
    mailService,
    userService,
    localUserId,
  );
  const commandProtection = createCommandProtection(
    agentConfig,
    llmService,
    output,
  );

  const debugCommands = createDebugCommands(
    globalConfig,
    contextManager,
    output,
    inputMode,
    systemMessage,
    agentManager,
    localUserId,
  );

  const commentCommand = {
    command: commentCmd,
    handleCommand: () =>
      // Important - Hint the LLM to turn their thoughts into actions
      // ./bin/ns-comment shell script has the same message
      "Comment noted. Try running commands now to achieve your goal.",
  };

  const commandRegistry = createCommandRegistry(inputMode, [
    commentCommand,
    lynxService,
    genimg,
    desktopService,
    lookService,
    listenService,
    subagentService,
    mailService,
    chatService,
    costDisplayService,
    sessionService,
    workspaces,
    userDisplayService,
    ...debugCommands,
    agentConfig,
    ...(hubClient ? [hubClient, hostService] : []),
  ]);
  const commandHandler = createCommandHandler(
    globalConfig,
    agentConfig,
    commandProtection,
    promptBuilder,
    shellCommand,
    shellWrapper,
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
    mailService,
    chatService,
    hubClient,
    sessionService,
    modelService,
    desktopService,
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
    requestShutdown: (reason: string) => {
      abortController.abort(reason);
    },
    completeShutdown: () => {
      commandLoop.cleanup();
      costTracker.cleanup();
      mailService.cleanup();
      chatService.cleanup();
    },
  };
}

export type AgentRuntime = Awaited<ReturnType<typeof createAgentRuntime>>;
