import { describe, expect, test } from "vitest";

import type { LogEntry } from "../lib/api/apiClient";
import { mergeLogEntries } from "../hooks/useContextLog";

const log = (id: number, message: string = `log-${id}`): LogEntry => ({
  id,
  username: "agent",
  role: "NAISYS",
  source: "console",
  type: "comment",
  message,
  createdAt: new Date(id).toISOString(),
});

describe("mergeLogEntries", () => {
  test("returns the same array when there are no incoming logs", () => {
    const existing = [log(1)];

    expect(mergeLogEntries(existing, [])).toBe(existing);
  });

  test("appends live entries sorted by id when they are all newer", () => {
    expect(mergeLogEntries([log(1)], [log(3), log(2)])).toEqual([
      log(1),
      log(2),
      log(3),
    ]);
  });

  test("dedupes and sorts recovered gap entries, keeping incoming copies", () => {
    expect(
      mergeLogEntries(
        [log(1), log(3, "stale"), log(5)],
        [log(4), log(2), log(3, "fresh")],
      ),
    ).toEqual([log(1), log(2), log(3, "fresh"), log(4), log(5)]);
  });
});
