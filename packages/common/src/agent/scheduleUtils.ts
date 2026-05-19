import { CronExpressionParser } from "cron-parser";
import { z } from "zod";

import {
  URL_SAFE_KEY_MESSAGE,
  URL_SAFE_KEY_REGEX,
} from "../auth/urlSafeKey.js";

export const ScheduleEntrySchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .regex(URL_SAFE_KEY_REGEX, URL_SAFE_KEY_MESSAGE)
    .describe("Unique identifier for this schedule within the agent"),

  cron: z
    .string()
    .min(1, "Cron expression is required")
    .refine((expr) => validateCron(expr).ok, {
      message: "Invalid cron expression",
    })
    .describe("Standard 5-field cron expression in the hub's local timezone"),

  enabled: z
    .boolean()
    .optional()
    .describe("When false, the schedule is paused but kept for editing"),

  prompt: z
    .string()
    .max(2000, "Prompt must be at most 2000 characters")
    .optional()
    .describe(
      "Chat message sent to the agent when the schedule fires. Falls back to the schedule name when empty",
    ),
});

export type ScheduleEntry = z.infer<typeof ScheduleEntrySchema>;

export function validateCron(
  expression: string,
): { ok: true } | { ok: false; error: string } {
  // Reject 6-field (seconds) and other arities up front. cron-parser accepts
  // them, but the scheduler ticks every 30s so seconds-level expressions
  // can't be honored — and a copy-pasted 6-field cron like "0 0 * * * *"
  // silently means "every hour", not "daily", which is a footgun.
  const fields = expression.trim().split(/\s+/).filter(Boolean);
  if (fields.length !== 5) {
    return {
      ok: false,
      error: `Expected 5 fields (min hour day month weekday), got ${fields.length}`,
    };
  }
  try {
    CronExpressionParser.parse(expression);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Next fire strictly after `after`, or null on invalid expression. `tz`
 *  defaults to the JS runtime's local zone. */
export function nextFireAt(
  expression: string,
  after: Date = new Date(),
  tz?: string,
): Date | null {
  try {
    const expr = CronExpressionParser.parse(expression, {
      currentDate: after,
      ...(tz ? { tz } : {}),
    });
    return expr.next().toDate();
  } catch {
    return null;
  }
}

/** True if the cron's most recent scheduled fire is within `windowMs` of
 *  `now`. The scheduler's "fire on this tick vs. skip" check — anything
 *  older than `windowMs` is dropped (missed-fire policy = skip).
 *  The +1ms shift makes the boundary inclusive: at exactly 09:00:00.000,
 *  cron-parser's prev() otherwise jumps back to the previous occurrence. */
export function wasDueIn(
  expression: string,
  windowMs: number,
  now: Date = new Date(),
  tz?: string,
): boolean {
  try {
    const expr = CronExpressionParser.parse(expression, {
      currentDate: new Date(now.getTime() + 1),
      ...(tz ? { tz } : {}),
    });
    const prev = expr.prev().toDate();
    return now.getTime() - prev.getTime() <= windowMs;
  } catch {
    return false;
  }
}

/** Most recent scheduled fire at-or-before `before`, or null on invalid
 *  expression. Used to delimit "the current occurrence" for dedupe so
 *  a restart-sweep doesn't refire an occurrence that already fired.
 *  The +1ms shift mirrors `wasDueIn` so the boundary is inclusive. */
export function prevFireAt(
  expression: string,
  before: Date = new Date(),
  tz?: string,
): Date | null {
  try {
    const expr = CronExpressionParser.parse(expression, {
      currentDate: new Date(before.getTime() + 1),
      ...(tz ? { tz } : {}),
    });
    return expr.prev().toDate();
  } catch {
    return null;
  }
}

/** MIN(next fire) across enabled entries; null if none. Invalid crons are
 *  skipped silently — upstream validation should have caught them. */
export function nextRunAtForSchedules(
  schedules: ScheduleEntry[] | undefined,
  after: Date = new Date(),
  tz?: string,
): Date | null {
  if (!schedules?.length) return null;
  let earliest: Date | null = null;
  for (const entry of schedules) {
    if (entry.enabled === false) continue;
    const next = nextFireAt(entry.cron, after, tz);
    if (!next) continue;
    if (!earliest || next < earliest) earliest = next;
  }
  return earliest;
}

const UserConfigSchedulesSchema = z
  .object({ schedules: z.array(z.unknown()).optional() })
  .loose();

/** Extract `schedules` from a stored `users.config` JSON. Avoids parsing
 *  the full `AgentConfigFile` so one bad field elsewhere doesn't disable
 *  all schedules; individual entries that fail their parse are dropped. */
export function parseSchedulesFromConfigJson(
  configJson: string | null | undefined,
): ScheduleEntry[] {
  if (!configJson) return [];
  try {
    const raw = UserConfigSchedulesSchema.parse(
      JSON.parse(configJson),
    ).schedules;
    if (!raw) return [];
    const valid: ScheduleEntry[] = [];
    for (const entry of raw) {
      const parsed = ScheduleEntrySchema.safeParse(entry);
      if (parsed.success) valid.push(parsed.data);
    }
    return valid;
  } catch {
    return [];
  }
}
