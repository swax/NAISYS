import { describe, expect, test } from "vitest";

import { formatInputWithComputerUse } from "../../../computer-use/vendors/openai-computer-use.js";
import type { ContentBlock, LlmMessage } from "../../../llm/llmDtos.js";

// Minimal stand-ins for the formatter callbacks — these tests focus on the
// computer_call / computer_call_output items that formatInputWithComputerUse
// emits, not on text/image block conversion.
const formatContentBlocks = (content: string | ContentBlock[], role: string) =>
  typeof content === "string"
    ? [{ type: role === "assistant" ? "output_text" : "input_text", text: content }]
    : [];
const formatSingleBlock = () => null;

type Item = Record<string, unknown>;

describe("openai formatInputWithComputerUse", () => {
  test("emits computer_call_output with computer_screenshot for successful results", () => {
    const context: LlmMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call-1",
            name: "computer",
            input: { actions: [{ action: "screenshot" }] },
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

    const items = formatInputWithComputerUse(
      context,
      formatContentBlocks,
      formatSingleBlock,
    ) as Item[];

    const call = items.find((i) => i.type === "computer_call") as Item;
    const output = items.find((i) => i.type === "computer_call_output") as Item;
    expect(call?.call_id).toBe("call-1");
    expect((output?.output as Item)?.type).toBe("computer_screenshot");
  });

  test("drops call+output and emits user text when the tool_result has no screenshot", () => {
    // Reproduces the powershell ETIMEDOUT scenario: the action errors before
    // a screenshot can be captured, so appendDesktopError records a tool_result
    // with isError=true and only a text block. The previous implementation
    // emitted output: { type: "output_text", ... } which OpenAI rejects with
    // "expected a computer call output, but got an object instead".
    const context: LlmMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call-bad",
            name: "computer",
            input: { actions: [{ action: "left_click", coordinate: [10, 20] }] },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            toolUseId: "call-bad",
            isError: true,
            resultContent: [
              { type: "text", text: "spawnSync powershell.exe ETIMEDOUT" },
            ],
          },
        ],
      },
    ];

    const items = formatInputWithComputerUse(
      context,
      formatContentBlocks,
      formatSingleBlock,
    ) as Item[];

    expect(items.find((i) => i.type === "computer_call")).toBeUndefined();
    expect(items.find((i) => i.type === "computer_call_output")).toBeUndefined();
    const userMsg = items.find((i) => i.role === "user") as Item;
    expect(userMsg).toBeDefined();
    const content = userMsg.content as Array<{ type: string; text: string }>;
    expect(content[0].type).toBe("input_text");
    expect(content[0].text).toContain("Desktop action error");
    expect(content[0].text).toContain("ETIMEDOUT");
  });

  test("drops orphan tool_use blocks when scrubbing has removed the matching tool_result", () => {
    // After scrubRecentMedia strips media-bearing blocks, a computer tool_use
    // can be left in the assistant message with no matching tool_result. If
    // we emitted the computer_call anyway OpenAI returns "No tool output
    // found for computer call X".
    const context: LlmMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call-orphan",
            name: "computer",
            input: { actions: [{ action: "screenshot" }] },
          },
        ],
      },
      {
        role: "user",
        content: [
          { type: "text", text: "(scrubbed from context)" },
        ],
      },
    ];

    const items = formatInputWithComputerUse(
      context,
      formatContentBlocks,
      formatSingleBlock,
    ) as Item[];

    expect(items.find((i) => i.type === "computer_call")).toBeUndefined();
  });
});
