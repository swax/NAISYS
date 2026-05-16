import type { LogPushEntry } from "@naisys/hub-protocol";

import type { VoiceMode, VoiceToolCallRequest, VoiceUsage } from "../api/apiClient";

/** Per-entry cap on injected run-log text — keeps a single huge command's
 *  output from blowing up realtime token cost. */
export const MAX_LOG_ENTRY_CHARS = 800;

/** Hard bound on the formatted run-log digest injected as one conversation
 *  item. This is separate from the per-entry cap because many small entries
 *  can still add up during a long response. */
export const MAX_LOG_BUFFER_CHARS = 12_000;

/** Run-log entries worth narrating. Mode shapes what reaches the voice agent:
 *  chat-mode mirrors what a chat user already sees (skips console + startPrompt);
 *  console-mode is the verbose view and mirrors the full run log (includes them). */
export function shouldNarrateLogEntry(
  e: LogPushEntry,
  mode: VoiceMode,
): boolean {
  if (e.type === "system") return false;
  if (mode === "chat") {
    if (e.source === "console") return false;
    if (e.source === "startPrompt") return false;
  }
  return true;
}

/** Build the coalesced digest from buffered entries. Drops oldest lines
 *  first when over MAX_LOG_BUFFER_CHARS, and prefixes a "[older log entries
 *  omitted: N]" marker that counts entries dropped both upstream (entry
 *  cap) and here (char cap). */
export function buildLogDigest(
  entries: LogPushEntry[],
  omittedBeforeEntries: number,
): string {
  const lines: string[] = [];
  let charOmittedCount = 0;

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const line = formatLogEntry(entries[i]);
    const nextChars =
      joinedLineChars(lines) + line.length + (lines.length > 0 ? 1 : 0);
    if (nextChars > MAX_LOG_BUFFER_CHARS) {
      charOmittedCount = i + 1;
      break;
    }
    lines.unshift(line);
  }

  let omittedCount = omittedBeforeEntries + charOmittedCount;
  if (omittedCount === 0) return lines.join("\n");

  let omittedLine = `[older log entries omitted: ${omittedCount}]`;
  while (
    lines.length > 0 &&
    joinedLineChars([omittedLine, ...lines]) > MAX_LOG_BUFFER_CHARS
  ) {
    lines.shift();
    omittedCount += 1;
    omittedLine = `[older log entries omitted: ${omittedCount}]`;
  }

  return [omittedLine, ...lines].join("\n");
}

function joinedLineChars(lines: string[]): number {
  return lines.reduce(
    (total, line, index) => total + line.length + (index > 0 ? 1 : 0),
    0,
  );
}

function formatLogEntry(e: LogPushEntry): string {
  const text =
    e.message.length > MAX_LOG_ENTRY_CHARS
      ? `${e.message.slice(0, MAX_LOG_ENTRY_CHARS)}…`
      : e.message;
  return `[${e.role}${e.source ? `/${e.source}` : ""}] ${text}`;
}

/** Map a realtime function_call's name + args into a server-side voice tool
 *  request. The target agent is implicit (the session is locked to one
 *  target in phase 1), so the model only supplies the message/command. */
export function buildToolCall(
  name: string,
  args: Record<string, unknown>,
  targetUsername: string,
  voiceSessionId: string,
): VoiceToolCallRequest | null {
  if (name === "talk_to_agent" && typeof args.message === "string") {
    return {
      tool: "talk_to_agent",
      voiceSessionId,
      targetUsername,
      message: args.message,
    };
  }
  if (name === "run_debug_command" && typeof args.command === "string") {
    return {
      tool: "run_debug_command",
      voiceSessionId,
      targetUsername,
      command: args.command,
    };
  }
  if (name === "run_command" && typeof args.command === "string") {
    return {
      tool: "run_command",
      voiceSessionId,
      targetUsername,
      command: args.command,
    };
  }
  return null;
}

/** Fold a realtime `response.done` usage object into our non-overlapping
 *  (uncached vs. cached) buckets. */
export function extractVoiceUsage(usage: unknown): VoiceUsage {
  const u = (usage ?? {}) as Record<string, any>;
  const itd = (u.input_token_details ?? {}) as Record<string, any>;
  const ctd = (itd.cached_tokens_details ?? {}) as Record<string, any>;
  const otd = (u.output_token_details ?? {}) as Record<string, any>;

  const inputCachedText = Number(ctd.text_tokens ?? 0);
  const inputCachedAudio = Number(ctd.audio_tokens ?? 0);
  const inputCachedImage = Number(ctd.image_tokens ?? 0);

  return {
    inputTextTokens: Math.max(
      0,
      Number(itd.text_tokens ?? 0) - inputCachedText,
    ),
    inputAudioTokens: Math.max(
      0,
      Number(itd.audio_tokens ?? 0) - inputCachedAudio,
    ),
    inputImageTokens: Math.max(
      0,
      Number(itd.image_tokens ?? 0) - inputCachedImage,
    ),
    inputCachedTextTokens: inputCachedText,
    inputCachedAudioTokens: inputCachedAudio,
    inputCachedImageTokens: inputCachedImage,
    outputTextTokens: Number(otd.text_tokens ?? 0),
    outputAudioTokens: Number(otd.audio_tokens ?? 0),
  };
}
