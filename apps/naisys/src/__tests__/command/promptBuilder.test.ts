import { describe, expect, test } from "vitest";

import { noWait } from "../../command/commandRegistry.js";
import { createPromptBuilder } from "../../command/promptBuilder.js";
import { getPlatformConfig } from "../../services/shellPlatform.js";
import { createInputMode } from "../../utils/inputMode.js";
import { createPromptNotificationService } from "../../utils/promptNotificationService.js";
import {
  createMockAgentConfig,
  createMockContextManager,
  createMockCostTracker,
  createMockGlobalConfig,
  createMockOutputService,
  createMockShellWrapper,
} from "../mocks.js";

describe("promptBuilder wait behavior", () => {
  test("resolves immediately when wait is none", async () => {
    const output = createMockOutputService();
    const promptBuilder = createPromptBuilder(
      createMockGlobalConfig(),
      createMockAgentConfig(),
      createMockShellWrapper(),
      createMockContextManager(),
      createMockCostTracker(),
      output,
      createInputMode(),
      getPlatformConfig(),
      createPromptNotificationService(),
      1,
    );

    await expect(promptBuilder.getInput("prompt", noWait())).resolves.toBe("");
    expect(output.comment).not.toHaveBeenCalled();
  });
});
