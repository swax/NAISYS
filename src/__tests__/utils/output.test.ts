import { describe, expect, it, jest } from "@jest/globals";
import { LlmMessage, LlmRole } from "../../llm/llmDtos.js";
import { mockConfig } from "../mocks.js";
/*
mockConfig();

// Mock logService module
const mockLogServiceWrite = jest
  .fn<(message: LlmMessage) => Promise<number | undefined>>()
  .mockResolvedValue(1);

jest.unstable_mockModule("../../services/logService.js", () => ({
  write: mockLogServiceWrite,
}));

// Load target module
const output = await import("../../utils/output.js");

describe("commentAndLog function", () => {
  it("should call writeDbLog with the correct arguments", async () => {
    // Assuming you've refactored commentAndLog to take logService or its functionality as a parameter
    await output.commentAndLog("Test message");

    // Verify the mock was called correctly
    expect(mockLogServiceWrite).toHaveBeenCalledWith({
      content: "Test message",
      role: LlmRole.User,
      type: "comment",
    });
  });
});*/
