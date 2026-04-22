import { LlmApiType } from "@naisys/common";
import { describe, expect, test, vi } from "vitest";

import { createDesktopService } from "../../computer-use/desktop.js";
import type { DesktopConfig } from "../../llm/vendors/vendorTypes.js";
import {
  createMockCommandLoopState,
  createMockContextManager,
  createMockOutputService,
} from "../mocks.js";

describe("desktop focus commands", () => {
  test("sets the focus rectangle from ns-desktop focus", async () => {
    const desktopConfig: DesktopConfig = {
      displayWidth: 1920,
      displayHeight: 1080,
      nativeDisplayWidth: 1920,
      nativeDisplayHeight: 1080,
      viewport: { x: 0, y: 0, width: 1920, height: 1080 },
      desktopPlatform: "Linux (X11)",
    };

    const computerService = {
      getConfig: vi.fn(() => desktopConfig),
      setFocus: vi.fn(() => ({ x: 10, y: 20, width: 300, height: 200 })),
      executeAction: vi.fn(),
      captureNativeScreenshot: vi.fn(),
      captureScaledScreenshot: vi.fn(),
      platformName: "Linux (X11)",
      initError: undefined,
    } as any;

    const desktopService = createDesktopService(
      computerService,
      createMockContextManager(),
      createMockOutputService(),
      {
        agentConfig: () => ({
          shellModel: "shell-model",
          controlDesktop: true,
          debugPauseSeconds: 0,
        }),
      } as any,
      {
        getLlmModel: vi.fn(() => ({
          supportsComputerUse: true,
          apiType: LlmApiType.OpenAI,
        })),
      } as any,
      {
        getCurrentPath: vi.fn(() => Promise.resolve("/tmp")),
      } as any,
      createMockCommandLoopState() as any,
    );

    await expect(desktopService.handleCommand("focus 10 20 300 200")).resolves
      .toBe(
        "Desktop focus set to (10, 20, 300x200) in native screen pixels.\nFocus changes can increase next-turn cost because computer-use context has to be refreshed.",
      );

    expect(computerService.setFocus).toHaveBeenCalledWith({
      x: 10,
      y: 20,
      width: 300,
      height: 200,
    });
  });

  test("does not attach viewport metadata when the full desktop is in view", async () => {
    const desktopConfig: DesktopConfig = {
      displayWidth: 1920,
      displayHeight: 1080,
      nativeDisplayWidth: 1920,
      nativeDisplayHeight: 1080,
      viewport: { x: 0, y: 0, width: 1920, height: 1080 },
      desktopPlatform: "Linux (X11)",
    };

    const contextManager = createMockContextManager();
    const computerService = {
      getConfig: vi.fn(() => desktopConfig),
      executeAction: vi.fn(async () => {}),
      captureScaledScreenshot: vi.fn(async () => ({
        base64: "abc",
        filepath: "/tmp/screenshot.png",
      })),
      captureNativeScreenshot: vi.fn(),
      captureFullNativeScreenshot: vi.fn(),
      setFocus: vi.fn(),
      platformName: "Linux (X11)",
      initError: undefined,
    } as any;

    const desktopService = createDesktopService(
      computerService,
      contextManager,
      createMockOutputService(),
      {
        agentConfig: () => ({
          shellModel: "shell-model",
          controlDesktop: true,
          debugPauseSeconds: 0,
        }),
      } as any,
      {
        getLlmModel: vi.fn(() => ({
          supportsComputerUse: true,
          apiType: LlmApiType.OpenAI,
        })),
      } as any,
      {
        getCurrentPath: vi.fn(() => Promise.resolve("/tmp")),
      } as any,
      createMockCommandLoopState() as any,
    );

    await desktopService.confirmAndExecuteActions("", [
      {
        id: "call-1",
        name: "computer",
        input: {
          actions: [{ action: "left_click", coordinate: [10, 20] }],
        },
      },
    ]);

    const toolBlocks = (contextManager.appendDesktopRequest as any).mock.calls[0][1];
    expect(toolBlocks[0].input.viewport).toBeUndefined();
  });
});
