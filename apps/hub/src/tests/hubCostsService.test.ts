import {
  calculateEffectiveSpendStart,
  parseSpendLimitsFromConfigJson,
} from "@naisys/common";
import { type PrismaClient,sumUserCostsInPeriod } from "@naisys/hub-database";
import { afterEach, describe, expect, test, vi } from "vitest";

function createHubDb(sum: number | null = 0) {
  return {
    costs: {
      aggregate: vi.fn(() => Promise.resolve({ _sum: { cost: sum } })),
    },
  } as unknown as PrismaClient;
}

describe("shared cost-window helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("parses spend limits from partial user config JSON", () => {
    expect(
      parseSpendLimitsFromConfigJson(
        JSON.stringify({
          username: "admin",
          spendLimitDollars: 25,
          spendLimitHours: 24,
          unrelated: true,
        }),
      ),
    ).toEqual({
      spendLimitDollars: 25,
      spendLimitHours: 24,
    });

    expect(parseSpendLimitsFromConfigJson(null)).toEqual({});
    expect(parseSpendLimitsFromConfigJson("not-json")).toEqual({});
    expect(
      parseSpendLimitsFromConfigJson(
        JSON.stringify({ spendLimitDollars: "25" }),
      ),
    ).toEqual({});
  });

  test("resolves all-time and manual reset spend starts", () => {
    const resetAt = new Date("2026-05-01T12:00:00.000Z");

    expect(calculateEffectiveSpendStart(undefined)).toBeUndefined();
    expect(calculateEffectiveSpendStart(undefined, resetAt)).toBe(resetAt);
  });

  test("prefers a reset cursor when it is later than the fixed period start", () => {
    vi.useFakeTimers();
    const resetAt = new Date("2026-05-01T12:00:00.000Z");
    vi.setSystemTime(new Date("2026-05-01T13:00:00.000Z"));

    expect(calculateEffectiveSpendStart(24, resetAt)).toBe(resetAt);
  });

  test("sums global all-time cost without user or date filters", async () => {
    const hubDb = createHubDb(1.23);

    await expect(sumUserCostsInPeriod(hubDb)).resolves.toBe(1.23);

    expect(hubDb.costs.aggregate).toHaveBeenCalledWith({
      _sum: { cost: true },
      where: {},
    });
  });

  test("sums user cost from a manual reset cursor", async () => {
    const hubDb = createHubDb(null);
    const resetAt = new Date("2026-05-01T12:00:00.000Z");

    await expect(
      sumUserCostsInPeriod(hubDb, {
        userId: 7,
        spendLimitResetAt: resetAt,
      }),
    ).resolves.toBe(0);

    expect(hubDb.costs.aggregate).toHaveBeenCalledWith({
      _sum: { cost: true },
      where: {
        user_id: 7,
        created_at: { gte: resetAt },
      },
    });
  });
});
