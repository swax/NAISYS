import { describe, expect, jest, test } from "@jest/globals";
import { ContentSource } from "../../llm/llmDtos.js";
import * as inputMode from "../../utils/inputMode.js";
import { InputMode } from "../../utils/inputMode.js";
import { mockConfig } from "../mocks.js";

mockConfig();

jest.unstable_mockModule("../../services/logService.js", () => ({
  recordContext: jest.fn(),
  roleToSource: jest.fn(),
  write: jest.fn(),
}));

jest.unstable_mockModule("../../utils/output.js", () => ({
  comment: jest.fn(),
  log: jest.fn(),
  write: jest.fn(),
  OutputColor: { llm: "llm", console: "console" },
}));

// Load target module
const contextManager = await import("../../llm/contextManager.js");

describe("trim function", () => {
  test("happy path", async () => {
    // Arrange
    inputMode.toggle(InputMode.LLM);

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
