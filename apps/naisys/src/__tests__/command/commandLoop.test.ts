import { describe, expect, test, vi } from "vitest";

import type { CommandHandler } from "../../command/commandHandler.js";
import { createCommandLoop } from "../../command/commandLoop.js";
import { NextCommandAction } from "../../command/commandRegistry.js";
import type { DesktopService } from "../../computer-use/desktop.js";
import type { LLMService } from "../../llm/llmService.js";
import type { ModelService } from "../../services/modelService.js";
import { createInputMode } from "../../utils/inputMode.js";
import { createPromptNotificationService } from "../../utils/promptNotificationService.js";
import {
  createMockAgentConfig,
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

describe("commandLoop wait behavior", () => {
  test("applies retrySecondsBase as the backoff after an llm error", async () => {
    const promptBuilder = createMockPromptBuilder(
      "test@test",
      "test@test:/workspace",
    );
    const commandHandler = {
      processCommand: vi.fn().mockResolvedValue({
        nextCommandAction: NextCommandAction.ExitApplication,
      }),
    } as unknown as CommandHandler;
    const llmService = {
      query: vi.fn().mockRejectedValueOnce(new Error("boom")),
    } as unknown as LLMService;
    const modelService = {
      getLlmModel: vi.fn(() => ({
        label: "Mock GPT",
        cacheTtlSeconds: undefined,
      })),
    } as unknown as ModelService;
    const desktopService = {
      logStartup: vi.fn(),
      confirmAndExecuteActions: vi.fn(),
    } as unknown as DesktopService;

    const commandLoop = createCommandLoop(
      createMockGlobalConfig(),
      createMockAgentConfig(),
      commandHandler,
      promptBuilder,
      createMockShellCommand(),
      createMockLynxService(),
      createMockContextManager(),
      createMockWorkspacesFeature(),
      llmService,
      "system message",
      createMockOutputService(),
      createMockLogService(),
      createInputMode(),
      createMockRunService(),
      createPromptNotificationService(),
      1,
      createMockMailService(),
      createMockChatService(),
      undefined,
      createMockSessionService(),
      modelService,
      desktopService,
    );

    await expect(commandLoop.run()).resolves.toBe("exit");

    expect(llmService.query).toHaveBeenCalledTimes(1);
    expect(promptBuilder.getPrompt).toHaveBeenNthCalledWith(1, {
      kind: "none",
    });
    expect(promptBuilder.getPrompt).toHaveBeenNthCalledWith(2, {
      kind: "timed",
      seconds: 5,
    });
    expect(promptBuilder.getInput).toHaveBeenCalledWith(
      expect.any(String),
      { kind: "timed", seconds: 5 },
      expect.any(Function),
    );
  });
});
