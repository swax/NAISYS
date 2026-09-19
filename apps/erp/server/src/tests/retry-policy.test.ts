import { FailOperationRunSchema } from "@naisys/erp-shared";
import { describe, expect, test } from "vitest";

import {
  eligibleRetryWhere,
  retryWaitReason,
} from "../services/operations/retry-policy.js";

describe("external retry eligibility", () => {
  const now = new Date("2026-09-19T10:00:00Z");
  test("reopens exactly at the boundary, not before", () => {
    expect(retryWaitReason(new Date(now.getTime() + 1), now)).toContain(
      "deferred",
    );
    expect(retryWaitReason(now, now)).toBeNull();
    expect(retryWaitReason(null, now)).toBeNull();
  });
  test("dispatch filters include ordinary and elapsed retries", () => {
    expect(eligibleRetryWhere(now)).toEqual({
      OR: [{ retryNotBefore: null }, { retryNotBefore: { lte: now } }],
    });
  });
  test("accepts timezone-aware times and rejects ambiguous or extra fields", () => {
    expect(
      FailOperationRunSchema.parse({
        note: "quota",
        retryNotBefore: "2026-09-20T10:00:00-07:00",
      }).retryNotBefore,
    ).toBeDefined();
    expect(() =>
      FailOperationRunSchema.parse({ retryNotBefore: "tomorrow" }),
    ).toThrow();
    expect(() => FailOperationRunSchema.parse({ force: true })).toThrow();
  });
});
