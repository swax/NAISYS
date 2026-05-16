import type { LogPushEntry } from "@naisys/hub-protocol";
import { describe, expect, test } from "vitest";

import type { VoiceUsage } from "./apiClient";
import {
  buildLogDigest,
  buildToolCall,
  extractVoiceUsage,
  MAX_LOG_BUFFER_CHARS,
  MAX_LOG_ENTRY_CHARS,
  shouldNarrateLogEntry,
} from "./voiceMessages";

const logEntry = (
  id: number,
  message: string,
  overrides: Partial<LogPushEntry> = {},
): LogPushEntry => ({
  id,
  previousId: id - 1,
  userId: 1,
  runId: 10,
  sessionId: 20,
  role: "NAISYS",
  source: "console",
  type: "comment",
  message,
  createdAt: `2026-05-01T00:00:${String(id).padStart(2, "0")}.000Z`,
  ...overrides,
});

describe("voiceMessages", () => {
  test("filters low-value log entries from narration in chat mode", () => {
    expect(
      shouldNarrateLogEntry(logEntry(1, "hello", { type: "system" }), "chat"),
    ).toBe(false);
    expect(shouldNarrateLogEntry(logEntry(2, "console noise"), "chat")).toBe(
      false,
    );
    expect(
      shouldNarrateLogEntry(
        logEntry(3, "prompt body", { source: "startPrompt" }),
        "chat",
      ),
    ).toBe(false);
    expect(
      shouldNarrateLogEntry(
        logEntry(4, "meaningful update", { source: "llm" }),
        "chat",
      ),
    ).toBe(true);
  });

  test("console mode keeps console and startPrompt entries but still drops system", () => {
    expect(
      shouldNarrateLogEntry(logEntry(1, "hello", { type: "system" }), "console"),
    ).toBe(false);
    expect(shouldNarrateLogEntry(logEntry(2, "console noise"), "console")).toBe(
      true,
    );
    expect(
      shouldNarrateLogEntry(
        logEntry(3, "prompt body", { source: "startPrompt" }),
        "console",
      ),
    ).toBe(true);
    expect(
      shouldNarrateLogEntry(
        logEntry(4, "meaningful update", { source: "llm" }),
        "console",
      ),
    ).toBe(true);
  });

  test("formats log digests, caps long entries, and preserves source labels", () => {
    const digest = buildLogDigest(
      [
        logEntry(1, "short line", { role: "LLM", source: "llm" }),
        logEntry(2, "x".repeat(MAX_LOG_ENTRY_CHARS + 20)),
      ],
      0,
    );

    expect(digest).toContain("[LLM/llm] short line");
    expect(digest).toContain(
      `[NAISYS/console] ${"x".repeat(MAX_LOG_ENTRY_CHARS)}\u2026`,
    );
  });

  test("drops oldest digest lines when the formatted buffer is too large", () => {
    const entries = Array.from({ length: 40 }, (_, index) =>
      logEntry(index + 1, `entry-${index + 1} ${"x".repeat(390)}`),
    );

    const digest = buildLogDigest(entries, 3);

    expect(digest.length).toBeLessThanOrEqual(MAX_LOG_BUFFER_CHARS);
    expect(digest).toMatch(/^\[older log entries omitted: \d+\]/);
    expect(digest).toContain("entry-40");
    expect(digest).not.toContain("entry-1 ");
  });

  test("maps realtime function calls into server voice tool requests", () => {
    expect(
      buildToolCall(
        "talk_to_agent",
        { message: "please continue" },
        "worker",
        "voice-session-id",
      ),
    ).toEqual({
      tool: "talk_to_agent",
      voiceSessionId: "voice-session-id",
      targetUsername: "worker",
      message: "please continue",
    });

    expect(
      buildToolCall(
        "run_debug_command",
        { command: "pwd" },
        "worker",
        "voice-session-id",
      ),
    ).toEqual({
      tool: "run_debug_command",
      voiceSessionId: "voice-session-id",
      targetUsername: "worker",
      command: "pwd",
    });

    expect(
      buildToolCall(
        "run_command",
        { command: "npm test" },
        "worker",
        "voice-session-id",
      ),
    ).toEqual({
      tool: "run_command",
      voiceSessionId: "voice-session-id",
      targetUsername: "worker",
      command: "npm test",
    });

    expect(
      buildToolCall(
        "talk_to_agent",
        { message: 123 },
        "worker",
        "voice-session-id",
      ),
    ).toBeNull();
    expect(
      buildToolCall("unknown", {}, "worker", "voice-session-id"),
    ).toBeNull();
  });

  test("extracts non-overlapping realtime usage buckets", () => {
    const usage: VoiceUsage = extractVoiceUsage({
      input_token_details: {
        text_tokens: 120,
        audio_tokens: 80,
        image_tokens: 40,
        cached_tokens_details: {
          text_tokens: 20,
          audio_tokens: 50,
          image_tokens: 10,
        },
      },
      output_token_details: {
        text_tokens: 30,
        audio_tokens: 70,
      },
    });

    expect(usage).toEqual({
      inputTextTokens: 100,
      inputAudioTokens: 30,
      inputImageTokens: 30,
      inputCachedTextTokens: 20,
      inputCachedAudioTokens: 50,
      inputCachedImageTokens: 10,
      outputTextTokens: 30,
      outputAudioTokens: 70,
    });
  });

  test("clamps uncached usage at zero when cached details exceed totals", () => {
    expect(
      extractVoiceUsage({
        input_token_details: {
          text_tokens: 5,
          audio_tokens: 7,
          cached_tokens_details: {
            text_tokens: 10,
            audio_tokens: 12,
          },
        },
      }),
    ).toMatchObject({
      inputTextTokens: 0,
      inputAudioTokens: 0,
      inputCachedTextTokens: 10,
      inputCachedAudioTokens: 12,
    });
  });
});
