import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../utils/escKeyListener.js", () => ({
  createEscKeyListener: () => ({
    start: (onEsc: () => void) => {
      onEsc();
      return () => {};
    },
  }),
}));

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

describe("commandLoop ESC cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns to debug mode with an indefinite wait after ESC cancels llm mode", async () => {
    const promptBuilder = createMockPromptBuilder(
      "test@test",
      "test@test:/workspace",
    );
    vi.mocked(promptBuilder.getInput)
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("exit");

    const commandHandler = {
      processCommand: vi
        .fn()
        .mockResolvedValueOnce({
          nextCommandAction: NextCommandAction.Continue,
        })
        .mockResolvedValueOnce({
          nextCommandAction: NextCommandAction.ExitApplication,
        }),
    } as unknown as CommandHandler;

    const llmService = {
      query: vi.fn().mockRejectedValueOnce(new Error("aborted")),
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

    const output = createMockOutputService();
    vi.mocked(output.isConsoleEnabled).mockReturnValue(true);

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
      output,
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
      createCommandLoopState(),
    );

    await expect(commandLoop.run()).resolves.toBe("exit");

    expect(promptBuilder.getInput).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      { kind: "indefinite" },
      expect.any(Function),
    );
  });
});
