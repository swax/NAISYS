import { expect, test, describe } from "@jest/globals";
import { ulid } from "@naisys/database";
import {
  minUlidForTime,
  getUlidTimestamp,
  isUlidWithinWindow,
} from "../../utils/ulidTools.js";

describe("ulidTools", () => {
  describe("getUlidTimestamp", () => {
    test("extracts correct timestamp from a ULID", () => {
      const now = Date.now();
      const testUlid = ulid(now);
      const extracted = getUlidTimestamp(testUlid);

      expect(extracted).toBe(now);
    });

    test("extracts timestamp from ULIDs created at different times", () => {
      const time1 = 1704067200000; // 2024-01-01 00:00:00 UTC
      const time2 = 1735689600000; // 2025-01-01 00:00:00 UTC

      const ulid1 = ulid(time1);
      const ulid2 = ulid(time2);

      expect(getUlidTimestamp(ulid1)).toBe(time1);
      expect(getUlidTimestamp(ulid2)).toBe(time2);
    });
  });

  describe("minUlidForTime", () => {
    test("generates a 26-character ULID", () => {
      const date = new Date();
      const result = minUlidForTime(date);

      expect(result).toHaveLength(26);
    });

    test("generates ULID with correct timestamp", () => {
      const timestamp = 1704067200000; // 2024-01-01 00:00:00 UTC
      const date = new Date(timestamp);
      const result = minUlidForTime(date);

      // The generated ULID should decode to the same timestamp
      const extracted = getUlidTimestamp(result);
      expect(extracted).toBe(timestamp);
    });

    test("generates minimum ULID (all zeros in random part)", () => {
      const date = new Date();
      const result = minUlidForTime(date);

      // Last 16 characters should be all zeros
      expect(result.slice(-16)).toBe("0000000000000000");
    });

    test("generated ULID is lexicographically less than real ULIDs at same time", () => {
      const timestamp = Date.now();
      const minUlid = minUlidForTime(new Date(timestamp));
      const realUlid = ulid(timestamp);

      // minUlid should be <= realUlid since it has all zeros in random part
      expect(minUlid <= realUlid).toBe(true);
    });

    test("ULIDs for later times are lexicographically greater", () => {
      const time1 = new Date(1704067200000);
      const time2 = new Date(1704067200001); // 1ms later

      const ulid1 = minUlidForTime(time1);
      const ulid2 = minUlidForTime(time2);

      expect(ulid2 > ulid1).toBe(true);
    });
  });

  describe("isUlidWithinWindow", () => {
    test("returns true for ULID created just now", () => {
      const testUlid = ulid();
      const windowMs = 5 * 60 * 1000; // 5 minutes

      expect(isUlidWithinWindow(testUlid, windowMs)).toBe(true);
    });

    test("returns false for ULID created before window", () => {
      const oldTimestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago
      const testUlid = ulid(oldTimestamp);
      const windowMs = 5 * 60 * 1000; // 5 minute window

      expect(isUlidWithinWindow(testUlid, windowMs)).toBe(false);
    });

    test("returns true for ULID just inside window boundary", () => {
      const windowMs = 5 * 60 * 1000; // 5 minutes
      const justInsideTimestamp = Date.now() - (windowMs - 1000); // 1 second inside
      const testUlid = ulid(justInsideTimestamp);

      expect(isUlidWithinWindow(testUlid, windowMs)).toBe(true);
    });

    test("returns false for ULID just outside window boundary", () => {
      const windowMs = 5 * 60 * 1000; // 5 minutes
      const justOutsideTimestamp = Date.now() - (windowMs + 1000); // 1 second outside
      const testUlid = ulid(justOutsideTimestamp);

      expect(isUlidWithinWindow(testUlid, windowMs)).toBe(false);
    });

    test("works with different window sizes", () => {
      const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
      const testUlid = ulid(twoMinutesAgo);

      // 1 minute window - should be outside
      expect(isUlidWithinWindow(testUlid, 1 * 60 * 1000)).toBe(false);

      // 3 minute window - should be inside
      expect(isUlidWithinWindow(testUlid, 3 * 60 * 1000)).toBe(true);
    });
  });

  describe("integration: minUlidForTime for range queries", () => {
    test("can filter ULIDs by time range using string comparison", () => {
      // Simulate a time range query like in getTotalCosts
      const periodStart = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      const periodEnd = new Date();

      const minStart = minUlidForTime(periodStart);
      const minEnd = minUlidForTime(periodEnd);

      // ULID from 30 minutes ago should be in range
      const inRangeUlid = ulid(Date.now() - 30 * 60 * 1000);
      expect(inRangeUlid >= minStart && inRangeUlid < minEnd).toBe(true);

      // ULID from 2 hours ago should be out of range
      const outOfRangeUlid = ulid(Date.now() - 2 * 60 * 60 * 1000);
      expect(outOfRangeUlid >= minStart && outOfRangeUlid < minEnd).toBe(false);
    });
  });
});
