import { describe, expect, it, jest } from "@jest/globals";
import { LlmMessage, LlmRole } from "../../llm/llmDtos.js";
import { createOutputService } from "../../utils/output.js";
import { createMockLogService } from "../mocks.js";

const mockLogService = createMockLogService();

// Mock logService module
mockLogService.write = jest
  .fn<(message: LlmMessage) => Promise<number>>()
  .mockResolvedValue(1);

// Load target module
const output = createOutputService(mockLogService);

describe("commentAndLog function", () => {
  it("should call writeDbLog with the correct arguments", async () => {
    // Assuming you've refactored commentAndLog to take logService or its functionality as a parameter
    await output.commentAndLog("Test message");

    // Verify the mock was called correctly
    expect(mockLogService.write).toHaveBeenCalledWith({
      content: "Test message",
      role: LlmRole.User,
      type: "comment",
    });
  });
});
