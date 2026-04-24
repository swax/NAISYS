import { LlmApiType } from "@naisys/common";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { createLLMService } from "../../llm/llmService.js";
import type { DesktopConfig } from "../../llm/vendors/vendorTypes.js";
import { createMockCostTracker, createMockGlobalConfig } from "../mocks.js";

const { sendWithGoogle } = vi.hoisted(() => ({
  sendWithGoogle: vi.fn(() =>
    Promise.resolve({
      responses: [""],
      messagesTokenCount: 0,
    }),
  ),
}));

vi.mock("../../llm/vendors/google.js", () => ({
  sendWithGoogle,
}));

describe("llmService desktop config", () => {
  beforeEach(() => {
    sendWithGoogle.mockClear();
  });

  test("reads the current desktop config for each query", async () => {
    const firstConfig: DesktopConfig = {
      nativeDisplayWidth: 1920,
      nativeDisplayHeight: 1080,
      viewport: { x: 0, y: 0, width: 1200, height: 900 },
      scaledWidth: 1200,
      scaledHeight: 900,
      scaleFactor: 1,
      desktopPlatform: "Linux (X11)",
    };
    const secondConfig: DesktopConfig = {
      nativeDisplayWidth: 1920,
      nativeDisplayHeight: 1080,
      viewport: { x: 100, y: 200, width: 400, height: 300 },
      scaledWidth: 400,
      scaledHeight: 300,
      scaleFactor: 1,
      desktopPlatform: "Linux (X11)",
    };

    const llmService = createLLMService(
      createMockGlobalConfig(),
      {
        agentConfig: () => ({
          shellModel: "shell-model",
          controlDesktop: true,
          workspacesEnabled: false,
        }),
      } as any,
      createMockCostTracker(),
      {} as any,
      {
        getLlmModel: vi.fn(() => ({
          apiType: LlmApiType.Google,
          supportsComputerUse: true,
          apiKeyVar: undefined,
          key: "gemini-shell",
          versionName: "gemini-2.5-pro",
        })),
      } as any,
      {
        getConfig: vi
          .fn()
          .mockReturnValueOnce(firstConfig)
          .mockReturnValueOnce(secondConfig),
      } as any,
    );

    await llmService.query(
      "shell-model",
      "system",
      [{ role: "user", content: "hello" }],
      "console",
    );
    await llmService.query(
      "shell-model",
      "system",
      [{ role: "user", content: "hello again" }],
      "console",
    );

    const googleCalls = (sendWithGoogle as any).mock.calls;
    expect(googleCalls[0][0].desktopConfig).toEqual(firstConfig);
    expect(googleCalls[1][0].desktopConfig).toEqual(secondConfig);
  });
});
