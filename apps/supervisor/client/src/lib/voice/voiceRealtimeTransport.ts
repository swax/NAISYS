/**
 * WebRTC + realtime data channel transport for a voice session. Owns the
 * `RTCPeerConnection`, the mic capture, the `oai-events` data channel, the
 * SDP exchange with OpenAI, and ICE connection-state monitoring. Audio
 * flows browser↔OpenAI; the supervisor is only an action backend.
 *
 * Lifecycle is owned by the caller (the session). The transport reports
 * terminal transport errors through `onError`; the caller decides what to
 * do (typically `fail(reason)`, which aborts the session and tears down).
 */

const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

/** Grace before treating a `disconnected` peer-connection state as terminal.
 *  ICE can flick through `disconnected` during legitimate renegotiation
 *  (WiFi → LTE, NAT rebind). */
const DISCONNECT_GRACE_MS = 5_000;

/** Bound on the SDP exchange — a hung OpenAI edge would otherwise leave the
 *  operator stranded on "Connecting…" with only the hang-up button to escape. */
const SDP_CONNECT_TIMEOUT_MS = 15_000;

export interface VoiceRealtimeTransportCallbacks {
  isAborted: () => boolean;
  /** Audio sink for remote audio. Read on every `ontrack` so it tolerates a
   *  late-mounting `<audio>` element. */
  getAudioElement: () => HTMLAudioElement | null;
  /** Data channel reached `"open"` — the realtime session is fully live. */
  onChannelOpen: () => void;
  /** A realtime event arrived on the data channel (already JSON-parsed). */
  onRealtimeEvent: (event: Record<string, any>) => void;
  /** Transport-level failure that should terminate the session. */
  onError: (reason: string) => void;
}

export interface VoiceRealtimeTransport {
  /** Run mic capture → offer/answer → setRemoteDescription. Returns once
   *  the SDP exchange completes; the channel may still be "connecting"
   *  briefly after. The session isn't "live" until `onChannelOpen` fires. */
  connect(opts: { clientSecret: string; signal: AbortSignal }): Promise<void>;
  sendEvent(event: Record<string, unknown>): void;
  isChannelOpen(): boolean;
  /** Suppress / restore outbound mic audio. Implemented as `track.enabled`,
   *  so no SDP renegotiation occurs and the peer connection stays up. */
  setMicMuted(muted: boolean): void;
  teardown(): void;
}

export function createVoiceRealtimeTransport(
  callbacks: VoiceRealtimeTransportCallbacks,
): VoiceRealtimeTransport {
  let pc: RTCPeerConnection | undefined;
  let dc: RTCDataChannel | undefined;
  let micStream: MediaStream | undefined;
  let micMuted = false;
  let iceDisconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async function connect({
    clientSecret,
    signal,
  }: {
    clientSecret: string;
    signal: AbortSignal;
  }): Promise<void> {
    pc = new RTCPeerConnection();

    // Play the model's audio. Read the audio element on each fire so the
    // provider can mount it late without races.
    pc.ontrack = (e) => {
      if (callbacks.isAborted()) return;
      const audio = callbacks.getAudioElement();
      if (audio) audio.srcObject = e.streams[0];
    };

    // `connectionState` (PC-wide) over `iceConnectionState` because it
    // captures DTLS failures too. `failed` is terminal; `disconnected`
    // waits DISCONNECT_GRACE_MS.
    pc.onconnectionstatechange = handleConnectionStateChange;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (callbacks.isAborted()) {
      // Stop the mic we just obtained — teardown ran before we could
      // register it on the instance, so it's not in our tracked state.
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    micStream = stream;
    for (const track of stream.getTracks()) {
      track.enabled = !micMuted;
      pc.addTrack(track, stream);
    }

    // Data channel carries realtime events (tool calls, usage, log items).
    dc = pc.createDataChannel("oai-events");
    dc.onmessage = handleDataChannelMessage;
    dc.onopen = handleDataChannelOpen;
    dc.onerror = handleDataChannelError;
    dc.onclose = handleDataChannelClose;

    // SDP offer/answer with OpenAI. The ephemeral client_secret carries
    // the locked session config (instructions, tools, voice).
    const offer = await pc.createOffer();
    if (callbacks.isAborted()) return;
    await pc.setLocalDescription(offer);
    if (callbacks.isAborted()) return;

    // Bound the SDP exchange. The caller's abort cancels the fetch via the
    // signal; a clean exchange clears the timer in the finally.
    const sdpTimer = setTimeout(
      () => callbacks.onError("Realtime connect timed out."),
      SDP_CONNECT_TIMEOUT_MS,
    );
    try {
      const sdpResponse = await fetch(OPENAI_REALTIME_CALLS_URL, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          "Content-Type": "application/sdp",
        },
        signal,
      });
      if (callbacks.isAborted()) return;
      if (!sdpResponse.ok) {
        throw new Error(`Realtime connect failed (${sdpResponse.status}).`);
      }
      const answerSdp = await sdpResponse.text();
      if (callbacks.isAborted()) return;
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      if (callbacks.isAborted()) return;
    } finally {
      clearTimeout(sdpTimer);
    }

    // Belt-and-braces: if the channel opened before `onopen` could fire,
    // surface "live" here.
    if (dc.readyState === "open") {
      callbacks.onChannelOpen();
    }
  }

  function sendEvent(event: Record<string, unknown>): void {
    if (callbacks.isAborted()) return;
    if (dc && dc.readyState === "open") {
      dc.send(JSON.stringify(event));
    }
  }

  function isChannelOpen(): boolean {
    return dc?.readyState === "open";
  }

  function setMicMuted(muted: boolean): void {
    micMuted = muted;
    if (!micStream) return;
    for (const track of micStream.getTracks()) {
      track.enabled = !muted;
    }
  }

  function teardown(): void {
    clearDisconnectTimer();

    if (dc) {
      // Leave `onmessage` attached: a queued `response.done` still needs its
      // cost row, and the handler is safe post-abort (side effects gated).
      dc.onopen = null;
      dc.onerror = null;
      dc.onclose = null;
      try {
        dc.close();
      } catch {
        /* already closed */
      }
      dc = undefined;
    }

    if (pc) {
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        /* already closed */
      }
      pc = undefined;
    }

    micStream?.getTracks().forEach((t) => t.stop());
    micStream = undefined;

    const audio = callbacks.getAudioElement();
    if (audio) audio.srcObject = null;
  }

  function handleConnectionStateChange(): void {
    if (callbacks.isAborted()) return;
    if (!pc) return;
    const state = pc.connectionState;
    if (state === "failed") {
      clearDisconnectTimer();
      callbacks.onError("Voice connection failed.");
    } else if (state === "disconnected") {
      clearDisconnectTimer();
      iceDisconnectTimer = setTimeout(() => {
        if (callbacks.isAborted()) return;
        iceDisconnectTimer = null;
        if (!pc) return;
        const s = pc.connectionState;
        if (s === "disconnected" || s === "failed") {
          callbacks.onError(
            "Voice connection dropped — network may have changed.",
          );
        }
      }, DISCONNECT_GRACE_MS);
    } else if (state === "connected") {
      clearDisconnectTimer();
    }
  }

  function handleDataChannelMessage(e: MessageEvent): void {
    // Deliberately no early `aborted` check here: a late `response.done`
    // arriving after the user hung up still needs its cost row written.
    // The caller's `onRealtimeEvent` handler gates side effects per-case.
    let parsed: Record<string, any> | null = null;
    try {
      parsed = JSON.parse(e.data);
    } catch {
      return;
    }
    if (parsed) callbacks.onRealtimeEvent(parsed);
  }

  function handleDataChannelOpen(): void {
    if (callbacks.isAborted()) return;
    callbacks.onChannelOpen();
  }

  function handleDataChannelError(event: Event): void {
    if (callbacks.isAborted()) return;
    console.warn("[Voice] data channel error:", event);
    callbacks.onError("Voice data channel error.");
  }

  function handleDataChannelClose(): void {
    if (callbacks.isAborted()) return;
    callbacks.onError("Voice session ended unexpectedly.");
  }

  function clearDisconnectTimer(): void {
    if (iceDisconnectTimer) {
      clearTimeout(iceDisconnectTimer);
      iceDisconnectTimer = null;
    }
  }

  return {
    connect,
    sendEvent,
    isChannelOpen,
    setMicMuted,
    teardown,
  };
}
