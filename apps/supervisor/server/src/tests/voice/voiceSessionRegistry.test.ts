import { afterEach, describe, expect, test, vi } from "vitest";

async function loadRegistry() {
  vi.resetModules();
  return await import("../../services/voice/voiceSessionRegistry.js");
}

describe("voiceSessionRegistry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("validates same-user sessions and refreshes lastSeen", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));
    const { registerVoiceSession, validateVoiceSession } = await loadRegistry();

    const id = registerVoiceSession({
      userUuid: "user-1",
      fromUsername: "admin",
      targetUsername: "worker",
      mode: "console",
      model: "gpt-realtime-2",
    });

    const first = validateVoiceSession(id, "user-1");
    expect(first).toMatchObject({
      userUuid: "user-1",
      fromUsername: "admin",
      targetUsername: "worker",
      mode: "console",
      model: "gpt-realtime-2",
      lastSeen: Date.parse("2026-05-01T00:00:00.000Z"),
    });

    vi.setSystemTime(new Date("2026-05-01T00:05:00.000Z"));
    const second = validateVoiceSession(id, "user-1");
    expect(second?.lastSeen).toBe(Date.parse("2026-05-01T00:05:00.000Z"));
  });

  test("rejects missing ids and ids owned by another user", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));
    const { registerVoiceSession, validateVoiceSession } = await loadRegistry();

    const id = registerVoiceSession({
      userUuid: "user-1",
      fromUsername: "admin",
      targetUsername: "worker",
      mode: "console",
      model: "gpt-realtime-2",
    });

    expect(validateVoiceSession(undefined, "user-1")).toBeNull();
    expect(validateVoiceSession(id, "user-2")).toBeNull();
    expect(validateVoiceSession(id, "user-1")).not.toBeNull();
  });

  test("expires sessions after the idle timeout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));
    const { registerVoiceSession, validateVoiceSession } = await loadRegistry();

    const id = registerVoiceSession({
      userUuid: "user-1",
      fromUsername: "admin",
      targetUsername: "worker",
      mode: "console",
      model: "gpt-realtime-2",
    });

    vi.setSystemTime(new Date("2026-05-01T00:30:00.001Z"));

    expect(validateVoiceSession(id, "user-1")).toBeNull();
  });

  test("opportunistically sweeps old sessions while registering new ones", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));
    const { registerVoiceSession, validateVoiceSession } = await loadRegistry();

    const expiredId = registerVoiceSession({
      userUuid: "user-1",
      fromUsername: "admin",
      targetUsername: "worker",
      mode: "console",
      model: "gpt-realtime-2",
    });

    vi.setSystemTime(new Date("2026-05-01T00:31:00.000Z"));
    const liveId = registerVoiceSession({
      userUuid: "user-1",
      fromUsername: "admin",
      targetUsername: "worker",
      mode: "console",
      model: "gpt-realtime-2",
    });

    expect(validateVoiceSession(expiredId, "user-1")).toBeNull();
    expect(validateVoiceSession(liveId, "user-1")).not.toBeNull();
  });
});
