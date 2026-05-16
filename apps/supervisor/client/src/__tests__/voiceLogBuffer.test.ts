import type { LogPushEntry } from "@naisys/hub-protocol";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createVoiceLogBuffer,
  type VoiceLogDigest,
} from "../lib/voice/voiceLogBuffer";

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

  const acceptingBuffer = (onDigest: (digest: VoiceLogDigest) => void) =>
    createVoiceLogBuffer((digest) => {
      onDigest(digest);
      return true;
    }, "chat");

  const textOf = (mock: ReturnType<typeof vi.fn>, call = 0): string =>
    (mock.mock.calls[call][0] as VoiceLogDigest).text;

  const imagesOf = (mock: ReturnType<typeof vi.fn>, call = 0) =>
    (mock.mock.calls[call][0] as VoiceLogDigest).images;

  const imagesOmittedOf = (mock: ReturnType<typeof vi.fn>, call = 0) =>
    (mock.mock.calls[call][0] as VoiceLogDigest).imagesOmitted;

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
    expect(textOf(onDigest)).toContain("first");
    expect(textOf(onDigest)).toContain("second");
    expect(textOf(onDigest)).not.toContain("system noise");
    expect(imagesOf(onDigest)).toEqual([]);
  });

  test("console mode keeps console and startPrompt entries", () => {
    vi.useFakeTimers();
    const onDigest = vi.fn();
    const buffer = createVoiceLogBuffer((digest) => {
      onDigest(digest);
      return true;
    }, "console");

    buffer.add([
      entry(1, "console line", { source: "console" }),
      entry(2, "startup prompt body", { source: "startPrompt" }),
      entry(3, "system noise", { type: "system" }),
    ]);
    buffer.drainNow();

    expect(onDigest).toHaveBeenCalledTimes(1);
    expect(textOf(onDigest)).toContain("console line");
    expect(textOf(onDigest)).toContain("startup prompt body");
    expect(textOf(onDigest)).not.toContain("system noise");
  });

  test("drainNow flushes immediately and clears the pending timer", () => {
    vi.useFakeTimers();
    const onDigest = vi.fn();
    const buffer = acceptingBuffer(onDigest);

    buffer.add([entry(1, "first")]);
    buffer.drainNow();
    vi.advanceTimersByTime(2_000);

    expect(onDigest).toHaveBeenCalledTimes(1);
    expect(textOf(onDigest)).toContain("first");
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
    const text = textOf(onDigest);
    const lines = text.split("\n");
    expect(text).toMatch(/^\[older log entries omitted: 6\]/);
    expect(text).toContain("entry-30");
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
    }, "chat");

    buffer.add([entry(1, "first")]);
    vi.advanceTimersByTime(2_000);
    expect(onDigest).not.toHaveBeenCalled();

    buffer.add([entry(2, "second")]);
    open = true;
    buffer.drainNow();

    expect(onDigest).toHaveBeenCalledTimes(1);
    expect(textOf(onDigest)).toContain("first");
    expect(textOf(onDigest)).toContain("second");
  });

  test("collects image attachments and dedups across digests", () => {
    const onDigest = vi.fn();
    const buffer = acceptingBuffer(onDigest);

    buffer.add([
      entry(1, "screenshot one", {
        attachmentId: "att-a",
        attachmentFilename: "shot.png",
        attachmentFileSize: 1024,
      }),
      entry(2, "doc attached", {
        attachmentId: "att-b",
        attachmentFilename: "notes.pdf",
        attachmentFileSize: 4096,
      }),
    ]);
    buffer.drainNow();

    expect(imagesOf(onDigest, 0)).toEqual([
      { attachmentId: "att-a", filename: "shot.png", fileSize: 1024 },
    ]);
    expect(imagesOmittedOf(onDigest, 0)).toBe(0);

    // Same screenshot reappears: should not be re-sent.
    buffer.add([
      entry(3, "another mention", {
        attachmentId: "att-a",
        attachmentFilename: "shot.png",
        attachmentFileSize: 1024,
      }),
      entry(4, "new screenshot", {
        attachmentId: "att-c",
        attachmentFilename: "shot2.png",
        attachmentFileSize: 2048,
      }),
    ]);
    buffer.drainNow();

    expect(imagesOf(onDigest, 1)).toEqual([
      { attachmentId: "att-c", filename: "shot2.png", fileSize: 2048 },
    ]);
  });

  test("caps images per digest at MAX_IMAGES_PER_DIGEST and reports the omission", () => {
    const onDigest = vi.fn();
    const buffer = acceptingBuffer(onDigest);

    buffer.add(
      Array.from({ length: 7 }, (_, i) =>
        entry(i + 1, `shot-${i + 1}`, {
          attachmentId: `att-${i + 1}`,
          attachmentFilename: `shot${i + 1}.png`,
          attachmentFileSize: 1024,
        }),
      ),
    );
    buffer.drainNow();

    expect(imagesOf(onDigest, 0)).toHaveLength(4);
    expect(imagesOmittedOf(onDigest, 0)).toBe(3);
  });

  test("rolls back image dedup when the digest is refused", () => {
    vi.useFakeTimers();
    const onDigest = vi.fn();
    let open = false;
    const buffer = createVoiceLogBuffer((digest) => {
      if (!open) return false;
      onDigest(digest);
      return true;
    }, "chat");

    buffer.add([
      entry(1, "screenshot", {
        attachmentId: "att-a",
        attachmentFilename: "shot.png",
        attachmentFileSize: 1024,
      }),
    ]);
    buffer.drainNow();
    expect(onDigest).not.toHaveBeenCalled();

    open = true;
    buffer.drainNow();
    expect(onDigest).toHaveBeenCalledTimes(1);
    expect(imagesOf(onDigest, 0)).toEqual([
      { attachmentId: "att-a", filename: "shot.png", fileSize: 1024 },
    ]);
  });
});
