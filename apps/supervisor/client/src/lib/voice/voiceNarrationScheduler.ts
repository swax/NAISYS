import type { LogPushEntry } from "@naisys/hub-protocol";

import type { VoiceMode } from "../api/apiClient";
import { createVoiceLogBuffer, type VoiceLogDigest } from "./voiceLogBuffer";
import { fetchImageAsDataUrl, type VoiceLogImage } from "./voiceLogImages";

/**
 * Owns the narration timing state machine for a voice session: when the
 * model is responding, when the user is mid-utterance, when WebRTC audio
 * may still be draining, and when log digests may be delivered to the
 * realtime conversation. Sits between the transport (channel I/O) and the
 * session (lifecycle + tool/cost dispatch). Two gates:
 *
 *   canDeliverLogs   = !isResponding && !audioOutputDraining
 *   canFireNarration = canDeliverLogs && !userSpeaking && !awaitingUserResponse
 *                      && isChannelOpen
 *
 * Log digests flow even while the user is mid-speech (the next user turn
 * will absorb them); proactive `response.create` does not.
 */

/** Quiet period after the last buffer flush before giving the model a turn
 *  to narrate. Narrating at a lull approximates "boundary" triggers without
 *  parsing prompt-line semantics. Measured between flushes, not raw entries
 *  — the LOG_BUFFER_MS window is the first stage of smoothing. */
const NARRATION_DEBOUNCE_MS = 3_500;

/** Ceiling on quiet time before we give the model a turn anyway — otherwise
 *  a steady stream of log entries starves narration (trailing debounce never
 *  settles). The model can stay silent on noise. */
const NARRATION_MAX_WAIT_MS = 10_000;

/** How long to suppress log narration after speech_stopped, waiting for VAD
 *  to fire response.created for the user's turn. Without it, a log batch in
 *  that gap could race the user's about-to-commit audio. Timeout releases
 *  the gate if no response ever fires (audio filtered as noise). */
const POST_SPEECH_GRACE_MS = 1_500;

/** `response.done` means realtime finished sending, not that WebRTC playback
 *  has finished. Hold log delivery a little longer so the next narration sees
 *  the collapsed log state after audible speech has drained. */
const POST_RESPONSE_AUDIO_DRAIN_MS = 10_000;

export interface NarrationSchedulerCallbacks {
  isAborted: () => boolean;
  isChannelOpen: () => boolean;
  sendEvent: (event: Record<string, unknown>) => void;
  getTargetUsername: () => string;
  /** Drives the run-log narration filter via shouldNarrateLogEntry. */
  mode: VoiceMode;
}

export interface NarrationScheduler {
  injectLogEntries(entries: LogPushEntry[]): void;

  /** Realtime emitted `response.created` — the model has the turn. */
  onResponseCreated(): void;
  /** Realtime emitted `response.done` — drop the responding flag and close
   *  log delivery indefinitely (no timer yet). The session may queue a
   *  follow-up via `markFollowUpQueued`; if not, call `armDrainIfIdle` to
   *  start the drain countdown. */
  onResponseDone(): void;
  /** Realtime emitted `input_audio_buffer.speech_started`. */
  onUserSpeechStarted(): void;
  /** Realtime emitted `input_audio_buffer.speech_stopped`. */
  onUserSpeechStopped(): void;

  /** Session is about to send `response.create` after tool dispatch — mark
   *  responding so subsequent log batches don't race the follow-up turn.
   *  The session sends the event itself. */
  markFollowUpQueued(): void;
  /** Tail of the response.done handler. Arms the audio-drain timer if no
   *  follow-up response was queued; otherwise no-op. */
  armDrainIfIdle(): void;

  /** Channel reached `"open"` — prime narration timing. */
  markLive(): void;
  teardown(): void;
}

export function createNarrationScheduler(
  cb: NarrationSchedulerCallbacks,
): NarrationScheduler {
  let isResponding = false;
  let narrationTimer: ReturnType<typeof setTimeout> | null = null;
  let lastNarrationAt = 0;
  let narrationPending = false;
  // True between speech_started and speech_stopped. We hold off proactive
  // narration in this window so we don't talk over the operator or race
  // their about-to-commit audio.
  let userSpeaking = false;
  // True from speech_stopped until response.created arrives (or
  // POST_SPEECH_GRACE_MS elapses). Closes the gap where a max-wait log batch
  // could otherwise fire a narration the model answers instead of the user.
  let awaitingUserResponse = false;
  let awaitingUserResponseTimer: ReturnType<typeof setTimeout> | null = null;
  // True after response.done while browser/WebRTC output may still be playing
  // audio that the server already finished sending.
  let audioOutputDraining = false;
  let audioOutputDrainTimer: ReturnType<typeof setTimeout> | null = null;

  // Inbound log batching. VoiceLogBuffer coalesces entries and fires a
  // digest via handleLogDigest. If realtime is speaking or output audio is
  // draining, the callback refuses delivery and VoiceLogBuffer keeps the
  // entries under its normal caps until the gate opens.
  const logBuffer = createVoiceLogBuffer(handleLogDigest, cb.mode);

  function injectLogEntries(entries: LogPushEntry[]): void {
    if (cb.isAborted()) return;
    if (!cb.isChannelOpen()) return;
    logBuffer.add(entries);
  }

  function onResponseCreated(): void {
    if (cb.isAborted()) return;
    isResponding = true;
    setAudioDrainGate("open");
    lastNarrationAt = Date.now();
    narrationPending = false;
    clearNarrationTimer();
    // Either source (user audio commit or our own narration) makes the
    // post-speech grace moot.
    clearAwaitingUserResponse();
  }

  function onResponseDone(): void {
    if (cb.isAborted()) return;
    isResponding = false;
    setAudioDrainGate("closed");
  }

  function onUserSpeechStarted(): void {
    if (cb.isAborted()) return;
    // Drop any pending narration so we don't give the model a turn
    // mid-utterance — VAD will create the user's response via the commit.
    // Don't touch isResponding: the server's VAD interrupt handles cutting
    // off a mid-response if needed.
    userSpeaking = true;
    clearNarrationTimer();
    // Already-flushed log items will be absorbed by the user's response.
    // Any logs that flush mid-utterance will set this back to true and
    // queue a fresh narration for after.
    narrationPending = false;
    clearAwaitingUserResponse();
  }

  function onUserSpeechStopped(): void {
    if (cb.isAborted()) return;
    // Hold the narration gate closed until response.created arrives (or
    // POST_SPEECH_GRACE_MS) so a log batch can't race the user's
    // about-to-commit turn.
    userSpeaking = false;
    awaitingUserResponse = true;
    if (awaitingUserResponseTimer) clearTimeout(awaitingUserResponseTimer);
    awaitingUserResponseTimer = setTimeout(() => {
      awaitingUserResponseTimer = null;
      awaitingUserResponse = false;
      requestPendingNarration();
    }, POST_SPEECH_GRACE_MS);
  }

  function markFollowUpQueued(): void {
    if (cb.isAborted()) return;
    isResponding = true;
  }

  function armDrainIfIdle(): void {
    if (cb.isAborted()) return;
    if (isResponding) return;
    setAudioDrainGate("draining");
  }

  function markLive(): void {
    // Prime the max-wait clock at session-live so the first log batch
    // debounces normally instead of tripping the ceiling immediately.
    lastNarrationAt = Date.now();
  }

  function teardown(): void {
    clearNarrationTimer();
    logBuffer.clear();
    narrationPending = false;
    clearAwaitingUserResponse();
    setAudioDrainGate("open");
  }

  // --- internals ---

  /** Log digests may flow even while the user is mid-utterance — the next
   *  user turn will absorb them. They may not flow while the model is
   *  speaking or while WebRTC playback is still draining. */
  function canDeliverLogs(): boolean {
    return !isResponding && !audioOutputDraining;
  }

  /** Proactive `response.create` is stricter than log delivery: spoken user
   *  intent wins, so we don't fire while the user is mid-utterance or in
   *  the speech_stopped → response.created gap. Also gated on a live
   *  channel — without one the event would no-op but we'd flip
   *  `isResponding` optimistically. */
  function canFireNarration(): boolean {
    return (
      canDeliverLogs() &&
      !userSpeaking &&
      !awaitingUserResponse &&
      cb.isChannelOpen()
    );
  }

  /** Receive a coalesced log digest from the buffer: append it to the
   *  realtime conversation and re-arm narration timing. Returns false when
   *  the delivery gate is closed so VoiceLogBuffer keeps its entries.
   *  Images are fetched asynchronously after acceptance; failed fetches
   *  degrade to text-only without blocking the digest. */
  function handleLogDigest(digest: VoiceLogDigest): boolean {
    if (cb.isAborted()) return true;
    if (!canDeliverLogs()) return false;

    // Mark narration pending now (sync) so the debounce/max-wait timers
    // started below see the right state — the actual conversation.item.create
    // is dispatched after image fetches resolve, but for narration timing
    // this digest counts as in-flight the moment we accept it.
    narrationPending = true;
    void sendLogDigest(digest);
    schedulePendingNarrationForLogDigest();
    return true;
  }

  async function sendLogDigest(digest: VoiceLogDigest): Promise<void> {
    const targetUsername = cb.getTargetUsername();

    const imageDataUrls = await fetchDigestImages(digest.images);
    if (cb.isAborted()) return;

    const text = digest.imagesOmitted
      ? `${digest.text}\n[${digest.imagesOmitted} more image attachment${digest.imagesOmitted === 1 ? "" : "s"} omitted from this batch]`
      : digest.text;

    const content: Record<string, unknown>[] = [
      {
        type: "input_text",
        text: `[run log — ${targetUsername}]\n${text}`,
      },
    ];
    for (const dataUrl of imageDataUrls) {
      content.push({ type: "input_image", image_url: dataUrl });
    }

    console.debug("[Voice] sending run log digest to realtime", {
      targetUsername,
      chars: text.length,
      lines: text.split("\n").length,
      images: imageDataUrls.length,
      imagesOmitted: digest.imagesOmitted,
      at: new Date().toISOString(),
    });

    cb.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content,
      },
    });
  }

  async function fetchDigestImages(images: VoiceLogImage[]): Promise<string[]> {
    if (images.length === 0) return [];
    const settled = await Promise.all(
      images.map((image) => fetchImageAsDataUrl(image)),
    );
    return settled.filter((url): url is string => Boolean(url));
  }

  function schedulePendingNarrationForLogDigest(): void {
    // Max-wait ceiling: if logs are arriving faster than the debounce can
    // settle, give the model a turn now. The model can stay silent if
    // there's nothing useful to say.
    const now = Date.now();
    if (now - lastNarrationAt >= NARRATION_MAX_WAIT_MS) {
      clearNarrationTimer();
      requestPendingNarration();
      return;
    }
    armNarrationDebounce();
  }

  function deferPendingNarrationFromNow(): void {
    if (!narrationPending) return;
    lastNarrationAt = Date.now();
    armNarrationDebounce();
  }

  function armNarrationDebounce(): void {
    if (!narrationPending) return;
    if (narrationTimer) clearTimeout(narrationTimer);
    narrationTimer = setTimeout(() => {
      narrationTimer = null;
      requestPendingNarration();
    }, NARRATION_DEBOUNCE_MS);
  }

  function requestPendingNarration(): void {
    if (!narrationPending) return;
    if (cb.isAborted()) return;
    if (!canFireNarration()) return;
    isResponding = true;
    cb.sendEvent({ type: "response.create" });
    narrationPending = false;
    clearNarrationTimer();
  }

  function clearNarrationTimer(): void {
    if (narrationTimer) {
      clearTimeout(narrationTimer);
      narrationTimer = null;
    }
  }

  function clearAwaitingUserResponse(): void {
    awaitingUserResponse = false;
    if (awaitingUserResponseTimer) {
      clearTimeout(awaitingUserResponseTimer);
      awaitingUserResponseTimer = null;
    }
  }

  /** Drive the audio-drain gate. Modes:
   *    "open"     — gate open, log delivery allowed. Clears any timer.
   *    "closed"   — gate held closed indefinitely (e.g. between response.done
   *                 and the cost-recording await). Clears any timer.
   *    "draining" — gate closed with an auto-reopen timer for the likely
   *                 WebRTC playback tail. */
  function setAudioDrainGate(mode: "open" | "closed" | "draining"): void {
    if (audioOutputDrainTimer) {
      clearTimeout(audioOutputDrainTimer);
      audioOutputDrainTimer = null;
    }
    audioOutputDraining = mode !== "open";
    if (mode === "draining") {
      audioOutputDrainTimer = setTimeout(() => {
        audioOutputDrainTimer = null;
        audioOutputDraining = false;
        drainLogsAfterClosedGate();
      }, POST_RESPONSE_AUDIO_DRAIN_MS);
    }
  }

  function drainLogsAfterClosedGate(): void {
    if (cb.isAborted()) return;
    // Prevent the max-wait ceiling from firing immediately after a long
    // response/playback window; this drain should still use the quiet
    // debounce.
    lastNarrationAt = Date.now();
    logBuffer.drainNow();
    deferPendingNarrationFromNow();
  }

  return {
    injectLogEntries,
    onResponseCreated,
    onResponseDone,
    onUserSpeechStarted,
    onUserSpeechStopped,
    markFollowUpQueued,
    armDrainIfIdle,
    markLive,
    teardown,
  };
}
