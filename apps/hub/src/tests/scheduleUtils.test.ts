import {
  nextFireAt,
  nextRunAtForSchedules,
  parseSchedulesFromConfigJson,
  prevFireAt,
  validateCron,
  wasDueIn,
} from "@naisys/common";
import { describe, expect, test } from "vitest";

describe("validateCron", () => {
  test("accepts a valid 5-field expression", () => {
    expect(validateCron("0 9 * * *")).toEqual({ ok: true });
  });

  test("rejects 6-field expressions", () => {
    // cron-parser otherwise accepts the seconds-prefixed form silently.
    // "0 0 * * * *" looks like daily but means hourly, which is a footgun.
    const result = validateCron("0 0 * * * *");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Expected 5 fields");
  });

  test("rejects fewer than 5 fields", () => {
    const result = validateCron("0 9 *");
    expect(result.ok).toBe(false);
  });

  test("rejects unparseable expressions", () => {
    const result = validateCron("not a cron");
    expect(result.ok).toBe(false);
  });

  test("trims and validates", () => {
    expect(validateCron("  0 9 * * *  ")).toEqual({ ok: true });
  });
});

describe("nextFireAt", () => {
  test("returns the next occurrence strictly after `after`", () => {
    // 09:00 UTC daily, asking at 08:00 → 09:00 same day.
    const after = new Date("2026-05-18T08:00:00Z");
    const next = nextFireAt("0 9 * * *", after, "UTC");
    expect(next?.toISOString()).toBe("2026-05-18T09:00:00.000Z");
  });

  test("at the boundary, returns the NEXT occurrence not this one", () => {
    // Asking exactly at 09:00 returns 09:00 tomorrow, not today.
    const after = new Date("2026-05-18T09:00:00Z");
    const next = nextFireAt("0 9 * * *", after, "UTC");
    expect(next?.toISOString()).toBe("2026-05-19T09:00:00.000Z");
  });

  test("returns null on invalid expression", () => {
    expect(nextFireAt("garbage")).toBeNull();
  });

  test("respects timezone", () => {
    // 09:00 America/New_York on 2026-05-18 (EDT, UTC-4) = 13:00 UTC.
    const after = new Date("2026-05-18T00:00:00Z");
    const next = nextFireAt("0 9 * * *", after, "America/New_York");
    expect(next?.toISOString()).toBe("2026-05-18T13:00:00.000Z");
  });
});

describe("wasDueIn", () => {
  test("true when the last fire is within the window", () => {
    // 09:00 fire, now is 09:00:30 → 30s ago, within 60s window.
    const now = new Date("2026-05-18T09:00:30Z");
    expect(wasDueIn("0 9 * * *", 60_000, now, "UTC")).toBe(true);
  });

  test("true at the exact occurrence boundary (inclusive +1ms shift)", () => {
    // Asking exactly at 09:00 — the +1ms shift inside wasDueIn makes
    // prev() return this occurrence rather than yesterday's.
    const now = new Date("2026-05-18T09:00:00Z");
    expect(wasDueIn("0 9 * * *", 60_000, now, "UTC")).toBe(true);
  });

  test("false when the last fire is older than the window", () => {
    // 09:00 fire, now is 09:02 → 2min ago, outside 60s window.
    const now = new Date("2026-05-18T09:02:00Z");
    expect(wasDueIn("0 9 * * *", 60_000, now, "UTC")).toBe(false);
  });

  test("false on invalid expression (safe default — skip rather than misfire)", () => {
    expect(wasDueIn("garbage", 60_000, new Date(), "UTC")).toBe(false);
  });
});

describe("prevFireAt", () => {
  test("at the exact occurrence boundary, returns this occurrence (inclusive)", () => {
    // The +1ms shift mirrors wasDueIn: dedupe scopes "current occurrence"
    // to include the moment of fire itself, not the previous one.
    const before = new Date("2026-05-18T09:00:00Z");
    const prev = prevFireAt("0 9 * * *", before, "UTC");
    expect(prev?.toISOString()).toBe("2026-05-18T09:00:00.000Z");
  });

  test("just before the occurrence, returns yesterday's fire", () => {
    const before = new Date("2026-05-18T08:59:59.999Z");
    const prev = prevFireAt("0 9 * * *", before, "UTC");
    expect(prev?.toISOString()).toBe("2026-05-17T09:00:00.000Z");
  });

  test("returns null on invalid expression", () => {
    expect(prevFireAt("garbage")).toBeNull();
  });
});

describe("nextRunAtForSchedules", () => {
  test("returns the earliest fire across enabled entries", () => {
    const after = new Date("2026-05-18T00:00:00Z");
    const result = nextRunAtForSchedules(
      [
        { name: "evening", cron: "0 18 * * *" },
        { name: "morning", cron: "0 9 * * *" },
      ],
      after,
      "UTC",
    );
    expect(result?.toISOString()).toBe("2026-05-18T09:00:00.000Z");
  });

  test("ignores entries with enabled: false", () => {
    const after = new Date("2026-05-18T00:00:00Z");
    const result = nextRunAtForSchedules(
      [
        { name: "morning", cron: "0 9 * * *", enabled: false },
        { name: "evening", cron: "0 18 * * *" },
      ],
      after,
      "UTC",
    );
    // morning would have been earliest but is disabled — picks evening.
    expect(result?.toISOString()).toBe("2026-05-18T18:00:00.000Z");
  });

  test("treats missing `enabled` as enabled", () => {
    const after = new Date("2026-05-18T00:00:00Z");
    const result = nextRunAtForSchedules(
      [{ name: "morning", cron: "0 9 * * *" }],
      after,
      "UTC",
    );
    expect(result?.toISOString()).toBe("2026-05-18T09:00:00.000Z");
  });

  test("silently skips entries with invalid crons", () => {
    // Invalid crons should have been caught upstream; here we degrade
    // gracefully rather than disabling all schedules.
    const after = new Date("2026-05-18T00:00:00Z");
    const result = nextRunAtForSchedules(
      [
        { name: "bad", cron: "garbage" },
        { name: "morning", cron: "0 9 * * *" },
      ],
      after,
      "UTC",
    );
    expect(result?.toISOString()).toBe("2026-05-18T09:00:00.000Z");
  });

  test("returns null when no enabled entries produce a fire", () => {
    expect(nextRunAtForSchedules([], new Date(), "UTC")).toBeNull();
    expect(
      nextRunAtForSchedules(
        [{ name: "x", cron: "0 9 * * *", enabled: false }],
        new Date(),
        "UTC",
      ),
    ).toBeNull();
    expect(nextRunAtForSchedules(undefined, new Date(), "UTC")).toBeNull();
  });
});

describe("parseSchedulesFromConfigJson", () => {
  test("returns [] for null/undefined/empty", () => {
    expect(parseSchedulesFromConfigJson(null)).toEqual([]);
    expect(parseSchedulesFromConfigJson(undefined)).toEqual([]);
    expect(parseSchedulesFromConfigJson("")).toEqual([]);
  });

  test("returns [] for invalid JSON without throwing", () => {
    expect(parseSchedulesFromConfigJson("{not json")).toEqual([]);
  });

  test("returns [] when no schedules field", () => {
    expect(parseSchedulesFromConfigJson('{"other": "field"}')).toEqual([]);
  });

  test("returns valid entries from a partial config", () => {
    // Crucially: we don't parse the full AgentConfigFile here — one bad
    // unrelated field shouldn't blank out all schedules.
    const json = JSON.stringify({
      shellModel: "anything",
      something_bogus: { not: "valid" },
      schedules: [{ name: "ok-entry", cron: "0 9 * * *", enabled: true }],
    });
    const result = parseSchedulesFromConfigJson(json);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("ok-entry");
  });

  test("drops individual entries that fail to parse, keeps the rest", () => {
    // A typo in one entry shouldn't disable the whole agent's scheduling.
    const json = JSON.stringify({
      schedules: [
        { name: "good", cron: "0 9 * * *" },
        { name: "bad", cron: "garbage" }, // invalid cron
        { name: "also-good", cron: "0 18 * * *" },
      ],
    });
    const result = parseSchedulesFromConfigJson(json);
    expect(result.map((s) => s.name)).toEqual(["good", "also-good"]);
  });

  test("drops entries with invalid name format", () => {
    const json = JSON.stringify({
      schedules: [
        { name: "good", cron: "0 9 * * *" },
        { name: "has spaces", cron: "0 18 * * *" },
      ],
    });
    const result = parseSchedulesFromConfigJson(json);
    expect(result.map((s) => s.name)).toEqual(["good"]);
  });
});
