import { describe, expect, test } from "vitest";

import { formatContextWithComputerUse } from "../../../computer-use/vendors/google-computer-use.js";
import type { LlmMessage } from "../../../llm/llmDtos.js";
import type { DesktopConfig } from "../../../llm/vendors/vendorTypes.js";

describe("google computer use context formatting", () => {
  test("replays prior tool calls against the viewport they were created in", () => {
    const desktopConfig: DesktopConfig = {
      nativeDisplayWidth: 1920,
      nativeDisplayHeight: 1080,
      viewport: { x: 300, y: 200, width: 800, height: 600 },
      scaledWidth: 800,
      scaledHeight: 600,
      scaleFactor: 1,
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

  test("replays full-desktop actions against their own stamp, not the current focused viewport", () => {
    // Desktop is NOW focused on a 400x400 region, but the stored action
    // was emitted earlier against the full 1000x1000 desktop. The stamp
    // on the action must win over the current desktopConfig.
    const desktopConfig: DesktopConfig = {
      nativeDisplayWidth: 1000,
      nativeDisplayHeight: 1000,
      viewport: { x: 100, y: 100, width: 400, height: 400 },
      scaledWidth: 400,
      scaledHeight: 400,
      scaleFactor: 1,
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
              actions: [{ action: "left_click", coordinate: [500, 500] }],
              // Stamped at emission time: full 1000x1000 desktop.
              viewport: { x: 0, y: 0, width: 1000, height: 1000 },
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
              { type: "image", base64: "abc", mimeType: "image/png" },
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

    // Correct: normalize (500,500) against stamped 1000x1000 → (500, 500).
    // Bug would normalize against current 400x400 viewport → (1250, 1250).
    expect(formatted[0].parts[0].functionCall.args).toEqual({
      x: 500,
      y: 500,
    });
  });
});
