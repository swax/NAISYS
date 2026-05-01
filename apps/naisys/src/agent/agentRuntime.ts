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
import { createBrowserService } from "../features/browser.js";
import { createGenImg } from "../features/genImg.js";
import { createListenService } from "../features/listen.js";
import { createLookService } from "../features/look.js";
import { createLynxService } from "../features/lynx.js";
import { createPtyService } from "../features/pty.js";
import { createSessionService } from "../features/session.js";
import { createSubagentService } from "../features/subagent.js";
import { createWebSearchService } from "../features/webSearch.js";
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
import { createMailQueryService } from "../mail/mailQueryService.js";
import { createAttachmentService } from "../services/attachmentService.js";
import type { HostService } from "../services/hostService.js";
import { createLogService } from "../services/logService.js";
import type { ModelService } from "../services/modelService.js";
import { createRunService } from "../services/runService.js";
import { getPlatformConfig } from "../services/shellPlatform.js";
import { createCommandLoopState } from "../utils/commandLoopState.js";
import { createInputMode } from "../utils/inputMode.js";
import { createOutputService } from "../utils/output.js";
import type { PromptNotificationService } from "../utils/promptNotificationService.js";
import { createAgentConfig } from "./agentConfig.js";
import type {
  IAgentManager,
  SubagentContext,
} from "./agentManagerInterface.js";
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
  runtimeApiKey?: string,
  subagentContext?: SubagentContext,
) {
  // For subagents, strip the hub surface so hub-aware services take their
  // local-mode branch. RunService keeps the parent's hubClient (as
  // sessionHubClient) so SESSION_CREATE/INCREMENT can register the
  // run_session row before any log or cost write references it.
  const sessionHubClient = hubClient;
  if (subagentContext) {
    hubLogBuffer = wrapLogBufferForSubagent(hubLogBuffer, subagentContext);
    hubCostBuffer = wrapCostBufferForSubagent(hubCostBuffer, subagentContext);
    hubClient = undefined;
  }

  /*
   * Per-agent composition root. Keep this as linear hand-wiring rather than a
   * DI container: construction order is dependency order, which keeps cycles
   * visible and makes late-binding choices explicit.
   */

  // Agent-local foundation: config, run identity, attachments, logs, output.
  const agentConfig = createAgentConfig(localUserId, globalConfig, userService);

  const runService = await createRunService(
    agentConfig,
    sessionHubClient,
    localUserId,
    subagentContext,
  );
  const attachmentService = createAttachmentService(hubClient, runtimeApiKey);
  const logService = createLogService(
    hubLogBuffer,
    runService,
    localUserId,
    attachmentService,
  );
  const output = createOutputService(logService);

  // Shell surface and workspace context.
  const shellWrapper = createShellWrapper(
    globalConfig,
    agentConfig,
    output,
    runtimeApiKey,
  );
  const workspaces = createWorkspacesFeature(shellWrapper);

  // Loop state, prompt context, cost tracking, and model access.
  const inputMode = createInputMode();
  const commandLoopState = createCommandLoopState(() => {
    // Immediate heartbeat so supervisors see state transitions within
    // roundtrip latency instead of waiting for the next interval tick
    agentManager.onHeartbeatNeeded?.();
  });
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
    subagentContext?.parentCostTracker,
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
    modelService,
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

  // Agent-facing feature commands.
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
    shellWrapper,
    commandLoopState,
    inputMode,
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
  const mailQueryService = hubClient
    ? createMailQueryService(hubClient, localUserId)
    : null;
  const mailService = createMailService(
    hubClient,
    userService,
    mailQueryService,
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
    agentConfig,
    runService,
    costTracker,
  );
  const lynxService = createLynxService(globalConfig, output);
  const browserService = createBrowserService(
    globalConfig,
    agentConfig,
    contextManager,
    output,
    modelService,
  );
  const webSearchService = createWebSearchService(
    globalConfig,
    agentConfig,
    costTracker,
    lynxService,
  );

  // Command dispatch and main loop.
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
    inputMode,
  );
  const ptyService = createPtyService(shellWrapper);
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
    commandLoopState,
  );

  const debugCommands = createDebugCommands(
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
    browserService,
    webSearchService,
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
    ptyService,
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
    commandLoopState,
  );
  const commandLoop = createCommandLoop(
    globalConfig,
    agentConfig,
    commandHandler,
    promptBuilder,
    shellCommand,
    lynxService,
    browserService,
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
    commandLoopState,
  );

  const abortController = new AbortController();

  const config = agentConfig.agentConfig();

  return {
    agentUserId: localUserId,
    agentUsername: config.username,
    agentTitle: config.title,
    getRunId: runService.getRunId,
    getSessionId: runService.getSessionId,
    isPaused: commandLoop.isPaused,
    setPaused: commandLoop.setPaused,
    getState: commandLoopState.getState,
    output,
    subagentService,
    runCommandLoop: async () => {
      try {
        return await commandLoop.run(abortController.signal);
      } catch (ex) {
        output.errorAndLog(`AGENT CRASHED: ${ex}`);
        return `error: ${ex}`;
      }
    },
    requestShutdown: (reason: string) => {
      abortController.abort(reason);
    },
    completeShutdown: () => {
      commandLoop.cleanup();
      costTracker.cleanup();
      mailService.cleanup();
      chatService.cleanup();
      void browserService.cleanup();
    },
  };
}

export type AgentRuntime = Awaited<ReturnType<typeof createAgentRuntime>>;

// Re-stamp entries with the parent's identity tuple before forwarding to the
// host buffer. sessionId rides through unchanged. flushFinal is a no-op: the
// host owns the underlying buffer's lifecycle.
function wrapLogBufferForSubagent(
  parent: HubLogBuffer | undefined,
  ctx: SubagentContext,
): HubLogBuffer | undefined {
  if (!parent) return undefined;
  return {
    pushEntry: (entry, resolveAttachment) =>
      parent.pushEntry(
        {
          ...entry,
          userId: ctx.parentUserId,
          runId: ctx.parentRunId,
          subagentId: ctx.subagentId,
        },
        resolveAttachment,
      ),
    flushFinal: () => Promise.resolve(),
  };
}

function wrapCostBufferForSubagent(
  parent: HubCostBuffer | undefined,
  ctx: SubagentContext,
): HubCostBuffer | undefined {
  if (!parent) return undefined;
  // Budget callbacks are no-ops: subagent costs roll into the parent's pool
  // via the parent's userId on the wrapped entries.
  return {
    pushEntry: (entry) =>
      parent.pushEntry({
        ...entry,
        userId: ctx.parentUserId,
        runId: ctx.parentRunId,
        subagentId: ctx.subagentId,
      }),
    registerBudgetCallback: () => {},
    unregisterBudgetCallback: () => {},
    flushFinal: () => Promise.resolve(),
  };
}
