import type { LogPushEntry } from "@naisys/hub-protocol";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createVoiceLogBuffer } from "./voiceLogBuffer";

const entry = (
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
  source: "llm",
  type: "comment",
  message,
  createdAt: `2026-05-01T00:00:${String(id).padStart(2, "0")}.000Z`,
  ...overrides,
});

describe("VoiceLogBuffer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const acceptingBuffer = (onDigest: (digest: string) => void) =>
    createVoiceLogBuffer((digest) => {
      onDigest(digest);
      return true;
    });

  test("coalesces meaningful entries into one timed digest", () => {
    vi.useFakeTimers();
    const onDigest = vi.fn();
    const buffer = acceptingBuffer(onDigest);

    buffer.add([
      entry(1, "system noise", { type: "system" }),
      entry(2, "first"),
    ]);
    buffer.add([entry(3, "second")]);

    expect(onDigest).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_999);
    expect(onDigest).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onDigest).toHaveBeenCalledTimes(1);
    expect(onDigest.mock.calls[0][0]).toContain("first");
    expect(onDigest.mock.calls[0][0]).toContain("second");
    expect(onDigest.mock.calls[0][0]).not.toContain("system noise");
  });

  test("drainNow flushes immediately and clears the pending timer", () => {
    vi.useFakeTimers();
    const onDigest = vi.fn();
    const buffer = acceptingBuffer(onDigest);

    buffer.add([entry(1, "first")]);
    buffer.drainNow();
    vi.advanceTimersByTime(2_000);

    expect(onDigest).toHaveBeenCalledTimes(1);
    expect(onDigest.mock.calls[0][0]).toContain("first");
  });

  test("clear drops pending entries and timers", () => {
    vi.useFakeTimers();
    const onDigest = vi.fn();
    const buffer = acceptingBuffer(onDigest);

    buffer.add([entry(1, "first")]);
    buffer.clear();
    vi.advanceTimersByTime(2_000);
    buffer.drainNow();

    expect(onDigest).not.toHaveBeenCalled();
  });

  test("drops oldest entries past the buffer cap and reports the omission", () => {
    const onDigest = vi.fn();
    const buffer = acceptingBuffer(onDigest);

    buffer.add(
      Array.from({ length: 30 }, (_, index) =>
        entry(index + 1, `entry-${index + 1}`),
      ),
    );
    buffer.drainNow();

    expect(onDigest).toHaveBeenCalledTimes(1);
    const digest = onDigest.mock.calls[0][0] as string;
    const lines = digest.split("\n");
    expect(digest).toMatch(/^\[older log entries omitted: 6\]/);
    expect(digest).toContain("entry-30");
    expect(lines).not.toContain("[NAISYS/llm] entry-1");
  });

  test("keeps entries when delivery is refused and retries later", () => {
    vi.useFakeTimers();
    const onDigest = vi.fn();
    let open = false;
    const buffer = createVoiceLogBuffer((digest) => {
      if (!open) return false;
      onDigest(digest);
      return true;
    });

    buffer.add([entry(1, "first")]);
    vi.advanceTimersByTime(2_000);
    expect(onDigest).not.toHaveBeenCalled();

    buffer.add([entry(2, "second")]);
    open = true;
    buffer.drainNow();

    expect(onDigest).toHaveBeenCalledTimes(1);
    expect(onDigest.mock.calls[0][0]).toContain("first");
    expect(onDigest.mock.calls[0][0]).toContain("second");
  });
});
