import type {
  RestoreData,
  StartupAttachmentDispatch,
} from "@naisys/hub-protocol";

import { commentCmd } from "../command/commandDefs.js";
import { createCommandHandler } from "../command/commandHandler.js";
import { createCommandLoop } from "../command/commandLoop.js";
import { createCommandProtection } from "../command/commandProtection.js";
import { createCommandRegistry } from "../command/commandRegistry.js";
import { createDebugCommands } from "../command/debugCommand.js";
import { createPagedOutputBuffer } from "../command/pagedOutputBuffer.js";
import { createPromptBuilder } from "../command/promptBuilder.js";
import { createShellCommand } from "../command/shellCommand.js";
import { createShellWrapper } from "../command/shellWrapper.js";
import { createComputerService } from "../computer-use/computerService.js";
import { createDesktopService } from "../computer-use/desktop.js";
import type { DesktopClaimService } from "../computer-use/desktopClaimService.js";
import { createGenImg } from "../features/media/genImg.js";
import { createListenService } from "../features/media/listen.js";
import { createLookService } from "../features/media/look.js";
import { createPtyService } from "../features/shell/pty.js";
import { createSessionService } from "../features/shell/session.js";
import { createSubagentService } from "../features/shell/subagent.js";
import { createWorkspacesFeature } from "../features/shell/workspaces.js";
import { createBrowserService } from "../features/web/browser.js";
import { createLynxService } from "../features/web/lynx.js";
import { createWebSearchService } from "../features/web/webSearch.js";
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
import { createAttachmentService } from "../services/agent/attachmentService.js";
import { createLogService } from "../services/agent/logService.js";
import type { ModelService } from "../services/agent/modelService.js";
import { createRunService } from "../services/agent/runService.js";
import { createStartupAttachmentService } from "../services/agent/startupAttachmentService.js";
import type { HostService } from "../services/hub/hostService.js";
import { createHubAttachmentClient } from "../services/hub/hubAttachmentClient.js";
import { createNaisysApiService } from "../services/hub/naisysApiService.js";
import { getPlatformConfig } from "../services/runtime/shellPlatform.js";
import { createCommandLoopState } from "../utils/commandLoopState.js";
import { createInputMode } from "../utils/input/inputMode.js";
import { createOutputService } from "../utils/output/output.js";
import type { PromptNotificationService } from "../utils/output/promptNotificationService.js";
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
  desktopClaimService: DesktopClaimService,
  subagentContext?: SubagentContext,
  preallocated?: { runId: number; sessionId: number },
  runtimeApiKey?: string,
  startupAttachments?: StartupAttachmentDispatch[],
  restoreData?: RestoreData,
) {
  // For subagents, strip the hub surface so hub-aware services take their
  // local-mode branch. The parent's hubClient is preserved as sessionHubClient
  // for the few subagent paths that genuinely need hub round-trips — run
  // session registration, $NAISYS_API_URL_BASE, and OpenAI Codex OAuth.
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

  // Built before staging so the seed key is available to stage().
  const naisysApiService = createNaisysApiService(runtimeApiKey);

  const hubAttachmentClient = createHubAttachmentClient(
    hubClient,
    naisysApiService,
  );

  const startupAttachmentService = createStartupAttachmentService(
    hubAttachmentClient,
    agentConfig,
  );
  if (startupAttachments?.length) {
    await startupAttachmentService.stage(startupAttachments);
  }

  const runService = await createRunService(
    agentConfig,
    sessionHubClient,
    localUserId,
    subagentContext,
    preallocated,
  );
  const attachmentService = createAttachmentService(
    hubClient,
    naisysApiService,
  );
  const logService = createLogService(
    hubLogBuffer,
    runService,
    localUserId,
    attachmentService,
  );
  const output = createOutputService(logService);

  // Shell surface and workspace context. apiUrlBase comes from sessionHubClient
  // so subagents (which null out `hubClient`) still get $NAISYS_API_URL_BASE
  // alongside the runtime API key the parent dispatched them with.
  const shellWrapper = createShellWrapper(
    globalConfig,
    agentConfig,
    output,
    naisysApiService,
    sessionHubClient?.getApiUrlBase(),
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
    sessionHubClient,
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
    desktopClaimService,
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
    runService,
  );
  const chatService = createChatService(
    hubClient,
    userService,
    localUserId,
    promptNotification,
    attachmentService,
    shellWrapper,
    runService,
  );
  const subagentService = createSubagentService(
    mailService,
    chatService,
    output,
    agentManager,
    inputMode,
    userService,
    localUserId,
    promptNotification,
    hubClient,
    globalConfig,
    agentConfig,
    runService,
    costTracker,
  );
  // Per-agent paged-output buffer shared across shell, lynx, and browser so
  // `ns-more` always pages the most recent over-budget output for THIS agent.
  const pagedOutputBuffer = createPagedOutputBuffer(globalConfig);

  const lynxService = createLynxService(globalConfig, output, pagedOutputBuffer);
  const browserService = createBrowserService(
    globalConfig,
    agentConfig,
    contextManager,
    output,
    modelService,
    pagedOutputBuffer,
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
    shellWrapper,
    inputMode,
    pagedOutputBuffer,
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
    logService,
    hubAttachmentClient,
    inputMode,
    restoreData,
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
    pagedOutputBuffer.moreCommand,
    ...shellWrapper.commands,
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
    sessionService,
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
    commandLoopState,
    startupAttachmentService,
    pagedOutputBuffer,
  );

  const abortController = new AbortController();

  const config = agentConfig.agentConfig();

  return {
    agentUserId: localUserId,
    parentUserId: subagentContext?.parentUserId,
    agentUsername: config.username,
    agentTitle: config.title,
    shellModel: config.shellModel,
    getRunId: runService.getRunId,
    getSessionId: runService.getSessionId,
    isPaused: commandLoop.isPaused,
    setPaused: commandLoop.setPaused,
    getState: commandLoopState.getState,
    getTokenCount: contextManager.getTokenCount,
    output,
    subagentService,
    naisysApiService,
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
      desktopService.cleanup();
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
