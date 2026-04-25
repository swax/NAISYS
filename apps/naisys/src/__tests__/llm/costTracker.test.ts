import { calculatePeriodBoundaries } from "@naisys/common";
import { describe, expect, test } from "vitest";

import { calculateModelCacheSavings } from "../../llm/cacheSavings.js";
import type { LlmModelCosts } from "../../llm/costTracker.js";

describe("calculatePeriodBoundaries", () => {
  test.each([
    {
      label: "1-hour period at 10:30 AM",
      now: "2025-11-09T10:30:00",
      hours: 1,
      start: { hour: 10, minute: 0, date: 9 },
      end: { hour: 11, minute: 0, date: 9 },
    },
    {
      label: "2-hour period at 3:30 PM",
      now: "2025-11-09T15:30:00",
      hours: 2,
      start: { hour: 14, minute: 0, date: 9 },
      end: { hour: 16, minute: 0, date: 9 },
    },
    {
      label: "2-hour period at 00:30 (midnight boundary)",
      now: "2025-11-09T00:30:00",
      hours: 2,
      start: { hour: 0, minute: 0, date: 9 },
      end: { hour: 2, minute: 0, date: 9 },
    },
    {
      label: "2-hour period at 02:00 exactly",
      now: "2025-11-09T02:00:00",
      hours: 2,
      start: { hour: 2, minute: 0, date: 9 },
      end: { hour: 4, minute: 0, date: 9 },
    },
    {
      label: "24-hour period (daily)",
      now: "2025-11-09T15:30:00",
      hours: 24,
      start: { hour: 0, minute: 0, date: 9 },
      end: { hour: 0, minute: 0, date: 10 },
    },
    {
      label: "15-minute period at 14:07",
      now: "2025-11-09T14:07:00",
      hours: 0.25,
      start: { hour: 14, minute: 0, date: 9 },
      end: { hour: 14, minute: 15, date: 9 },
    },
    {
      label: "15-minute period at 14:17",
      now: "2025-11-09T14:17:00",
      hours: 0.25,
      start: { hour: 14, minute: 15, date: 9 },
      end: { hour: 14, minute: 30, date: 9 },
    },
    {
      label: "30-minute period at 14:47",
      now: "2025-11-09T14:47:00",
      hours: 0.5,
      start: { hour: 14, minute: 30, date: 9 },
      end: { hour: 15, minute: 0, date: 9 },
    },
    {
      label: "3-hour period at 08:30",
      now: "2025-11-09T08:30:00",
      hours: 3,
      start: { hour: 6, minute: 0, date: 9 },
      end: { hour: 9, minute: 0, date: 9 },
    },
    {
      label: "6-hour period at 19:15 (crosses midnight)",
      now: "2025-11-09T19:15:00",
      hours: 6,
      start: { hour: 18, minute: 0, date: 9 },
      end: { hour: 0, minute: 0, date: 10 },
    },
    {
      label: "2-hour period at 23:30 (crosses midnight)",
      now: "2025-11-09T23:30:00",
      hours: 2,
      start: { hour: 22, minute: 0, date: 9 },
      end: { hour: 0, minute: 0, date: 10 },
    },
  ])("$label", ({ now, hours, start, end }) => {
    const result = calculatePeriodBoundaries(hours, new Date(now));

    expect(result.periodStart.getHours()).toBe(start.hour);
    expect(result.periodStart.getMinutes()).toBe(start.minute);
    expect(result.periodStart.getDate()).toBe(start.date);
    expect(result.periodEnd.getHours()).toBe(end.hour);
    expect(result.periodEnd.getMinutes()).toBe(end.minute);
    expect(result.periodEnd.getDate()).toBe(end.date);
  });

  test("period duration matches the requested hours", () => {
    const result = calculatePeriodBoundaries(2, new Date("2025-11-09T10:30:00"));
    const durationHours =
      (result.periodEnd.getTime() - result.periodStart.getTime()) /
      (1000 * 60 * 60);
    expect(durationHours).toBe(2);
  });
});

describe("calculateModelCacheSavings", () => {
  const model: LlmModelCosts = {
    inputCost: 3.0,
    outputCost: 15,
    cacheWriteCost: 3.75,
    cacheReadCost: 1.5,
  };

  test("returns null when no cache tokens", () => {
    const result = calculateModelCacheSavings(
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      },
      model,
    );
    expect(result).toBeNull();
  });

  test("returns null when model has no inputCost", () => {
    const result = calculateModelCacheSavings(
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 1000,
        cacheReadTokens: 1000,
      },
      { ...model, inputCost: 0 },
    );
    expect(result).toBeNull();
  });

  test("calculates savings for cache read tokens only", () => {
    const result = calculateModelCacheSavings(
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 1000,
      },
      model,
    );

    // Cache read savings: 1000 * (3.0 - 1.5) / 1,000,000 = 0.0015
    expect(result?.savingsAmount).toBeCloseTo(0.0015, 6);
    // Actual cache spend + savings: 0.0015 + 0.0015 = 0.003
    expect(result?.costWithoutCaching).toBeCloseTo(0.003, 6);
    expect(result?.savingsPercent).toBeCloseTo(50, 1);
    expect(result?.totalCacheTokens).toBe(1000);
  });

  test("calculates savings for cache write tokens only (negative when write cost > input cost)", () => {
    const result = calculateModelCacheSavings(
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 1000,
        cacheReadTokens: 0,
      },
      model,
    );

    // Write savings: 1000 * (3.0 - 3.75) / 1,000,000 = -0.00075
    expect(result?.savingsAmount).toBeCloseTo(-0.00075, 6);
    // Actual cache spend (0.00375) + savings (-0.00075) = 0.003
    expect(result?.costWithoutCaching).toBeCloseTo(0.003, 6);
    // Savings percent is 0 when savings amount is negative
    expect(result?.savingsPercent).toBe(0);
    expect(result?.totalCacheTokens).toBe(1000);
  });

  test("calculates combined cache write and read savings", () => {
    const result = calculateModelCacheSavings(
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 1000,
        cacheReadTokens: 2000,
      },
      model,
    );

    // Write savings: -0.00075, Read savings: 0.003 → total: 0.00225
    expect(result?.savingsAmount).toBeCloseTo(0.00225, 6);
    // Actual cache spend: 1000*3.75/1M + 2000*1.5/1M = 0.00675
    // costWithoutCaching: 0.00675 + 0.00225 = 0.009
    expect(result?.costWithoutCaching).toBeCloseTo(0.009, 6);
    // Savings percent: 0.00225 / 0.009 * 100 = 25%
    expect(result?.savingsPercent).toBeCloseTo(25, 1);
    expect(result?.totalCacheTokens).toBe(3000);
  });

  test("includes input/output token costs in total", () => {
    const result = calculateModelCacheSavings(
      {
        inputTokens: 10_000,
        outputTokens: 5_000,
        cacheWriteTokens: 0,
        cacheReadTokens: 1000,
      },
      model,
    );

    // inputCost: 10000 * 3.0 / 1M = 0.03
    // outputCost: 5000 * 15 / 1M = 0.075
    // actualCacheSpend: 1000 * 1.5 / 1M = 0.0015
    // modelTotalCost: 0.03 + 0.075 + 0.0015 = 0.1065
    // savingsAmount: 0.0015
    // costWithoutCaching: 0.1065 + 0.0015 = 0.108
    expect(result?.inputCost).toBeCloseTo(0.03, 6);
    expect(result?.outputCost).toBeCloseTo(0.075, 6);
    expect(result?.actualCacheSpend).toBeCloseTo(0.0015, 6);
    expect(result?.totalCost).toBeCloseTo(0.1065, 6);
    expect(result?.costWithoutCaching).toBeCloseTo(0.108, 6);
  });
});
