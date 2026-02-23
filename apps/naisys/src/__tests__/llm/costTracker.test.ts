import { describe, expect, test } from "@jest/globals";

// Simple unit test for the calculation function without needing the full module
describe("calculatePeriodBoundaries", () => {
  // Copy of the function for testing
  function calculatePeriodBoundaries(
    hours: number,
    now: Date = new Date(),
  ): {
    periodStart: Date;
    periodEnd: Date;
  } {
    // Get midnight of current day in local time
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);

    // Calculate milliseconds since midnight
    const msSinceMidnight = now.getTime() - midnight.getTime();
    const hoursSinceMidnight = msSinceMidnight / (1000 * 60 * 60);

    // Calculate which period we're in (0, 1, 2, ...)
    const periodIndex = Math.floor(hoursSinceMidnight / hours);

    // Calculate period start and end
    const periodStartHours = periodIndex * hours;
    const periodEndHours = (periodIndex + 1) * hours;

    const periodStart = new Date(
      midnight.getTime() + periodStartHours * 60 * 60 * 1000,
    );
    const periodEnd = new Date(
      midnight.getTime() + periodEndHours * 60 * 60 * 1000,
    );

    return { periodStart, periodEnd };
  }

  test("should calculate 1-hour periods correctly at 10:30 AM", () => {
    const now = new Date("2025-11-09T10:30:00");
    const result = calculatePeriodBoundaries(1, now);

    expect(result.periodStart.getHours()).toBe(10);
    expect(result.periodStart.getMinutes()).toBe(0);
    expect(result.periodEnd.getHours()).toBe(11);
    expect(result.periodEnd.getMinutes()).toBe(0);
  });

  test("should calculate 2-hour periods correctly at 3:30 PM", () => {
    const now = new Date("2025-11-09T15:30:00");
    const result = calculatePeriodBoundaries(2, now);

    // 15:30 is in the 14:00-16:00 period (7th period of the day)
    expect(result.periodStart.getHours()).toBe(14);
    expect(result.periodStart.getMinutes()).toBe(0);
    expect(result.periodEnd.getHours()).toBe(16);
    expect(result.periodEnd.getMinutes()).toBe(0);
  });

  test("should calculate 2-hour periods at midnight boundary", () => {
    const now = new Date("2025-11-09T00:30:00");
    const result = calculatePeriodBoundaries(2, now);

    // 00:30 is in the 00:00-02:00 period
    expect(result.periodStart.getHours()).toBe(0);
    expect(result.periodStart.getMinutes()).toBe(0);
    expect(result.periodEnd.getHours()).toBe(2);
    expect(result.periodEnd.getMinutes()).toBe(0);
  });

  test("should calculate 2-hour periods at 2:00 AM exactly", () => {
    const now = new Date("2025-11-09T02:00:00");
    const result = calculatePeriodBoundaries(2, now);

    // 02:00 exactly is the start of the 02:00-04:00 period
    expect(result.periodStart.getHours()).toBe(2);
    expect(result.periodStart.getMinutes()).toBe(0);
    expect(result.periodEnd.getHours()).toBe(4);
    expect(result.periodEnd.getMinutes()).toBe(0);
  });

  test("should calculate 24-hour periods (daily)", () => {
    const now = new Date("2025-11-09T15:30:00");
    const result = calculatePeriodBoundaries(24, now);

    // Should be entire day: 00:00-24:00 (next day 00:00)
    expect(result.periodStart.getHours()).toBe(0);
    expect(result.periodStart.getMinutes()).toBe(0);
    expect(result.periodEnd.getHours()).toBe(0);
    expect(result.periodEnd.getMinutes()).toBe(0);
    expect(result.periodEnd.getDate()).toBe(10); // Next day
  });

  test("should calculate 0.25-hour periods (15 minutes) at 2:07 PM", () => {
    const now = new Date("2025-11-09T14:07:00");
    const result = calculatePeriodBoundaries(0.25, now);

    // 14:07 is in the 14:00-14:15 period
    expect(result.periodStart.getHours()).toBe(14);
    expect(result.periodStart.getMinutes()).toBe(0);
    expect(result.periodEnd.getHours()).toBe(14);
    expect(result.periodEnd.getMinutes()).toBe(15);
  });

  test("should calculate 0.25-hour periods (15 minutes) at 2:17 PM", () => {
    const now = new Date("2025-11-09T14:17:00");
    const result = calculatePeriodBoundaries(0.25, now);

    // 14:17 is in the 14:15-14:30 period
    expect(result.periodStart.getHours()).toBe(14);
    expect(result.periodStart.getMinutes()).toBe(15);
    expect(result.periodEnd.getHours()).toBe(14);
    expect(result.periodEnd.getMinutes()).toBe(30);
  });

  test("should calculate 0.5-hour periods (30 minutes) at 2:47 PM", () => {
    const now = new Date("2025-11-09T14:47:00");
    const result = calculatePeriodBoundaries(0.5, now);

    // 14:47 is in the 14:30-15:00 period
    expect(result.periodStart.getHours()).toBe(14);
    expect(result.periodStart.getMinutes()).toBe(30);
    expect(result.periodEnd.getHours()).toBe(15);
    expect(result.periodEnd.getMinutes()).toBe(0);
  });

  test("should calculate 3-hour periods correctly", () => {
    const now = new Date("2025-11-09T08:30:00");
    const result = calculatePeriodBoundaries(3, now);

    // 08:30 is in the 06:00-09:00 period (3rd period of the day)
    expect(result.periodStart.getHours()).toBe(6);
    expect(result.periodStart.getMinutes()).toBe(0);
    expect(result.periodEnd.getHours()).toBe(9);
    expect(result.periodEnd.getMinutes()).toBe(0);
  });

  test("should calculate 6-hour periods correctly", () => {
    const now = new Date("2025-11-09T19:15:00");
    const result = calculatePeriodBoundaries(6, now);

    // 19:15 is in the 18:00-24:00 period (4th period of the day)
    expect(result.periodStart.getHours()).toBe(18);
    expect(result.periodStart.getMinutes()).toBe(0);
    expect(result.periodEnd.getHours()).toBe(0);
    expect(result.periodEnd.getMinutes()).toBe(0);
    expect(result.periodEnd.getDate()).toBe(10); // Next day
  });

  test("should calculate period duration correctly", () => {
    const now = new Date("2025-11-09T10:30:00");
    const hours = 2;
    const result = calculatePeriodBoundaries(hours, now);

    const durationMs =
      result.periodEnd.getTime() - result.periodStart.getTime();
    const durationHours = durationMs / (1000 * 60 * 60);

    expect(durationHours).toBe(hours);
  });

  test("should handle late night periods correctly", () => {
    const now = new Date("2025-11-09T23:30:00");
    const result = calculatePeriodBoundaries(2, now);

    // 23:30 is in the 22:00-00:00 period
    expect(result.periodStart.getHours()).toBe(22);
    expect(result.periodStart.getMinutes()).toBe(0);
    expect(result.periodEnd.getHours()).toBe(0);
    expect(result.periodEnd.getMinutes()).toBe(0);
    expect(result.periodEnd.getDate()).toBe(10); // Next day
  });
});

describe("calculateModelCacheSavings", () => {
  // Copy of the function for testing
  function calculateModelCacheSavings(modelData: any, model: any) {
    const cacheWriteTokens = modelData.cache_write_tokens || 0;
    const cacheReadTokens = modelData.cache_read_tokens || 0;
    const totalCacheTokens = cacheWriteTokens + cacheReadTokens;

    if (totalCacheTokens === 0 || !model.inputCost) {
      return null;
    }

    // Calculate what these cache tokens would have cost at regular input rate
    const cacheSavingsAmount =
      (cacheWriteTokens * (model.inputCost - (model.cacheWriteCost || 0))) /
        1_000_000 +
      (cacheReadTokens * (model.inputCost - (model.cacheReadCost || 0))) /
        1_000_000;

    const costWithoutCaching = modelData.total + cacheSavingsAmount;
    const savingsPercent =
      cacheSavingsAmount > 0
        ? (cacheSavingsAmount / costWithoutCaching) * 100
        : 0;

    return {
      savingsAmount: cacheSavingsAmount,
      costWithoutCaching,
      savingsPercent,
      totalCacheTokens,
    };
  }

  test("should return null when no cache tokens", () => {
    const modelData = {
      total: 1.0,
      cache_write_tokens: 0,
      cache_read_tokens: 0,
      cache_write: 0,
      cache_read: 0,
    };
    const model = { inputCost: 3.0, cacheWriteCost: 3.75, cacheReadCost: 1.5 };

    const result = calculateModelCacheSavings(modelData, model);
    expect(result).toBeNull();
  });

  test("should return null when model has no inputCost", () => {
    const modelData = {
      total: 1.0,
      cache_write_tokens: 1000,
      cache_read_tokens: 1000,
      cache_write: 0.00375,
      cache_read: 0.0015,
    };
    const model = { inputCost: 0, cacheWriteCost: 3.75, cacheReadCost: 1.5 };

    const result = calculateModelCacheSavings(modelData, model);
    expect(result).toBeNull();
  });

  test("should calculate savings correctly for cache read tokens", () => {
    const modelData = {
      total: 0.0015,
      cache_write_tokens: 0,
      cache_read_tokens: 1000,
      cache_write: 0,
      cache_read: 0.0015,
    };
    const model = { inputCost: 3.0, cacheWriteCost: 3.75, cacheReadCost: 1.5 };

    const result = calculateModelCacheSavings(modelData, model);

    // Cache read savings: 1000 * (3.0 - 1.5) / 1,000,000 = 0.0015
    expect(result?.savingsAmount).toBeCloseTo(0.0015, 6);
    // Cost without caching: 0.0015 + 0.0015 = 0.003
    expect(result?.costWithoutCaching).toBeCloseTo(0.003, 6);
    // Savings percent: 0.0015 / 0.003 * 100 = 50%
    expect(result?.savingsPercent).toBeCloseTo(50, 1);
    expect(result?.totalCacheTokens).toBe(1000);
  });

  test("should calculate savings correctly for cache write tokens", () => {
    const modelData = {
      total: 0.00375,
      cache_write_tokens: 1000,
      cache_read_tokens: 0,
      cache_write: 0.00375,
      cache_read: 0,
    };
    const model = { inputCost: 3.0, cacheWriteCost: 3.75, cacheReadCost: 1.5 };

    const result = calculateModelCacheSavings(modelData, model);

    // Cache write savings: 1000 * (3.0 - 3.75) / 1,000,000 = -0.00075 (no actual savings)
    expect(result?.savingsAmount).toBeCloseTo(-0.00075, 6);
    // Cost without caching: 0.00375 + (-0.00075) = 0.003
    expect(result?.costWithoutCaching).toBeCloseTo(0.003, 6);
    // Savings percent: 0 (since savings is negative)
    expect(result?.savingsPercent).toBe(0);
    expect(result?.totalCacheTokens).toBe(1000);
  });

  test("should calculate combined cache write and read savings", () => {
    const modelData = {
      total: 0.0053,
      cache_write_tokens: 1000,
      cache_read_tokens: 2000,
      cache_write: 0.00375,
      cache_read: 0.003,
    };
    const model = { inputCost: 3.0, cacheWriteCost: 3.75, cacheReadCost: 1.5 };

    const result = calculateModelCacheSavings(modelData, model);

    // Write savings: 1000 * (3.0 - 3.75) / 1,000,000 = -0.00075
    // Read savings: 2000 * (3.0 - 1.5) / 1,000,000 = 0.003
    // Total savings: -0.00075 + 0.003 = 0.00225
    expect(result?.savingsAmount).toBeCloseTo(0.00225, 6);
    // Cost without caching: 0.0053 + 0.00225 = 0.00755
    expect(result?.costWithoutCaching).toBeCloseTo(0.00755, 6);
    // Savings percent: 0.00225 / 0.00755 * 100 ≈ 29.8%
    expect(result?.savingsPercent).toBeCloseTo(29.8, 1);
    expect(result?.totalCacheTokens).toBe(3000);
  });
});
