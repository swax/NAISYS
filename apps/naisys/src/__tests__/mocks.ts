import { jest, test } from "@jest/globals";
import { DatabaseService, PrismaClient } from "@naisys/database";
import { AgentConfig } from "../agent/agentConfig.js";
import { CommandProtection } from "../command/commandProtection.js";
import { PromptBuilder } from "../command/promptBuilder.js";
import { ShellCommand } from "../command/shellCommand.js";
import { GenImg } from "../features/genimg.js";
import { LLMail } from "../features/llmail.js";
import { LLMynx } from "../features/llmynx.js";
import { SessionService } from "../features/session.js";
import { SubagentService } from "../features/subagent.js";
import { WorkspacesFeature } from "../features/workspaces.js";
import { GlobalConfig } from "../globalConfig.js";
import { ContextManager } from "../llm/contextManager.js";
import { CostTracker } from "../llm/costTracker.js";
import { LlmMessage, LlmRole } from "../llm/llmDtos.js";
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
    cleanup: jest.fn(),
    incrementSession: jest.fn(() => Promise.resolve()),
    getRunId: jest.fn(() => -1),
    getSessionId: jest.fn(() => -1),
  };
}

export function createMockLogService() {
  return {
    write: (msg: LlmMessage) => Promise.resolve(""),
    toSimpleRole: (role: LlmRole) => "LLM",
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
    handleCommand: jest.fn(() => Promise.resolve("")),
  } satisfies GenImg;
}

export function createMockSubagent() {
  const subagent: SubagentService = {
    commandName: "ns-agent",
    handleCommand: jest.fn(() => Promise.resolve("")),
    getRunningSubagentNames: jest.fn(() => []),
    cleanup: jest.fn(() => Promise.resolve()),
    raiseSwitchEvent: jest.fn(),
  };

  return subagent;
}

export function createMockLLMail() {
  const llmail: LLMail = {
    commandName: "ns-mail",
    handleCommand: jest.fn(() => Promise.resolve("")),
    getUnreadThreads: jest.fn(() => Promise.resolve([])),
    sendMessage: jest.fn(() => Promise.resolve("")),
    readMessage: jest.fn(() => Promise.resolve("")),
    getAllUserNames: jest.fn(() => Promise.resolve([])),
    hasMultipleUsers: jest.fn(() => Promise.resolve(false)),
    checkAndNotify: jest.fn(() => Promise.resolve()),
    cleanup: jest.fn(),
  };

  return llmail;
}

export function createMockLLMynx() {
  const llmynx: LLMynx = {
    commandName: "ns-lynx",
    handleCommand: jest.fn(() => Promise.resolve("")),
    clear: jest.fn(),
  };

  return llmynx;
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
    handleCommand: jest.fn(() => Promise.resolve("")),
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
    printContext,
    getCombinedMessages,
    exportedForTesting,
  };

  return contextManager;
}

export function createMockWorkspacesFeature() {
  const workspaces: WorkspacesFeature = {
    getLatestContent: jest.fn(() => ""),
    displayActive: jest.fn(),
  };

  return workspaces;
}

export function createMockCostTracker() {
  const costTracker: CostTracker = {
    commandName: "ns-cost",
    handleCommand: jest.fn(() => Promise.resolve("")),
    recordTokens: jest.fn(() => Promise.resolve()),
    recordCost: jest.fn(() => Promise.resolve()),
    calculateCostFromTokens: jest.fn(() => 0),
    calculatePeriodBoundaries: jest.fn(() => ({
      periodStart: new Date(),
      periodEnd: new Date(),
    })),
    getTotalCosts: jest.fn(() => Promise.resolve(0)),
    checkSpendLimit: jest.fn(() => Promise.resolve()),
    getCostBreakdown: jest.fn(() =>
      Promise.resolve({
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        totalInputTokens: 0,
        totalCacheTokens: 0,
      }),
    ),
    getCostBreakdownWithModels: jest.fn(() => Promise.resolve([])),
    calculateModelCacheSavings: jest.fn(() => null),
    clearCosts: jest.fn(() => Promise.resolve()),
    printCosts: jest.fn(() => Promise.resolve()),
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
    reloadGlobalConfig: jest.fn(() => Promise.resolve()),
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
      workspacesEnabled: false,
      naisysFolder: "/naisys",
      localLlmUrl: undefined,
      localLlmName: undefined,
      openaiApiKey: undefined,
      googleApiKey: undefined,
      anthropicApiKey: undefined,
      googleSearchEngineId: undefined,
      spendLimitDollars: undefined,
      spendLimitHours: undefined,
      hubUrls: [],
      hubAccessKey: undefined,
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
    handleCommand: jest.fn(async () => ""),
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
      mailEnabled: false,
      webEnabled: false,
      completeTaskEnabled: false,
      debugPauseSeconds: 0,
      wakeOnMessage: false,
      commandProtection: "none" as any,
      initialCommands: [],
      subagentDirectory: undefined,
      disableMultipleCommands: false,
      leadAgent: undefined,
      taskDescription: undefined,
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
