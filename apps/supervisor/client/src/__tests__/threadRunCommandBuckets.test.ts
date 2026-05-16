import { describe, expect, test } from "vitest";

import type { ThreadRunCommand } from "../hooks/thread-runs/useThreadRunCommands";
import { bucketRunCommandsByMessage } from "../lib/threadRunCommandBuckets";

const msg = (id: number, fromUsername: string, createdAt: string) => ({
  id,
  fromUsername,
  createdAt,
});

const cmd = (
  logId: number,
  username: string,
  createdAt: string,
): ThreadRunCommand => ({
  logId,
  username,
  runId: 100 + logId,
  subagentId: null,
  sessionId: 200 + logId,
  message: `command ${logId}`,
  createdAt,
});

describe("bucketRunCommandsByMessage", () => {
  test("prefers the next same-user message header over a preceding footer", () => {
    const buckets = bucketRunCommandsByMessage(
      [
        msg(1, "ada", "2026-05-01T10:00:00.000Z"),
        msg(2, "ada", "2026-05-01T10:10:00.000Z"),
      ],
      [cmd(11, "ada", "2026-05-01T10:05:00.000Z")],
    );

    expect(buckets.beforeMessage.get(2)?.map((c) => c.logId)).toEqual([11]);
    expect(buckets.afterMessage.size).toBe(0);
    expect(buckets.phantomsBeforeMessage.size).toBe(0);
    expect(buckets.trailing.size).toBe(0);
  });

  test("puts follow-up activity on the immediately preceding same-user message footer", () => {
    const buckets = bucketRunCommandsByMessage(
      [
        msg(1, "ada", "2026-05-01T10:00:00.000Z"),
        msg(2, "grace", "2026-05-01T10:10:00.000Z"),
      ],
      [
        cmd(12, "ada", "2026-05-01T10:07:00.000Z"),
        cmd(11, "ada", "2026-05-01T10:05:00.000Z"),
      ],
    );

    expect(buckets.afterMessage.get(1)?.map((c) => c.logId)).toEqual([
      11, 12,
    ]);
    expect(buckets.beforeMessage.size).toBe(0);
    expect(buckets.phantomsBeforeMessage.size).toBe(0);
    expect(buckets.trailing.size).toBe(0);
  });

  test("uses a phantom before the next message when surrounding messages are from other users", () => {
    const buckets = bucketRunCommandsByMessage(
      [
        msg(1, "grace", "2026-05-01T10:00:00.000Z"),
        msg(2, "linus", "2026-05-01T10:10:00.000Z"),
      ],
      [cmd(11, "ada", "2026-05-01T10:05:00.000Z")],
    );

    expect(
      buckets.phantomsBeforeMessage.get(2)?.get("ada")?.map((c) => c.logId),
    ).toEqual([11]);
    expect(buckets.beforeMessage.size).toBe(0);
    expect(buckets.afterMessage.size).toBe(0);
    expect(buckets.trailing.size).toBe(0);
  });

  test("uses a footer instead of a trailing phantom after the last same-user message", () => {
    const buckets = bucketRunCommandsByMessage(
      [msg(1, "ada", "2026-05-01T10:00:00.000Z")],
      [cmd(11, "ada", "2026-05-01T10:05:00.000Z")],
    );

    expect(buckets.afterMessage.get(1)?.map((c) => c.logId)).toEqual([11]);
    expect(buckets.trailing.size).toBe(0);
  });

  test("uses a trailing phantom when there is no following or preceding same-user message", () => {
    const buckets = bucketRunCommandsByMessage(
      [msg(1, "grace", "2026-05-01T10:00:00.000Z")],
      [cmd(11, "ada", "2026-05-01T10:05:00.000Z")],
    );

    expect(buckets.trailing.get("ada")?.map((c) => c.logId)).toEqual([11]);
    expect(buckets.beforeMessage.size).toBe(0);
    expect(buckets.afterMessage.size).toBe(0);
    expect(buckets.phantomsBeforeMessage.size).toBe(0);
  });

  test("drops commands older than the visible window when older messages exist", () => {
    const buckets = bucketRunCommandsByMessage(
      [msg(1, "ada", "2026-05-01T10:10:00.000Z")],
      [cmd(11, "ada", "2026-05-01T10:00:00.000Z")],
      true,
    );

    expect(buckets.beforeMessage.size).toBe(0);
    expect(buckets.afterMessage.size).toBe(0);
    expect(buckets.phantomsBeforeMessage.size).toBe(0);
    expect(buckets.trailing.size).toBe(0);
  });
});
