import { jest, test } from "@jest/globals";
import { PrismaClient } from "@naisys/database";
import { CommandProtection } from "../command/commandProtection.js";
import { PromptBuilder } from "../command/promptBuilder.js";
import { ShellCommand } from "../command/shellCommand.js";
import { GenImg } from "../features/genimg.js";
import { LLMail } from "../features/llmail.js";
import { LLMynx } from "../features/llmynx.js";
import { SubagentService } from "../features/subagent.js";
import { WorkspacesFeature } from "../features/workspaces.js";
import { ContextManager } from "../llm/contextManager.js";
import { CostTracker } from "../llm/costTracker.js";
import { DreamMaker } from "../llm/dreamMaker.js";
import { LlmMessage, LlmRole } from "../llm/llmDtos.js";
import { DatabaseService } from "../services/dbService.js";
import { LogService } from "../services/logService.js";
import { OutputService } from "../utils/output.js";

export function createMockDatabaseService(): DatabaseService {
  return {
    usingDatabase: async <T>(
      run: (prisma: PrismaClient) => Promise<T>,
    ): Promise<T> => {
      throw new Error("Mock database not implemented");
    },
    cleanup: () => {},
    incrementSession: async () => {},
  };
}

export function createMockLogService() {
  return {
    write: async (msg: LlmMessage) => 0,
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
    handleCommand: jest.fn(() => Promise.resolve("")),
  } satisfies GenImg;
}

export function createMockSubagent() {
  const subagent: SubagentService = {
    handleCommand: jest.fn(() => Promise.resolve("")),
    getRunningSubagentNames: jest.fn(() => []),
    getTerminationEvents: jest.fn(() => []),
    cleanup: jest.fn(() => Promise.resolve()),
    raiseSwitchEvent: jest.fn(),
    switchEventTriggered: jest.fn(() => false),
  };

  return subagent;
}

export function createMockLLMail() {
  const llmail: LLMail = {
    simpleMode: false,
    handleCommand: jest.fn(() =>
      Promise.resolve({ content: "", pauseSeconds: 0 }),
    ),
    getUnreadThreads: jest.fn(() => Promise.resolve([])),
    newThread: jest.fn(() => Promise.resolve("")),
    readThread: jest.fn(() => Promise.resolve("")),
    markAsRead: jest.fn(() => Promise.resolve()),
    getAllUserNames: jest.fn(() => Promise.resolve([])),
    hasMultipleUsers: jest.fn(() => Promise.resolve(false)),
  };

  return llmail;
}

export function createMockLLMynx() {
  const llmynx: LLMynx = {
    handleCommand: jest.fn(() => Promise.resolve("")),
    clear: jest.fn(),
  };

  return llmynx;
}

export function createMockDreamMaker() {
  const dreamMaker: DreamMaker = {
    goodmorning: jest.fn(() => Promise.resolve("")),
    goodnight: jest.fn(() => Promise.resolve("")),
  };

  return dreamMaker;
}

export function createMockContextManager() {
  const append = jest.fn(() => Promise.resolve());
  const clear = jest.fn();
  const getTokenCount = jest.fn(() => 0);
  const printContext = jest.fn(() => "");
  const getCombinedMessages = jest.fn((): LlmMessage[] => []);
  const trim = jest.fn(() => "");
  const exportedForTesting = {
    getMessages: jest.fn((): LlmMessage[] => []),
  };

  const contextManager: ContextManager = {
    append,
    clear,
    getTokenCount,
    printContext,
    getCombinedMessages,
    trim,
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

export function createMockConfig() {
  return {
    hostname: "test",
    naisysFolder: "/naisys",
    workspacesEnabled: false,
    agent: {
      username: "test",
      debugPauseSeconds: 0,
      wakeOnMessage: false,
      disableMultipleCommands: false,
      leadAgent: undefined,
      spendLimitDollars: undefined,
      tokenMax: 2000,
    },
    mailEnabled: false,
    trimSessionEnabled: false,
    endSessionEnabled: false,
    resolveConfigVars: (str: string) => str,
  } as any;
}

export class MockNaisysPath {
  constructor(public path: string) {}
  toHostPath() {
    return this.path;
  }
}

export function mockCommandProtection() {
  const instance = createMockCommandProtection();

  return {
    mockValidateCommand: instance.validateCommand,
    commandProtection: instance,
  };
}

test("nothing", () => {});
