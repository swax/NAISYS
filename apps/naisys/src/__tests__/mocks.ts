import { jest, test } from "@jest/globals";
import { DatabaseService, PrismaClient } from "@naisys/database";
import { AgentConfig } from "../agent/agentConfig.js";
import { CommandProtection } from "../command/commandProtection.js";
import { PromptBuilder } from "../command/promptBuilder.js";
import { ShellCommand } from "../command/shellCommand.js";
import { GenImg } from "../features/genImg.js";
import { MailService } from "../mail/mail.js";
import { LynxService } from "../features/lynx.js";
import { SessionService } from "../features/session.js";
import { SubagentService } from "../features/subagent.js";
import { WorkspacesFeature } from "../features/workspaces.js";
import { GlobalConfig } from "../globalConfig.js";
import { ContextManager } from "../llm/contextManager.js";
import { CostTracker } from "../llm/costTracker.js";
import { LlmMessage } from "../llm/llmDtos.js";
import { SessionCompactor } from "../llm/sessionCompactor.js";
import { LogService } from "../services/logService.js";
import { RunService } from "../services/runService.js";
import { OutputService } from "../utils/output.js";

export function createMockDatabaseService(): DatabaseService {
  return {
    usingDatabase: <T>(
      run: (prisma: PrismaClient) => Promise<T>,
    ): Promise<T> => {
      throw new Error("Mock database not implemented");
    },
    getSchemaVersion: () => 1,
    disconnect: () => Promise.resolve(),
  };
}

export function createMockRunService(): RunService {
  return {
    incrementSession: jest.fn(() => Promise.resolve()),
    getRunId: jest.fn(() => -1),
    getSessionId: jest.fn(() => -1),
  };
}

export function createMockLogService() {
  return {
    write: (msg: LlmMessage) => {},
    cleanup: () => {},
  } satisfies LogService;
}

export function createMockPromptBuilder(
  userHostPrompt: string,
  userHostPathPrompt: string,
) {
  const promptBuilder: PromptBuilder = {
    getPrompt: jest.fn(() => Promise.resolve(`${userHostPathPrompt}$ `)),
    getUserHostPrompt: jest.fn(() => userHostPrompt),
    getUserHostPathPrompt: jest.fn(() => Promise.resolve(userHostPathPrompt)),
    getInput: jest.fn(() => Promise.resolve("")),
    getCommandConfirmation: jest.fn(() => Promise.resolve("y")),
  };

  return promptBuilder;
}

export function createMockShellCommand() {
  const shellCommand: ShellCommand = {
    handleCommand: jest.fn(() => Promise.resolve(false)),
    isShellSuspended: jest.fn(() => false),
    getCommandElapsedTimeString: jest.fn(() => ""),
  };

  return shellCommand;
}

export function createMockGenImg() {
  return {
    commandName: "ns-genimg",
    handleCommand: jest.fn(() => ""),
  } satisfies GenImg;
}

export function createMockSubagent() {
  const subagent: SubagentService = {
    commandName: "ns-agent",
    handleCommand: jest.fn(() => ""),
    cleanup: jest.fn(() => Promise.resolve()),
    raiseSwitchEvent: jest.fn(),
  };

  return subagent;
}

export function createMockMailService() {
  const mailService: MailService = {
    commandName: "ns-mail",
    handleCommand: jest.fn(() => ""),
    getUnreadThreads: jest.fn(() => Promise.resolve([])),
    sendMessage: jest.fn(() => Promise.resolve("")),
    getAllUserNames: jest.fn(() => []),
    hasMultipleUsers: jest.fn(() => false),
    checkAndNotify: jest.fn(() => Promise.resolve()),
    cleanup: jest.fn(),
  };

  return mailService;
}

export function createMockLynxService() {
  const lynxService: LynxService = {
    commandName: "ns-lynx",
    handleCommand: jest.fn(() => ""),
    clear: jest.fn(),
  };

  return lynxService;
}

export function createMockSessionCompactor() {
  const sessionCompactor: SessionCompactor = {
    getLastSessionSummary: jest.fn(() => ""),
    run: jest.fn(() => Promise.resolve("")),
  };

  return sessionCompactor;
}

export function createMockSessionService() {
  const sessionService: SessionService = {
    commandName: "ns-session",
    handleCommand: jest.fn(() => ""),
  };

  return sessionService;
}

export function createMockContextManager() {
  const append = jest.fn(() => Promise.resolve());
  const clear = jest.fn();
  const getTokenCount = jest.fn(() => 0);
  const printContext = jest.fn(() => "");
  const getCombinedMessages = jest.fn((): LlmMessage[] => []);
  const exportedForTesting = {
    getMessages: jest.fn((): LlmMessage[] => []),
  };

  const contextManager: ContextManager = {
    append,
    clear,
    getTokenCount,
    getCombinedMessages,
    exportedForTesting,
  };

  return contextManager;
}

export function createMockWorkspacesFeature() {
  const workspaces: WorkspacesFeature = {
    commandName: "ns-workspace",
    handleCommand: jest.fn(() => ""),
    getContext: jest.fn(() => ""),
    listFiles: jest.fn(() => ""),
    hasFiles: jest.fn(() => false),
  };

  return workspaces;
}

export function createMockCostTracker() {
  const costTracker: CostTracker = {
    recordTokens: jest.fn(),
    recordCost: jest.fn(),
    calculateCostFromTokens: jest.fn(() => 0),
    checkSpendLimit: jest.fn(),
    cleanup: jest.fn(),
    getModelCosts: jest.fn(() => new Map()),
    getTotalCost: jest.fn(() => 0),
    getPeriodInfo: jest.fn(() => null),
    resetCosts: jest.fn(),
  };

  return costTracker;
}

export function createMockOutputService() {
  const output: OutputService = {
    write: jest.fn(),
    comment: jest.fn(),
    commentAndLog: jest.fn(() => Promise.resolve()),
    error: jest.fn(),
    errorAndLog: jest.fn(() => Promise.resolve()),
    consoleBuffer: [],
    isConsoleEnabled: jest.fn(() => false),
    setConsoleEnabled: jest.fn(),
  };

  return output;
}

export function createMockInputMode() {
  return {
    setLLM: jest.fn(),
    setDebug: jest.fn(),
    toggle: jest.fn(),
    isLLM: jest.fn(() => false),
    isDebug: jest.fn(() => true),
  };
}

export function createMockCommandProtection() {
  const validateCommand = jest.fn(() =>
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
    waitForConfig: jest.fn(() => Promise.resolve()),
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
      naisysFolder: "/naisys",
      localLlmUrl: undefined,
      localLlmName: undefined,
      openaiApiKey: undefined,
      googleApiKey: undefined,
      anthropicApiKey: undefined,
      googleSearchEngineId: undefined,
      spendLimitDollars: undefined,
      spendLimitHours: undefined,
      useToolsForLlmConsoleResponses: true,
      packageVersion: "1.0.0",
      binPath: "/bin",
      getEnv: jest.fn((key: string) => undefined),
    }),
  };
}

export function createMockAgentConfig(): AgentConfig {
  return {
    commandName: "ns-agent-config",
    helpText: "View or update agent config: ns-agent-config [name] [value]",
    isDebug: true,
    handleCommand: jest.fn(() => ""),
    reloadAgentConfig: jest.fn(async () => {}),
    updateConfigField: jest.fn(async () => {}),
    agentConfig: () => ({
      username: "test",
      title: "Test Agent",
      agentPrompt: "Test prompt",
      spendLimitDollars: undefined,
      spendLimitHours: undefined,
      tokenMax: 2000,
      shellModel: "gpt-4",
      webModel: "gpt-4",
      compactModel: "gpt-4",
      imageModel: undefined,
      mailEnabled: true,
      webEnabled: false,
      completeSessionEnabled: false,
      debugPauseSeconds: 0,
      wakeOnMessage: false,
      commandProtection: "none" as any,
      initialCommands: [],
      disableMultipleCommands: false,
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

test("nothing", () => {});
