import { jest, test } from "@jest/globals";
import { LlmMessage, LlmRole } from "../llm/llmDtos.js";
import { createLogService } from "../services/logService.js";
import { createCommandProtection } from "../command/commandProtection.js";
import { createPromptBuilder } from "../command/promptBuilder.js";
import { createShellCommand } from "../command/shellCommand.js";
import { createGenImg } from "../features/genimg.js";
import { createSubagentService } from "../features/subagent.js";
import { createWorkspacesFeature } from "../features/workspaces.js";
import { createLLMail } from "../features/llmail.js";
import { createLLMynx } from "../features/llmynx.js";
import { createDreamMaker } from "../llm/dreamMaker.js";
import { createContextManager } from "../llm/contextManager.js";
import { createCostTracker } from "../llm/costTracker.js";
import { createOutputService } from "../utils/output.js";

export function createMockLogService() {
  return {
    write: async (msg: LlmMessage) => 0,
    toSimpleRole: (role: LlmRole) => "LLM",
    recordContext: (contextLog: string) => {},
  } satisfies ReturnType<typeof createLogService>;
}

export function createMockPromptBuilder(
  userHostPrompt: string,
  userHostPathPrompt: string,
) {
  const promptBuilder: ReturnType<typeof createPromptBuilder> = {
    getPrompt: jest.fn(() => Promise.resolve(`${userHostPathPrompt}$ `)),
    getUserHostPrompt: jest.fn(() => userHostPrompt),
    getUserHostPathPrompt: jest.fn(() => Promise.resolve(userHostPathPrompt)),
    getInput: jest.fn(() => Promise.resolve("")),
    getCommandConfirmation: jest.fn(() => Promise.resolve("y")),
  };

  return promptBuilder;
}

export function createMockShellCommand() {
  const shellCommand: ReturnType<typeof createShellCommand> = {
    handleCommand: jest.fn(() => Promise.resolve(false)),
    isShellSuspended: jest.fn(() => false),
    getCommandElapsedTimeString: jest.fn(() => ""),
  };

  return shellCommand;
}

export function createMockGenImg() {
  return {
    handleCommand: jest.fn(() => Promise.resolve("")),
  } satisfies ReturnType<typeof createGenImg>;
}

export function createMockSubagent() {
  const subagent: ReturnType<typeof createSubagentService> = {
    handleCommand: jest.fn(() => Promise.resolve("")),
    getRunningSubagentNames: jest.fn(() => []),
    unreadContextSummary: jest.fn(() => undefined),
    getTerminationEvents: jest.fn(() => []),
  };

  return subagent;
}

export function createMockLLMail() {
  const llmail: ReturnType<typeof createLLMail> = {
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
  const llmynx: ReturnType<typeof createLLMynx> = {
    handleCommand: jest.fn(() => Promise.resolve("")),
    clear: jest.fn(),
  };

  return llmynx;
}

export function createMockDreamMaker() {
  const dreamMaker: ReturnType<typeof createDreamMaker> = {
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

  const contextManager: ReturnType<typeof createContextManager> = {
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
  const workspaces: ReturnType<typeof createWorkspacesFeature> = {
    getLatestContent: jest.fn(() => ""),
    displayActive: jest.fn(),
  };

  return workspaces;
}

export function createMockCostTracker() {
  const costTracker: ReturnType<typeof createCostTracker> = {
    recordTokens: jest.fn(() => Promise.resolve()),
    recordCost: jest.fn(() => Promise.resolve()),
    calculateCostFromTokens: jest.fn(() => 0),
    getTotalCosts: jest.fn(() => Promise.resolve(0)),
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
  const output: ReturnType<typeof createOutputService> = {
    write: jest.fn(),
    comment: jest.fn(),
    commentAndLog: jest.fn(() => Promise.resolve()),
    error: jest.fn(),
    errorAndLog: jest.fn(() => Promise.resolve()),
  };

  return output;
}

export function createMockCommandProtection() {
  const validateCommand = jest.fn(() =>
    Promise.resolve({
      commandAllowed: true,
    }),
  );

  return {
    validateCommand,
  } satisfies ReturnType<typeof createCommandProtection>;
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
