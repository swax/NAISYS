import { z } from "zod";

/**
 * Types for the voice agent feature — a browser-held gpt-realtime session
 * that operates a running NAISYS agent. The supervisor is the thin action
 * backend: mints the token, executes tool calls, records cost. All routes
 * are mounted under `/agents/:username/voice/*` (X in URL, Y in body).
 * See docs/019-voice-agent.md.
 */

/** The three tools the voice agent can call to operate the target agent. */
export const VoiceToolNameSchema = z.enum([
  "talk_to_agent",
  "run_debug_command",
  "run_command",
]);
export type VoiceToolName = z.infer<typeof VoiceToolNameSchema>;

/** Perspective the voice session is opened from. `chat` impersonates a chat
 *  sender (talk-only); `console` speaks as the admin operator (full shell
 *  toolset, full run-log narration — the more verbose mode). */
export const VoiceModeSchema = z.enum(["chat", "console"]);
export type VoiceMode = z.infer<typeof VoiceModeSchema>;

/** Tools allowed for a given mode. Baked into the realtime session config and
 *  re-checked on /voice/tool so a tampered client can't widen its toolset. */
export function voiceToolsForMode(mode: VoiceMode): VoiceToolName[] {
  return mode === "chat"
    ? ["talk_to_agent"]
    : ["talk_to_agent", "run_debug_command", "run_command"];
}

/** Opaque server-minted session id, bound to (user, X, Y) at mint. Required
 *  on /voice/cost and /voice/tool so neither trusts raw browser claims. */
export const VoiceSessionIdSchema = z.string().min(16).max(128);

/** POST /agents/:username/voice/token — mint an ephemeral gpt-realtime session.
 *  `:username` is X; the body carries Y (the target agent being operated)
 *  and the mode the session is opened in. */
export const VoiceTokenRequestSchema = z
  .object({
    targetUsername: z.string().min(1),
    mode: VoiceModeSchema,
  })
  .strict();
export type VoiceTokenRequest = z.infer<typeof VoiceTokenRequestSchema>;

export const VoiceTokenResponseSchema = z.object({
  success: z.boolean(),
  /** Ephemeral client secret — usable browser-side to open the WebRTC call. */
  clientSecret: z.string(),
  /** ISO timestamp when the ephemeral secret expires (~1 minute out). */
  expiresAt: z.string(),
  /** The gpt-realtime model id the browser should connect with. */
  model: z.string(),
  /** Server-minted session id; required on subsequent /voice/cost and
   *  /voice/tool calls. */
  voiceSessionId: VoiceSessionIdSchema,
  /** Resolved session participants, echoed for the floating control's display. */
  fromUsername: z.string(),
  fromTitle: z.string(),
  targetUsername: z.string(),
  targetTitle: z.string(),
  /** Echoed back so the client can branch on mode without remembering the
   *  request body. */
  mode: VoiceModeSchema,
});
export type VoiceTokenResponse = z.infer<typeof VoiceTokenResponseSchema>;

/** POST /agents/:username/voice/tool — execute a tool call the voice agent
 *  made. Forwarded from the browser data channel; every call is re-authorized
 *  server-side against the supervisor user's permissions. */
export const VoiceToolCallRequestSchema = z.discriminatedUnion("tool", [
  z
    .object({
      tool: z.literal("talk_to_agent"),
      voiceSessionId: VoiceSessionIdSchema,
      targetUsername: z.string().min(1),
      message: z.string().min(1),
    })
    .strict(),
  z
    .object({
      tool: z.literal("run_debug_command"),
      voiceSessionId: VoiceSessionIdSchema,
      targetUsername: z.string().min(1),
      command: z.string().min(1),
    })
    .strict(),
  z
    .object({
      tool: z.literal("run_command"),
      voiceSessionId: VoiceSessionIdSchema,
      targetUsername: z.string().min(1),
      command: z.string().min(1),
    })
    .strict(),
]);
export type VoiceToolCallRequest = z.infer<typeof VoiceToolCallRequestSchema>;

export const VoiceToolCallResponseSchema = z.object({
  success: z.boolean(),
  /** Short text result fed back to the realtime model as the tool output. */
  result: z.string(),
});
export type VoiceToolCallResponse = z.infer<typeof VoiceToolCallResponseSchema>;

/** gpt-realtime token usage from a `response.done` event, broken down so the
 *  server can price audio/text/cached separately. Per-field maximums clamp
 *  a malicious or malformed turn — realistic turns are well under the caps. */
const VOICE_MAX_TOKENS_PER_TURN = 50_000;
const VOICE_MAX_CACHED_TOKENS_PER_TURN = 200_000;
export const VoiceUsageSchema = z.object({
  inputTextTokens: z
    .number()
    .nonnegative()
    .max(VOICE_MAX_TOKENS_PER_TURN)
    .default(0),
  inputAudioTokens: z
    .number()
    .nonnegative()
    .max(VOICE_MAX_TOKENS_PER_TURN)
    .default(0),
  inputCachedTextTokens: z
    .number()
    .nonnegative()
    .max(VOICE_MAX_CACHED_TOKENS_PER_TURN)
    .default(0),
  inputCachedAudioTokens: z
    .number()
    .nonnegative()
    .max(VOICE_MAX_CACHED_TOKENS_PER_TURN)
    .default(0),
  outputTextTokens: z
    .number()
    .nonnegative()
    .max(VOICE_MAX_TOKENS_PER_TURN)
    .default(0),
  outputAudioTokens: z
    .number()
    .nonnegative()
    .max(VOICE_MAX_TOKENS_PER_TURN)
    .default(0),
});
export type VoiceUsage = z.infer<typeof VoiceUsageSchema>;

/** POST /agents/:username/voice/cost — push one `response.done`'s usage.
 *  Per-turn (not batched) so a tab close only loses the last partial turn.
 *  Server prices it; client only reports token counts. */
export const VoiceCostRequestSchema = z
  .object({
    voiceSessionId: VoiceSessionIdSchema,
    usage: VoiceUsageSchema,
  })
  .strict();
export type VoiceCostRequest = z.infer<typeof VoiceCostRequestSchema>;

export const VoiceCostResponseSchema = z.object({
  success: z.boolean(),
  /** Dollar cost recorded for this turn, if a row was written. */
  cost: z.number().optional(),
  /** True when cumulative voice spend has reached the admin agent's cap.
   *  Voice runs outside COST_CONTROL — the client must hang up itself. */
  overBudget: z.boolean().optional(),
  /** Why cost recording failed, when `success` is false. The client hangs
   *  up on any non-success so cost can't accrue on a stalled accounting path. */
  message: z.string().optional(),
});
export type VoiceCostResponse = z.infer<typeof VoiceCostResponseSchema>;
