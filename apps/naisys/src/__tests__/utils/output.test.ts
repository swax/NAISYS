import { describe, expect, it, vi } from "vitest";

import type { LlmMessage } from "../../llm/llmDtos.js";
import { createOutputService } from "../../utils/output.js";
import { createMockLogService } from "../mocks.js";

const mockLogService = createMockLogService();

// Mock logService module
mockLogService.write =
  vi.fn<(message: LlmMessage, filepath?: string) => void>();

// Load target module
const output = createOutputService(mockLogService);

describe("commentAndLog function", () => {
  it("should call writeDbLog with the correct arguments", () => {
    // Assuming you've refactored commentAndLog to take logService or its functionality as a parameter
    output.commentAndLog("Test message");

    // Verify the mock was called correctly
    expect(mockLogService.write).toHaveBeenCalledWith({
      content: "Test message",
      role: "user",
      type: "comment",
    });
  });
});
