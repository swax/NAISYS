import { describe, expect, it, jest } from "@jest/globals";
import { LlmMessage } from "../../llm/llmDtos.js";

jest.unstable_mockModule("../../config.js", () => ({}));

const mockLogServiceWrite = jest
  .fn<(message: LlmMessage) => Promise<number | undefined>>()
  .mockResolvedValue(1);

jest.unstable_mockModule("../../utils/logService.js", () => ({
  write: mockLogServiceWrite,
}));

const output = await import("../../utils/output.js");

describe("commentAndLog function", () => {
  it("should call writeDbLog with the correct arguments", async () => {
    // Assuming you've refactored commentAndLog to take logService or its functionality as a parameter
    await output.commentAndLog("Test message");

    // Verify the mock was called correctly
    expect(mockLogServiceWrite).toHaveBeenCalledWith({
      content: "Test message",
      role: "user",
      type: "comment",
    });
  });
});
