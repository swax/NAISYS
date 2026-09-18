import type * as GoogleGenAI from "@google/genai";
import { LlmApiType, type LlmModel } from "@naisys/common";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { prepareComputerUse } from "../../computer-use/vendors/anthropic-computer-use.js";
import { sendWithAnthropic } from "../../llm/vendors/anthropic.js";
import { sendWithGoogle } from "../../llm/vendors/google.js";
import { sendWithOpenAiStandard } from "../../llm/vendors/openai-standard.js";
import type { VendorDeps } from "../../llm/vendors/vendorTypes.js";

const mocks = vi.hoisted(() => ({
  anthropic: vi.fn(),
  openai: vi.fn(),
  googleChat: vi.fn(),
  googleSend: vi.fn(),
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mocks.anthropic };
  },
}));
vi.mock("openai", () => ({
  default: class {
    responses = { create: mocks.openai };
  },
}));
vi.mock("@google/genai", async (importOriginal) => ({
  ...(await importOriginal<typeof GoogleGenAI>()),
  GoogleGenAI: class {
    chats = { create: mocks.googleChat };
  },
}));

function setup(
  versionName: string,
  reasoningLevel: LlmModel["reasoningLevel"] = "medium",
) {
  const model: LlmModel = {
    key: "test",
    label: "Test",
    versionName,
    reasoningLevel,
    apiType: LlmApiType.OpenAI,
    apiKeyVar: "TEST_API_KEY",
    maxTokens: 1_000_000,
    inputCost: 1,
    outputCost: 1,
    supportsToolUse: true,
  };
  const recordTokens = vi.fn();
  const deps = {
    modelService: { getLlmModel: () => model },
    costTracker: { recordTokens },
    tools: {
      consoleToolAnthropic: {
        name: "submit_commands",
        input_schema: { type: "object" },
      },
      consoleToolGoogle: { name: "submit_commands" },
      getCommandsFromAnthropicToolUse: () => undefined,
    },
    useToolsForLlmConsoleResponses: true,
  } as unknown as VendorDeps;
  return { deps, recordTokens };
}
const context = [{ role: "user" as const, content: "Reply OK" }];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.anthropic.mockResolvedValue({
    content: [{ type: "text", text: "OK" }],
    usage: { input_tokens: 20, output_tokens: 5 },
  });
  mocks.openai.mockResolvedValue({
    output: [],
    output_text: "OK",
    usage: {
      input_tokens: 1000,
      output_tokens: 5,
      input_tokens_details: { cached_tokens: 300, cache_write_tokens: 500 },
    },
  });
  mocks.googleChat.mockImplementation(() => ({
    sendMessage: mocks.googleSend,
  }));
  mocks.googleSend.mockResolvedValue({
    text: "OK",
    candidates: [],
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 5,
      thoughtsTokenCount: 20,
      cachedContentTokenCount: 30,
    },
  });
});

describe("current provider compatibility", () => {
  test("empty provider refusals surface their stop reason", async () => {
    mocks.anthropic.mockResolvedValue({
      content: [],
      stop_reason: "refusal",
      usage: { input_tokens: 20, output_tokens: 5 },
    });
    const { deps } = setup("claude-opus-5");
    await expect(
      sendWithAnthropic(deps, "test", "System", context, "console", "test-key"),
    ).rejects.toThrow("stop reason: refusal");
  });
  test.each([
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-fable-5-1",
    "claude-opus-4-6",
  ])(
    "%s uses adaptive thinking and allows automatic tool selection",
    async (name) => {
      const { deps } = setup(name);
      await sendWithAnthropic(
        deps,
        "test",
        "System",
        context,
        "console",
        "test-key",
      );
      expect(mocks.anthropic.mock.calls[0][0]).toMatchObject({
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        tool_choice: { type: "auto" },
      });
    },
  );
  test("Haiku keeps its supported manual thinking budget", async () => {
    const { deps } = setup("claude-haiku-4-5");
    await sendWithAnthropic(
      deps,
      "test",
      "System",
      context,
      "console",
      "test-key",
    );
    expect(mocks.anthropic.mock.calls[0][0].thinking).toEqual({
      type: "enabled",
      budget_tokens: 2048,
    });
  });
  test("none explicitly disables the new Claude default thinking", async () => {
    const { deps } = setup("claude-opus-5", "none");
    await sendWithAnthropic(
      deps,
      "test",
      "System",
      context,
      "console",
      "test-key",
    );
    expect(mocks.anthropic.mock.calls[0][0]).toMatchObject({
      thinking: { type: "disabled" },
      tool_choice: { type: "tool", name: "submit_commands" },
    });
  });
  test("Fable rejects disabled thinking before sending a request", async () => {
    const { deps } = setup("claude-fable-5-1", "none");
    await expect(
      sendWithAnthropic(deps, "test", "System", context, "console", "test-key"),
    ).rejects.toThrow("requires thinking");
    expect(mocks.anthropic).not.toHaveBeenCalled();
  });
  test.each([
    ["gemini-3.8-flash", "medium", { thinkingLevel: "MEDIUM" }],
    ["gemini-3.8-flash", "none", { thinkingLevel: "LOW" }],
    ["gemini-3.1-pro-preview", "max", { thinkingLevel: "HIGH" }],
    ["gemini-3-flash-preview", "none", { thinkingLevel: "MINIMAL" }],
    [
      "gemini-2.5-computer-use-preview-10-2025",
      "medium",
      { thinkingBudget: 8192 },
    ],
  ] as const)(
    "%s maps %s to a supported thinking config",
    async (name, level, expected) => {
      const { deps } = setup(name, level);
      await sendWithGoogle(
        deps,
        "test",
        "System",
        context,
        "compact",
        "test-key",
      );
      expect(mocks.googleChat.mock.calls[0][0].config.thinkingConfig).toEqual(
        expected,
      );
    },
  );
  test("Google bills hidden thinking as output without adding it to context", async () => {
    const { deps, recordTokens } = setup("gemini-3.8-flash");
    const result = await sendWithGoogle(
      deps,
      "test",
      "System",
      context,
      "compact",
      "test-key",
    );
    expect(result.messagesTokenCount).toBe(100);
    expect(recordTokens).toHaveBeenCalledWith("compact", "test", 70, 25, 0, 30);
  });
  test("OpenAI separates cache writes from ordinary input and cache reads", async () => {
    const { deps, recordTokens } = setup("gpt-6-astra");
    const result = await sendWithOpenAiStandard(
      deps,
      "test",
      "System",
      context,
      "compact",
      "test-key",
    );
    expect(result.messagesTokenCount).toBe(1000);
    expect(recordTokens).toHaveBeenCalledWith(
      "compact",
      "test",
      200,
      5,
      500,
      300,
    );
  });
  test.each([
    ["claude-opus-5", "computer_20251124"],
    ["claude-sonnet-5", "computer_20251124"],
    ["claude-fable-5-1", "computer_20251124"],
    ["claude-haiku-4-5", "computer_20250124"],
    ["claude-sonnet-4-5", "computer_20250124"],
  ])("%s selects its compatible computer tool", (name, toolType) => {
    const result = prepareComputerUse(
      {
        scaledWidth: 1024,
        scaledHeight: 768,
      } as VendorDeps["desktopConfig"] & {},
      name,
    );
    expect(result.computerTool.type).toBe(toolType);
  });
});
