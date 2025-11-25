import { describe, expect, test } from "@jest/globals";
import { createContextManager } from "../../llm/contextManager.js";
import { ContentSource } from "../../llm/llmDtos.js";
import {
  createMockGlobalConfig,
  createMockInputMode,
  createMockLogService,
  createMockOutputService,
  createMockWorkspacesFeature,
} from "../mocks.js";

const systemMessage = "system";

describe("trim function", () => {
  test("happy path", async () => {
    const mockInputMode = createMockInputMode();
    mockInputMode.isDebug.mockReturnValue(false);
    mockInputMode.isLLM.mockReturnValue(true);

    const contextManager = createContextManager(
      createMockGlobalConfig(),
      createMockWorkspacesFeature(),
      systemMessage,
      createMockOutputService(),
      createMockLogService(),
      mockInputMode,
    );

    // Arrange
    for (let i = 1; i <= 20; i++) {
      await contextManager.append(
        `${i}. prompt$`,
        ContentSource.ConsolePrompt,
        i,
      );
      await contextManager.append(
        `${i}. LLM Command`,
        ContentSource.LlmPromptResponse,
      );
      await contextManager.append(
        `${i}. Console Response`,
        ContentSource.Console,
      );
      await contextManager.append(
        `${i}. Continuing LLM Command`,
        ContentSource.LLM,
      );
      await contextManager.append(
        `${i}. Console Response`,
        ContentSource.Console,
      );
    }

    // Act
    contextManager.trim("1, 3-5, 10-13, 17");

    // Assert
    const msgs = contextManager.exportedForTesting.getMessages();

    const getMsgIndexCount = (index: number) =>
      msgs.filter((msg) => msg.content.startsWith(`${index}. `)).length;

    for (const index of [2, 6, 7, 8, 9, 14, 15, 16, 18, 19, 20]) {
      expect(getMsgIndexCount(index)).toBe(5);
    }

    for (const index of [1, 3, 4, 5, 10, 11, 12, 13, 17]) {
      expect(getMsgIndexCount(index)).toBe(0);
    }
  });
});
