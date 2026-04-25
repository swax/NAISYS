import { LlmApiType } from "@naisys/common";
import { describe, expect, test, vi } from "vitest";

import { createDesktopService } from "../../computer-use/desktop.js";
import type { DesktopConfig } from "../../llm/vendors/vendorTypes.js";
import {
  createMockCommandLoopState,
  createMockContextManager,
  createMockInputMode,
  createMockOutputService,
} from "../mocks.js";

describe("desktop focus commands", () => {
  test("maps screenshot focus coordinates into native desktop focus", async () => {
    const desktopConfig: DesktopConfig = {
      nativeDisplayWidth: 3840,
      nativeDisplayHeight: 2160,
      viewport: { x: 0, y: 0, width: 3840, height: 2160 },
      scaledWidth: 1380,
      scaledHeight: 776,
      scaleFactor: 0.359375,
      desktopPlatform: "Linux (X11)",
    };

    const computerService = {
      getConfig: vi.fn(() => desktopConfig),
      setFocus: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
      executeAction: vi.fn(),
      captureViewportScreenshot: vi.fn(),
      captureScaledScreenshot: vi.fn(),
      platformName: "Linux (X11)",
      initError: undefined,
    } as any;

    const output = createMockOutputService();
    const desktopService = createDesktopService(
      computerService,
      createMockContextManager(),
      output,
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
          supportsVision: true,
          apiType: LlmApiType.OpenAI,
        })),
      } as any,
      {
        getCurrentPath: vi.fn(() => Promise.resolve("/tmp")),
      } as any,
      createMockCommandLoopState() as any,
      createMockInputMode() as any,
    );

    await expect(
      desktopService.handleCommand("focus 0 0 690 388"),
    ).resolves.toBe(
      "Focused on (0, 0, 690x388). That 690x388 region is now shown as scaled 1380x776. Use 'ns-desktop focus clear' to return to the full desktop.",
    );
    expect(output.commentAndLog).toHaveBeenCalledWith(
      "Focus changes can increase next-turn cost because computer-use context has to be refreshed.",
    );

    expect(computerService.setFocus).toHaveBeenCalledWith({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });

  test("stamps every action with the viewport it was emitted against, including full-desktop", async () => {
    const desktopConfig: DesktopConfig = {
      nativeDisplayWidth: 1920,
      nativeDisplayHeight: 1080,
      viewport: { x: 0, y: 0, width: 1920, height: 1080 },
      scaledWidth: 1380,
      scaledHeight: 776,
      scaleFactor: 0.71875,
      desktopPlatform: "Linux (X11)",
    };

    const contextManager = createMockContextManager();
    const computerService = {
      getConfig: vi.fn(() => desktopConfig),
      executeAction: vi.fn(async () => {}),
      captureScaledScreenshot: vi.fn(() =>
        Promise.resolve({
          base64: "abc",
          filepath: "/tmp/screenshot.png",
        }),
      ),
      captureViewportScreenshot: vi.fn(),
      captureFullScreenshot: vi.fn(),
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
          supportsVision: true,
          apiType: LlmApiType.OpenAI,
        })),
      } as any,
      {
        getCurrentPath: vi.fn(() => Promise.resolve("/tmp")),
      } as any,
      createMockCommandLoopState() as any,
      createMockInputMode() as any,
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

    const toolBlocks = (contextManager.appendDesktopRequest as any).mock
      .calls[0][1];
    expect(toolBlocks[0].input.viewport).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });

  test("adds the scaled screenshot to context for non-computer-use models", async () => {
    const desktopConfig: DesktopConfig = {
      nativeDisplayWidth: 1920,
      nativeDisplayHeight: 1080,
      viewport: { x: 0, y: 0, width: 1920, height: 1080 },
      scaledWidth: 1380,
      scaledHeight: 776,
      scaleFactor: 0.71875,
      desktopPlatform: "Linux (X11)",
    };

    const contextManager = createMockContextManager();
    const computerService = {
      getConfig: vi.fn(() => desktopConfig),
      captureScaledScreenshot: vi.fn(() =>
        Promise.resolve({
          base64: "abc123",
          filepath: "/tmp/llm-view.png",
        }),
      ),
      executeAction: vi.fn(),
      captureViewportScreenshot: vi.fn(),
      captureFullScreenshot: vi.fn(),
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
          supportsComputerUse: false,
          supportsVision: true,
          apiType: LlmApiType.OpenAI,
        })),
      } as any,
      {
        getCurrentPath: vi.fn(() => Promise.resolve("/tmp")),
      } as any,
      createMockCommandLoopState() as any,
      createMockInputMode() as any,
    );

    await expect(desktopService.handleCommand("screenshot")).resolves.toBe("");
    expect(contextManager.appendImage).toHaveBeenCalledWith(
      "abc123",
      "image/png",
      "/tmp/llm-view.png",
    );
  });

  test("forwards appendImage rejection reason from screenshot command", async () => {
    const desktopConfig: DesktopConfig = {
      nativeDisplayWidth: 1920,
      nativeDisplayHeight: 1080,
      viewport: { x: 0, y: 0, width: 1920, height: 1080 },
      scaledWidth: 1380,
      scaledHeight: 776,
      scaleFactor: 0.71875,
      desktopPlatform: "Linux (X11)",
    };

    const contextManager = createMockContextManager();
    (contextManager.appendImage as any).mockReturnValue(
      "Error: images are blocked",
    );

    const computerService = {
      getConfig: vi.fn(() => desktopConfig),
      captureScaledScreenshot: vi.fn(() =>
        Promise.resolve({
          base64: "abc",
          filepath: "/tmp/s.png",
        }),
      ),
      executeAction: vi.fn(),
      captureViewportScreenshot: vi.fn(),
      captureFullScreenshot: vi.fn(),
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
          supportsVision: true,
          apiType: LlmApiType.Anthropic,
        })),
      } as any,
      {
        getCurrentPath: vi.fn(() => Promise.resolve("/tmp")),
      } as any,
      createMockCommandLoopState() as any,
      createMockInputMode() as any,
    );

    await expect(desktopService.handleCommand("screenshot")).resolves.toBe(
      "Error: images are blocked",
    );
  });

  test("maps manual click coordinates from the current screenshot to viewport pixels", async () => {
    const desktopConfig: DesktopConfig = {
      nativeDisplayWidth: 3840,
      nativeDisplayHeight: 2160,
      viewport: { x: 0, y: 0, width: 3840, height: 2160 },
      scaledWidth: 1380,
      scaledHeight: 776,
      scaleFactor: 0.359375,
      desktopPlatform: "Windows (WSL)",
    };

    const computerService = {
      getConfig: vi.fn(() => desktopConfig),
      executeAction: vi.fn(async () => {}),
      captureScaledScreenshot: vi.fn(),
      captureViewportScreenshot: vi.fn(),
      captureFullScreenshot: vi.fn(),
      setFocus: vi.fn(),
      platformName: "Windows (WSL)",
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
          supportsVision: true,
          apiType: LlmApiType.OpenAI,
        })),
      } as any,
      {
        getCurrentPath: vi.fn(() => Promise.resolve("/tmp")),
      } as any,
      createMockCommandLoopState() as any,
      createMockInputMode() as any,
    );

    await expect(desktopService.handleCommand("click 828 764")).resolves.toBe(
      "Clicked (left) at screenshot (828, 764)",
    );

    expect(computerService.executeAction).toHaveBeenCalledWith({
      actions: [{ action: "left_click", coordinate: [828, 764] }],
    });
  });

  test("shows desktop status before help output", async () => {
    const desktopConfig: DesktopConfig = {
      nativeDisplayWidth: 1920,
      nativeDisplayHeight: 1080,
      viewport: { x: 100, y: 50, width: 1600, height: 900 },
      scaledWidth: 1380,
      scaledHeight: 776,
      scaleFactor: 0.8625,
      desktopPlatform: "Linux (X11)",
    };

    const computerService = {
      getConfig: vi.fn(() => desktopConfig),
      executeAction: vi.fn(),
      captureScaledScreenshot: vi.fn(),
      captureViewportScreenshot: vi.fn(),
      captureFullScreenshot: vi.fn(),
      setFocus: vi.fn(),
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
          supportsComputerUse: false,
          supportsVision: true,
          apiType: LlmApiType.OpenAI,
        })),
      } as any,
      {
        getCurrentPath: vi.fn(() => Promise.resolve("/tmp")),
      } as any,
      createMockCommandLoopState() as any,
      createMockInputMode() as any,
    );

    const helpText = await desktopService.handleCommand("");

    expect(helpText).toContain("Desktop Status");
    expect(helpText).toContain("Native Screen: 1920x1080");
    expect(helpText).toContain("Viewport: (100, 50, 1600x900)");
    expect(helpText).toContain("LLM View:");
    expect(helpText).toContain("Model Coordinates: scaled pixel space");
    expect(helpText).toContain("Manual Focus Args: current screenshot pixels");
    expect(helpText).toContain("Manual Click Args: current screenshot pixels");
    expect(helpText).toContain("ns-desktop <command>");
    expect(helpText).toContain("key <combo>");
    expect(helpText).toContain(
      "Send a manual key combo or sequence (e.g. enter, escape, ctrl+c, alt+tab, up up right)",
    );
  });
});
