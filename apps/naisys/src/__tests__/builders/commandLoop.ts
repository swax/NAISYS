import { vi } from "vitest";

import type { CommandHandler } from "../../command/commandHandler.js";
import { createCommandLoop } from "../../command/commandLoop.js";
import { NextCommandAction } from "../../command/commandRegistry.js";
import type { DesktopService } from "../../computer-use/desktop.js";
import type { LLMService } from "../../llm/llmService.js";
import type { ModelService } from "../../services/modelService.js";
import { createCommandLoopState } from "../../utils/commandLoopState.js";
import { createInputMode } from "../../utils/inputMode.js";
import { createPromptNotificationService } from "../../utils/promptNotificationService.js";
import {
  createMockAgentConfig,
  createMockBrowserService,
  createMockChatService,
  createMockContextManager,
  createMockGlobalConfig,
  createMockLogService,
  createMockLynxService,
  createMockMailService,
  createMockOutputService,
  createMockPromptBuilder,
  createMockRunService,
  createMockSessionService,
  createMockShellCommand,
  createMockWorkspacesFeature,
} from "../mocks.js";

export type BuildCommandLoopOverrides = {
  commandHandler?: Partial<CommandHandler>;
  llmService?: Partial<LLMService>;
  modelService?: Partial<ModelService>;
  desktopService?: Partial<DesktopService>;
};

const defaultCommandHandler = (): CommandHandler =>
  ({
    processCommand: vi.fn().mockResolvedValue({
      nextCommandAction: NextCommandAction.ExitApplication,
    }),
  }) as unknown as CommandHandler;

const defaultLlmService = (): LLMService =>
  ({
    query: vi.fn(),
  }) as unknown as LLMService;

const defaultModelService = (): ModelService =>
  ({
    getLlmModel: vi.fn(() => ({
      label: "Mock GPT",
      cacheTtlSeconds: undefined,
    })),
  }) as unknown as ModelService;

const defaultDesktopService = (): DesktopService =>
  ({
    logStartup: vi.fn(),
    confirmAndExecuteActions: vi.fn(),
  }) as unknown as DesktopService;

export function buildCommandLoop(overrides: BuildCommandLoopOverrides = {}) {
  const promptBuilder = createMockPromptBuilder(
    "test@test",
    "test@test:/workspace",
  );
  const commandHandler = {
    ...defaultCommandHandler(),
    ...overrides.commandHandler,
  } as CommandHandler;
  const llmService = {
    ...defaultLlmService(),
    ...overrides.llmService,
  } as LLMService;
  const modelService = {
    ...defaultModelService(),
    ...overrides.modelService,
  } as ModelService;
  const desktopService = {
    ...defaultDesktopService(),
    ...overrides.desktopService,
  } as DesktopService;
  const promptNotification = createPromptNotificationService();

  const output = createMockOutputService();

  const mocks = {
    promptBuilder,
    commandHandler,
    llmService,
    modelService,
    desktopService,
    promptNotification,
    output,
  };

  const commandLoop = createCommandLoop(
    createMockGlobalConfig(),
    createMockAgentConfig(),
    commandHandler,
    promptBuilder,
    createMockShellCommand(),
    createMockLynxService(),
    createMockBrowserService(),
    createMockContextManager(),
    createMockWorkspacesFeature(),
    llmService,
    "system message",
    output,
    createMockLogService(),
    createInputMode(),
    createMockRunService(),
    promptNotification,
    1,
    createMockMailService(),
    createMockChatService(),
    undefined,
    createMockSessionService(),
    modelService,
    desktopService,
    createCommandLoopState(),
  );

  return { commandLoop, mocks };
}
