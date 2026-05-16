import type { LogPushEntry } from "@naisys/hub-protocol";

import type { VoiceMode } from "../api/apiClient";
import {
  executeVoiceTool,
  mintVoiceToken,
  recordVoiceCost,
} from "../api/apiVoice";
import { buildToolCall, extractVoiceUsage } from "./voiceMessages";
import { createNarrationScheduler } from "./voiceNarrationScheduler";
import { createVoiceRealtimeTransport } from "./voiceRealtimeTransport";

/**
 * A single browser-held gpt-realtime voice session against a target NAISYS
 * agent. One call = one instance. Orchestrates the token mint, the WebRTC
 * transport, the narration scheduler (timing + gate state), tool dispatch,
 * and cost recording. Audio runs browser↔OpenAI over WebRTC; the
 * supervisor is only an action backend.
 *
 * Lifecycle:
 *   - `start()` is fire-and-forget — failures route through `onError`.
 *   - `abort()` is silent teardown (hang-up / session replace). Idempotent.
 *   - `fail(reason)` aborts + calls `onError` (transport error, budget hit).
 *   - Handlers and post-await branches bail when the session is aborted.
 */

export interface VoiceSessionDisplay {
  fromUsername: string;
  fromTitle: string;
  targetUsername: string;
  targetTitle: string;
}

export interface VoiceSessionParams {
  fromUsername: string;
  fromTitle: string;
  targetUsername: string;
  targetTitle: string;
  mode: VoiceMode;
}

export interface VoiceSessionCallbacks {
  /** Audio sink for remote audio. Read on every `ontrack` so it tolerates a
   *  late-mounting `<audio>` element. */
  getAudioElement: () => HTMLAudioElement | null;
  /** Server-resolved display info (e.g. the admin-fallback may rename X). */
  onDisplayResolved: (display: VoiceSessionDisplay) => void;
  /** Data channel reached `"open"` — session is fully live. */
  onLive: () => void;
  /** A `response.done` turn's recorded cost, in dollars. Fires once per
   *  successful cost record so the provider can keep a running call total. */
  onCostRecorded: (cost: number) => void;
  /** Loud teardown. The instance is fully aborted by the time this fires;
   *  the provider should drop its reference and show the reason. */
  onError: (reason: string) => void;
}

export interface VoiceSession {
  readonly fromUsername: string;
  readonly fromTitle: string;
  readonly targetUsername: string;
  readonly targetTitle: string;
  readonly mode: VoiceMode;
  readonly aborted: boolean;
  start(): Promise<void>;
  abort(): void;
  /** Suppress / restore outbound mic audio. The session stays connected. */
  setMicMuted(muted: boolean): void;
  injectLogEntries(entries: LogPushEntry[]): void;
}

/** A NAISYS voice session backed by an OpenAI gpt-realtime call. */
export function createVoiceSession(
  params: VoiceSessionParams,
  callbacks: VoiceSessionCallbacks,
): VoiceSession {
  const { fromUsername, fromTitle, targetUsername, targetTitle, mode } = params;

  let voiceSessionId: string | undefined;
  let resolved: VoiceSessionDisplay | undefined;

  const controller = new AbortController();

  const transport = createVoiceRealtimeTransport({
    isAborted,
    getAudioElement: callbacks.getAudioElement,
    onChannelOpen: handleChannelOpen,
    onRealtimeEvent: (event) => void handleRealtimeEvent(event),
    onError: fail,
  });

  const scheduler = createNarrationScheduler({
    isAborted,
    isChannelOpen: () => transport.isChannelOpen(),
    sendEvent: (event) => transport.sendEvent(event),
    getTargetUsername: () => resolved?.targetUsername ?? params.targetUsername,
    mode,
  });

  const session: VoiceSession = {
    fromUsername,
    fromTitle,
    targetUsername,
    targetTitle,
    mode,
    get aborted() {
      return isAborted();
    },
    start,
    abort,
    setMicMuted,
    injectLogEntries,
  };

  /** True once `abort()` (silent) or `fail()` (loud) has run. After this,
   *  all handlers and post-await branches short-circuit. */
  function isAborted(): boolean {
    return controller.signal.aborted;
  }

  /** Run the full mint + SDP exchange and bring the session up. Never
   *  throws — failures route through `onError`. Returns when the SDP
   *  exchange completes, but the session isn't "live" until `onLive` fires
   *  (the data channel reaches `open`). */
  async function start(): Promise<void> {
    try {
      const token = await mintVoiceToken(fromUsername, targetUsername, mode);
      if (isAborted()) return;

      voiceSessionId = token.voiceSessionId;
      resolved = {
        fromUsername: token.fromUsername,
        fromTitle: token.fromTitle,
        targetUsername: token.targetUsername,
        targetTitle: token.targetTitle,
      };
      callbacks.onDisplayResolved(resolved);

      await transport.connect({
        clientSecret: token.clientSecret,
        signal: controller.signal,
      });
    } catch (error) {
      if (isAborted()) return;
      console.error("[Voice] failed to start session:", error);
      fail(
        error instanceof Error
          ? error.message
          : "Failed to start the voice session.",
      );
    }
  }

  /** Silent teardown — user-initiated hang-up, or the provider replacing
   *  this instance. Idempotent. Does NOT fire `onError`. */
  function abort(): void {
    if (controller.signal.aborted) return;
    controller.abort();
    teardown();
  }

  /** Buffer inbound run-log activity. Coalesced into a single
   *  conversation.item.create by the scheduler's log buffer. */
  function injectLogEntries(entries: LogPushEntry[]): void {
    scheduler.injectLogEntries(entries);
  }

  function setMicMuted(muted: boolean): void {
    transport.setMicMuted(muted);
  }

  // --- internal helpers ---

  function handleChannelOpen(): void {
    scheduler.markLive();
    callbacks.onLive();
  }

  async function handleRealtimeEvent(
    event: Record<string, any>,
  ): Promise<void> {
    switch (event.type) {
      case "response.created":
        scheduler.onResponseCreated();
        break;

      case "input_audio_buffer.speech_started":
        scheduler.onUserSpeechStarted();
        break;

      case "input_audio_buffer.speech_stopped":
        scheduler.onUserSpeechStopped();
        break;

      case "response.done":
        await handleResponseDone(event);
        break;

      case "error":
        console.error("[Voice] realtime error:", event.error ?? event);
        break;
    }
  }

  async function handleResponseDone(event: Record<string, any>): Promise<void> {
    const response = event.response ?? {};
    const fromUsernameLive = resolved?.fromUsername ?? params.fromUsername;

    scheduler.onResponseDone();
    await dispatchToolCalls(response);

    // Cost recording runs even after abort — the tokens were used. The
    // server-side session id stays valid through its 30-min idle timeout
    // even after hang-up.
    if (voiceSessionId && response.usage) {
      const usageRes = await recordVoiceCost(
        fromUsernameLive,
        voiceSessionId,
        extractVoiceUsage(response.usage),
      );
      if (isAborted()) return;
      if (usageRes.overBudget) {
        console.warn("[Voice] budget exhausted — ending session");
        fail("Voice budget exhausted.");
        return;
      } else if (!usageRes.success) {
        console.warn(
          "[Voice] cost recording failed — ending session to avoid untracked spend:",
          usageRes.message,
        );
        fail("Cost recording failed.");
        return;
      }
      if (typeof usageRes.cost === "number") {
        callbacks.onCostRecorded(usageRes.cost);
      }
    }

    // If no follow-up response was queued, the scheduler keeps log delivery
    // closed through the likely WebRTC playback tail.
    if (!isAborted()) {
      scheduler.armDrainIfIdle();
    }
  }

  /** Run any function_calls carried by a completed response.done. The API
   *  also fires `response.done` for cancelled/failed/incomplete, which carry
   *  partial function_call args we must not dispatch — those are no-ops
   *  here. Queues a follow-up `response.create` after the tool outputs. */
  async function dispatchToolCalls(
    response: Record<string, any>,
  ): Promise<void> {
    if (isAborted()) return;
    if (response.status !== "completed") return;

    const outputs: any[] = Array.isArray(response.output)
      ? response.output
      : [];
    const calls = outputs.filter((o) => o?.type === "function_call");
    if (calls.length === 0) return;

    const fromUsernameLive = resolved?.fromUsername ?? params.fromUsername;
    const targetUsernameLive =
      resolved?.targetUsername ?? params.targetUsername;

    for (const callItem of calls) {
      if (isAborted()) return;
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = callItem.arguments ? JSON.parse(callItem.arguments) : {};
      } catch {
        parsedArgs = {};
      }
      const call = voiceSessionId
        ? buildToolCall(
            callItem.name,
            parsedArgs,
            targetUsernameLive,
            voiceSessionId,
          )
        : null;
      const result = call
        ? await executeVoiceTool(fromUsernameLive, call)
        : {
            success: false,
            result: `Could not run "${callItem.name}".`,
          };
      if (isAborted()) return;
      transport.sendEvent({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callItem.call_id,
          output: result.result,
        },
      });
    }
    if (!isAborted()) {
      scheduler.markFollowUpQueued();
      transport.sendEvent({ type: "response.create" });
    }
  }

  /** Loud teardown — abort, then signal the provider with a reason. */
  function fail(reason: string): void {
    if (isAborted()) return;
    controller.abort();
    teardown();
    callbacks.onError(reason);
  }

  function teardown(): void {
    scheduler.teardown();
    transport.teardown();
  }

  return session;
}
