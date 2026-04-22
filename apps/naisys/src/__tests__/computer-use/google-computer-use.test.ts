import { describe, expect, test } from "vitest";

import { formatContextWithComputerUse } from "../../computer-use/google-computer-use.js";
import type { LlmMessage } from "../../llm/llmDtos.js";
import type { DesktopConfig } from "../../llm/vendors/vendorTypes.js";

describe("google computer use context formatting", () => {
  test("replays prior tool calls against the viewport they were created in", () => {
    const desktopConfig: DesktopConfig = {
      displayWidth: 800,
      displayHeight: 600,
      nativeDisplayWidth: 1920,
      nativeDisplayHeight: 1080,
      viewport: { x: 300, y: 200, width: 800, height: 600 },
      desktopPlatform: "Linux (X11)",
    };

    const context: LlmMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call-1",
            name: "click_at",
            input: {
              actions: [{ action: "left_click", coordinate: [50, 25] }],
              viewport: { x: 10, y: 20, width: 100, height: 50 },
            },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            toolUseId: "call-1",
            resultContent: [
              {
                type: "image",
                base64: "abc",
                mimeType: "image/png",
              },
            ],
          },
        ],
      },
    ];

    const formatted = formatContextWithComputerUse(
      context,
      desktopConfig,
      () => [],
    );

    expect(formatted[0].parts[0].functionCall.args).toEqual({
      x: 500,
      y: 500,
    });
    expect(formatted[1].parts[0].functionResponse.name).toBe("click_at");
  });
});
