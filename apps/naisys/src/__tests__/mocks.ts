import { type HubDatabaseService, PrismaClient } from "@naisys/hub-database";
import { MailMessageData } from "@naisys/hub-protocol";
import { vi } from "vitest";

import { AgentConfig } from "../agent/agentConfig.js";
import {
  agentConfigCmd,
  chatCmd,
  genImgCmd,
  lynxCmd,
  mailCmd,
  sessionCmd,
  subagentCmd,
  workspaceCmd,
} from "../command/commandDefs.js";
import { CommandProtection } from "../command/commandProtection.js";
import { PromptBuilder } from "../command/promptBuilder.js";
import { ShellCommand } from "../command/shellCommand.js";
import { ShellWrapper } from "../command/shellWrapper.js";
import { GenImg } from "../features/genImg.js";
import { LynxService } from "../features/lynx.js";
import { SessionService } from "../features/session.js";
import { SubagentService } from "../features/subagent.js";
import { WorkspacesFeature } from "../features/workspaces.js";
import { GlobalConfig } from "../globalConfig.js";
import { ContextManager } from "../llm/contextManager.js";
import { CostTracker } from "../llm/costTracker.js";
import { LlmMessage } from "../llm/llmDtos.js";
import { ChatService } from "../mail/chat.js";
import { MailService } from "../mail/mail.js";
import { LogService } from "../services/logService.js";
import { RunService } from "../services/runService.js";
import { OutputService } from "../utils/output.js";

export function createMockDatabaseService(): HubDatabaseService {
  return {
    hubDb: {} as PrismaClient,
    getSchemaVersion: () => 1,
    disconnect: () => Promise.resolve(),
  };
}

export function createMockRunService(): RunService {
  return {
    incrementSession: vi.fn(() => Promise.resolve()),
    getRunId: vi.fn(() => -1),
    getSessionId: vi.fn(() => -1),
  };
}

export function createMockLogService() {
  return {
    write: (_msg: LlmMessage, _filepath?: string) => {},
  } satisfies LogService;
}

export function createMockPromptBuilder(
  userHostPrompt: string,
  userHostPathPrompt: string,
) {
  const promptBuilder: PromptBuilder = {
    getPrompt: vi.fn(() => Promise.resolve(`${userHostPathPrompt}$ `)),
    getUserHostPrompt: vi.fn(() => userHostPrompt),
    getUserHostPathPrompt: vi.fn(() => Promise.resolve(userHostPathPrompt)),
    getInput: vi.fn(() => Promise.resolve("")),
    getCommandConfirmation: vi.fn(() => Promise.resolve("y")),
  };

  return promptBuilder;
}

export function createMockShellCommand() {
  const shellCommand: ShellCommand = {
    handleCommand: vi.fn(() => Promise.resolve(false)),
    isShellSuspended: vi.fn(() => false),
    getCommandElapsedTimeString: vi.fn(() => ""),
    getCurrentCommandName: vi.fn(() => ""),
  };

  return shellCommand;
}

export function createMockShellWrapper() {
  const shellWrapper: ShellWrapper = {
    executeCommand: vi.fn(() => Promise.resolve("")),
    continueCommand: vi.fn(() => Promise.resolve("")),
    getCurrentPath: vi.fn(() => Promise.resolve("/home/bob")),
    resolvePaths: vi.fn((paths: string[]) => Promise.resolve(paths)),
    terminate: vi.fn(() => Promise.resolve()),
    isShellSuspended: vi.fn(() => false),
    getCommandElapsedTimeString: vi.fn(() => ""),
    getCurrentCommandName: vi.fn(() => ""),
  };

  return shellWrapper;
}

export function createMockGenImg() {
  return {
    command: genImgCmd,
    handleCommand: vi.fn(() => ""),
  } satisfies GenImg;
}

export function createMockSubagent() {
  const subagent: SubagentService = {
    command: subagentCmd,
    handleCommand: vi.fn(() => ""),
    raiseSwitchEvent: vi.fn(),
  };

  return subagent;
}

export function createMockMailService() {
  const mailService: MailService = {
    command: mailCmd,
    handleCommand: vi.fn(() => ""),
    getUnreadMessages: vi.fn(
      (): Promise<MailMessageData[]> => Promise.resolve([]),
    ),
    sendMessage: vi.fn(() => Promise.resolve("")),
    getAllUserNames: vi.fn(() => []),
    hasMultipleUsers: vi.fn(() => false),
    checkAndNotify: vi.fn(() => Promise.resolve()),
    cleanup: vi.fn(),
  };

  return mailService;
}

export function createMockChatService() {
  const chatService: ChatService = {
    command: chatCmd,
    handleCommand: vi.fn(() => ""),
    checkAndNotify: vi.fn(() => Promise.resolve()),
    sendToUser: vi.fn(() => Promise.resolve("")),
    cleanup: vi.fn(),
  };

  return chatService;
}

export function createMockLynxService() {
  const lynxService: LynxService = {
    command: lynxCmd,
    handleCommand: vi.fn(() => ""),
    clear: vi.fn(),
  };

  return lynxService;
}

export function createMockSessionService() {
  const sessionService: SessionService = {
    command: sessionCmd,
    handleCommand: vi.fn(() => ""),
    getResumeCommands: vi.fn(() => []),
  };

  return sessionService;
}

export function createMockContextManager() {
  const append = vi.fn(() => Promise.resolve());
  const clear = vi.fn();
  const setMessagesTokenCount = vi.fn();
  const getTokenCount = vi.fn(() => 0);
  const getCombinedMessages = vi.fn((): LlmMessage[] => []);
  const exportedForTesting = {
    getMessages: vi.fn((): LlmMessage[] => []),
  };

  const appendImage = vi.fn();
  const appendAudio = vi.fn();

  const contextManager: ContextManager = {
    append,
    appendImage,
    appendAudio,
    appendToolResponse: vi.fn(),
    appendToolResult: vi.fn(),
    appendToolResultError: vi.fn(),
    scrubRecentMedia: vi.fn(() => false),
    clear,
    setMessagesTokenCount,
    getLastQueryTime: vi.fn(() => 0),
    getTokenCount,
    getCombinedMessages,
    exportedForTesting,
  };

  return contextManager;
}

export function createMockWorkspacesFeature() {
  const workspaces: WorkspacesFeature = {
    command: workspaceCmd,
    handleCommand: vi.fn(() => ""),
    getContext: vi.fn(() => ""),
    listFiles: vi.fn(() => ""),
    hasFiles: vi.fn(() => false),
  };

  return workspaces;
}

export function createMockCostTracker() {
  const costTracker: CostTracker = {
    recordTokens: vi.fn(),
    recordCost: vi.fn(),
    calculateCostFromTokens: vi.fn(() => 0),
    checkSpendLimit: vi.fn(),
    cleanup: vi.fn(),
    getModelCosts: vi.fn(() => new Map()),
    getTotalCost: vi.fn(() => 0),
    getPeriodInfo: vi.fn(() => null),
    getBudgetLeft: vi.fn(() => null),
    resetCosts: vi.fn(),
  };

  return costTracker;
}

export function createMockOutputService() {
  const output: OutputService = {
    write: vi.fn(),
    comment: vi.fn(),
    commentAndLog: vi.fn(() => Promise.resolve()),
    error: vi.fn(),
    errorAndLog: vi.fn(() => Promise.resolve()),
    consoleBuffer: [],
    isConsoleEnabled: vi.fn(() => false),
    setConsoleEnabled: vi.fn(),
  };

  return output;
}

export function createMockInputMode() {
  return {
    setLLM: vi.fn(),
    setDebug: vi.fn(),
    toggle: vi.fn(),
    isLLM: vi.fn(() => false),
    isDebug: vi.fn(() => true),
  };
}

export function createMockCommandProtection() {
  const validateCommand = vi.fn(() =>
    Promise.resolve({
      commandAllowed: true,
    }),
  );

  return {
    validateCommand,
  } satisfies CommandProtection;
}

export function createMockGlobalConfig(): GlobalConfig {
  return {
    waitForConfig: vi.fn(() => Promise.resolve()),
    globalConfig: () => ({
      hostname: "test",
      shellCommand: {
        outputTokenMax: 7500,
        timeoutSeconds: 10,
        maxTimeoutSeconds: 300,
      },
      webTokenMax: 5000,
      retrySecondsMax: 1800,
      compactSessionEnabled: false,
      preemptiveCompactEnabled: false,
      naisysFolder: "/naisys",
      variableMap: {},
      googleSearchEngineId: undefined,
      spendLimitDollars: undefined,
      spendLimitHours: undefined,
      useToolsForLlmConsoleResponses: true,
      packageVersion: "1.0.0",
      binPath: "/bin",
      supervisorPort: undefined,
      autoStartAgentsOnMessage: true,
    }),
  };
}

export function createMockAgentConfig(): AgentConfig {
  return {
    command: agentConfigCmd,
    handleCommand: vi.fn(() => ""),
    reloadAgentConfig: vi.fn(async () => {}),
    updateConfigField: vi.fn(async () => {}),
    agentConfig: () => ({
      username: "test",
      title: "Test Agent",
      agentPrompt: "Test prompt",
      spendLimitDollars: undefined,
      spendLimitHours: undefined,
      tokenMax: 2000,
      shellModel: "gpt-4",
      imageModel: undefined,
      mailEnabled: true,
      chatEnabled: true,
      webEnabled: false,
      completeSessionEnabled: false,
      debugPauseSeconds: 0,
      wakeOnMessage: false,
      commandProtection: "none" as any,
      initialCommands: [],
      multipleCommandsEnabled: true,
      workspacesEnabled: false,
      resolveConfigVars: (str: string) => str,
    }),
  };
}

export function mockCommandProtection() {
  const instance = createMockCommandProtection();

  return {
    mockValidateCommand: instance.validateCommand,
    commandProtection: instance,
  };
}
