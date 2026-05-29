import { LlmApiType } from "@naisys/common";
import { vi } from "vitest";

import { createDesktopService } from "../../computer-use/desktop.js";
import { createDesktopClaimService } from "../../computer-use/desktopClaimService.js";
import type { DesktopConfig } from "../../llm/vendors/vendorTypes.js";
import {
  createMockCommandLoopState,
  createMockContextManager,
  createMockInputMode,
  createMockOutputService,
} from "../mocks.js";

export type ComputerUseModelOverrides = {
  supportsComputerUse?: boolean;
  supportsVision?: boolean;
  apiType?: LlmApiType;
};

export function makeDesktopConfig(
  overrides: Partial<DesktopConfig> = {},
): DesktopConfig {
  return {
    nativeDisplayWidth: 1920,
    nativeDisplayHeight: 1080,
    viewport: { x: 0, y: 0, width: 1920, height: 1080 },
    scaledWidth: 1380,
    scaledHeight: 776,
    scaleFactor: 0.71875,
    desktopPlatform: "Linux (X11)",
    ...overrides,
  };
}

export function makeComputerService(
  desktopConfig: DesktopConfig,
  overrides: Record<string, unknown> = {},
) {
  return {
    getConfig: vi.fn(() => desktopConfig),
    setFocus: vi.fn(),
    executeAction: vi.fn(),
    captureViewportScreenshot: vi.fn(),
    captureScaledScreenshot: vi.fn(),
    captureMarkedScreenshot: vi.fn(),
    captureFullScreenshot: vi.fn(),
    platformName: desktopConfig.desktopPlatform,
    initError: undefined,
    ...overrides,
  } as any;
}

export function makeComputerUseModel(
  overrides: ComputerUseModelOverrides = {},
) {
  return {
    supportsComputerUse: true,
    supportsVision: true,
    apiType: LlmApiType.OpenAI,
    ...overrides,
  };
}

export type BuildDesktopServiceOverrides = {
  config?: Partial<DesktopConfig>;
  computerService?: Record<string, unknown>;
  model?: ComputerUseModelOverrides;
  agentUsername?: string;
  desktopClaimService?: ReturnType<typeof createDesktopClaimService>;
};

export function buildDesktopService(
  overrides: BuildDesktopServiceOverrides = {},
) {
  const desktopConfig = makeDesktopConfig(overrides.config);
  const computerService = makeComputerService(
    desktopConfig,
    overrides.computerService,
  );
  const contextManager = createMockContextManager();
  const output = createMockOutputService();
  const model = makeComputerUseModel(overrides.model);
  const desktopClaimService =
    overrides.desktopClaimService ?? createDesktopClaimService();
  const agentUsername = overrides.agentUsername ?? "test-agent";

  const desktopService = createDesktopService(
    computerService,
    contextManager,
    output,
    {
      agentConfig: () => ({
        username: agentUsername,
        shellModel: "shell-model",
        controlDesktop: true,
        debugPauseSeconds: 0,
      }),
    } as any,
    {
      getLlmModel: vi.fn(() => model),
    } as any,
    {
      getCurrentPath: vi.fn(() => Promise.resolve("/tmp")),
    } as any,
    createMockCommandLoopState() as any,
    createMockInputMode() as any,
    desktopClaimService,
  );

  return {
    desktopService,
    desktopConfig,
    computerService,
    contextManager,
    output,
    model,
    desktopClaimService,
    agentUsername,
  };
}
