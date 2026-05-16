import type { LogPushEntry } from "@naisys/hub-protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeVoiceTool: vi.fn(),
  mintVoiceToken: vi.fn(),
  recordVoiceCost: vi.fn(),
}));

vi.mock("../lib/api/apiVoice", () => ({
  executeVoiceTool: mocks.executeVoiceTool,
  mintVoiceToken: mocks.mintVoiceToken,
  recordVoiceCost: mocks.recordVoiceCost,
}));

import {
  createVoiceSession,
  type VoiceSession,
  type VoiceSessionCallbacks,
} from "../lib/voice/voiceSession";

class FakeDataChannel {
  readyState: RTCDataChannelState = "open";
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: unknown[] = [];

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.readyState = "closed";
    this.onclose?.();
  }
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];

  connectionState: RTCPeerConnectionState = "new";
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  dc = new FakeDataChannel();
  addTrack = vi.fn();
  close = vi.fn();
  createOffer = vi.fn(() =>
    Promise.resolve({ type: "offer" as RTCSdpType, sdp: "offer-sdp" }),
  );
  setLocalDescription = vi.fn(() => Promise.resolve());
  setRemoteDescription = vi.fn(() => Promise.resolve());

  constructor() {
    FakePeerConnection.instances.push(this);
  }

  createDataChannel(): FakeDataChannel {
    return this.dc;
  }
}

const stopTrack = vi.fn();
const micStream = {
  getTracks: () => [{ stop: stopTrack }],
} as unknown as MediaStream;

const audioElement = { srcObject: micStream } as unknown as HTMLAudioElement;

function callbacks(): VoiceSessionCallbacks {
  return {
    getAudioElement: vi.fn(() => audioElement),
    onDisplayResolved: vi.fn(),
    onLive: vi.fn(),
    onCostRecorded: vi.fn(),
    onError: vi.fn(),
  };
}

function createSession(callbackSet = callbacks()): VoiceSession {
  return createVoiceSession(
    {
      fromUsername: "admin",
      fromTitle: "Admin",
      targetUsername: "worker",
      targetTitle: "Worker",
      mode: "console",
    },
    callbackSet,
  );
}

async function startSession(callbackSet = callbacks()) {
  const session = createSession(callbackSet);
  await session.start();
  const pc = FakePeerConnection.instances.at(-1);
  if (!pc) throw new Error("Peer connection was not created");
  return { session, pc, callbacks: callbackSet };
}

async function flushAsyncHandlers(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function emitRealtimeEvent(
  pc: FakePeerConnection,
  event: Record<string, unknown>,
) {
  pc.dc.onmessage?.({
    data: JSON.stringify(event),
  } as MessageEvent);
}

function logEntry(id: number, message: string): LogPushEntry {
  return {
    id,
    previousId: id - 1,
    userId: 1,
    runId: 10,
    sessionId: 20,
    role: "NAISYS",
    source: "llm",
    type: "comment",
    message,
    createdAt: `2026-05-01T00:00:${String(id).padStart(2, "0")}.000Z`,
  };
}

describe("VoiceSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakePeerConnection.instances = [];
    stopTrack.mockClear();
    audioElement.srcObject = micStream;
    mocks.mintVoiceToken.mockResolvedValue({
      clientSecret: "client-secret",
      expiresAt: "2030-01-01T00:00:00.000Z",
      model: "gpt-realtime-2",
      voiceSessionId: "voice-session-id-1",
      fromUsername: "admin",
      fromTitle: "Admin",
      targetUsername: "worker",
      targetTitle: "Worker",
      mode: "console",
    });
    mocks.executeVoiceTool.mockResolvedValue({
      success: true,
      result: "command output",
    });
    mocks.recordVoiceCost.mockResolvedValue({
      success: true,
      overBudget: false,
    });
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(() => Promise.resolve(micStream)),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("answer-sdp", { status: 200 }))),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("starts WebRTC, resolves display info, and surfaces live state", async () => {
    const callbackSet = callbacks();
    const { pc } = await startSession(callbackSet);

    expect(mocks.mintVoiceToken).toHaveBeenCalledWith(
      "admin",
      "worker",
      "console",
    );
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: true,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/realtime/calls",
      expect.objectContaining({
        method: "POST",
        body: "offer-sdp",
        headers: {
          Authorization: "Bearer client-secret",
          "Content-Type": "application/sdp",
        },
      }),
    );
    expect(pc.setRemoteDescription).toHaveBeenCalledWith({
      type: "answer",
      sdp: "answer-sdp",
    });
    expect(callbackSet.onDisplayResolved).toHaveBeenCalledWith({
      fromUsername: "admin",
      fromTitle: "Admin",
      targetUsername: "worker",
      targetTitle: "Worker",
    });
    expect(callbackSet.onLive).toHaveBeenCalled();
  });

  test("records incomplete response cost without dispatching partial tool calls", async () => {
    const { pc } = await startSession();

    emitRealtimeEvent(pc, {
      type: "response.done",
      response: {
        status: "incomplete",
        output: [
          {
            type: "function_call",
            name: "run_debug_command",
            call_id: "call-1",
            arguments: '{"command":"pwd"}',
          },
        ],
        usage: {
          input_token_details: {
            text_tokens: 50,
            audio_tokens: 25,
            cached_tokens_details: {
              text_tokens: 10,
              audio_tokens: 5,
            },
          },
          output_token_details: {
            text_tokens: 7,
            audio_tokens: 9,
          },
        },
      },
    });
    await flushAsyncHandlers();

    expect(mocks.executeVoiceTool).not.toHaveBeenCalled();
    expect(mocks.recordVoiceCost).toHaveBeenCalledWith(
      "admin",
      "voice-session-id-1",
      {
        inputTextTokens: 40,
        inputAudioTokens: 20,
        inputImageTokens: 0,
        inputCachedTextTokens: 10,
        inputCachedAudioTokens: 5,
        inputCachedImageTokens: 0,
        outputTextTokens: 7,
        outputAudioTokens: 9,
      },
    );
    expect(pc.dc.sent).toEqual([]);
  });

  test("executes completed function calls and asks realtime for a follow-up", async () => {
    const { pc } = await startSession();

    emitRealtimeEvent(pc, {
      type: "response.done",
      response: {
        status: "completed",
        output: [
          {
            type: "function_call",
            name: "run_debug_command",
            call_id: "call-1",
            arguments: '{"command":"pwd"}',
          },
        ],
      },
    });
    await flushAsyncHandlers();

    expect(mocks.executeVoiceTool).toHaveBeenCalledWith("admin", {
      tool: "run_debug_command",
      voiceSessionId: "voice-session-id-1",
      targetUsername: "worker",
      command: "pwd",
    });
    expect(pc.dc.sent).toEqual([
      {
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: "call-1",
          output: "command output",
        },
      },
      { type: "response.create" },
    ]);
  });

  test("buffers log updates while responding and through audio playback drain", async () => {
    vi.useFakeTimers();
    const { session, pc } = await startSession();

    emitRealtimeEvent(pc, { type: "response.created" });
    session.injectLogEntries([logEntry(1, "running tests")]);

    vi.advanceTimersByTime(2_000);
    expect(pc.dc.sent).toEqual([]);

    session.injectLogEntries([logEntry(2, "writing summary")]);

    emitRealtimeEvent(pc, {
      type: "response.done",
      response: { status: "completed" },
    });
    await flushAsyncHandlers();

    expect(pc.dc.sent).toEqual([]);

    vi.advanceTimersByTime(9_999);
    expect(pc.dc.sent).toEqual([]);

    vi.advanceTimersByTime(1);
    // Digest dispatch is async (awaits image fetches, which are a no-op when
    // there are no attachments but still costs a microtask). Drive them.
    await flushAsyncHandlers();
    expect(pc.dc.sent).toHaveLength(1);
    expect(pc.dc.sent[0]).toMatchObject({
      type: "conversation.item.create",
    });
    expect(JSON.stringify(pc.dc.sent[0])).toContain("running tests");
    expect(JSON.stringify(pc.dc.sent[0])).toContain("writing summary");

    vi.advanceTimersByTime(3_499);
    expect(pc.dc.sent).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(pc.dc.sent).toEqual([
      expect.objectContaining({ type: "conversation.item.create" }),
      { type: "response.create" },
    ]);
  });

  test("keeps log delivery closed while response.done awaits cost recording", async () => {
    vi.useFakeTimers();
    let resolveCost: (result: {
      success: true;
      overBudget: false;
    }) => void = () => undefined;
    mocks.recordVoiceCost.mockReturnValue(
      new Promise((resolve) => {
        resolveCost = resolve;
      }),
    );
    const { session, pc } = await startSession();

    emitRealtimeEvent(pc, { type: "response.created" });
    emitRealtimeEvent(pc, {
      type: "response.done",
      response: {
        status: "completed",
        usage: {
          input_token_details: {
            text_tokens: 1,
          },
        },
      },
    });
    await flushAsyncHandlers();

    session.injectLogEntries([logEntry(1, "still running")]);
    vi.advanceTimersByTime(2_000);
    expect(pc.dc.sent).toEqual([]);

    resolveCost({ success: true, overBudget: false });
    await flushAsyncHandlers();

    vi.advanceTimersByTime(9_999);
    expect(pc.dc.sent).toEqual([]);

    vi.advanceTimersByTime(1);
    await flushAsyncHandlers();
    expect(pc.dc.sent).toHaveLength(1);
    expect(JSON.stringify(pc.dc.sent[0])).toContain("still running");
  });

  test("fails the session when cost recording reports exhausted budget", async () => {
    mocks.recordVoiceCost.mockResolvedValue({
      success: true,
      overBudget: true,
    });
    const callbackSet = callbacks();
    const { session, pc } = await startSession(callbackSet);

    emitRealtimeEvent(pc, {
      type: "response.done",
      response: {
        status: "completed",
        usage: {
          input_token_details: {
            text_tokens: 1,
          },
        },
      },
    });
    await flushAsyncHandlers();

    expect(callbackSet.onError).toHaveBeenCalledWith("Voice budget exhausted.");
    expect(session.aborted).toBe(true);
    expect(pc.close).toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalled();
    expect(audioElement.srcObject).toBeNull();
  });

  test("abort tears down silently", async () => {
    const callbackSet = callbacks();
    const { session, pc } = await startSession(callbackSet);

    session.abort();

    expect(session.aborted).toBe(true);
    expect(callbackSet.onError).not.toHaveBeenCalled();
    expect(pc.close).toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalled();
    expect(audioElement.srcObject).toBeNull();
  });
});
