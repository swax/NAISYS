import { describe, expect, test } from "vitest";

import {
  formatOpenAiError,
  normalizeFiniteNumber,
  normalizePositiveMilliseconds,
  parseJsonObject,
  trimNonEmpty,
} from "../src/codex/codexHttp.js";

describe("codex HTTP helpers", () => {
  test("trims non-empty strings and rejects blank or non-string values", () => {
    expect(trimNonEmpty("  token  ")).toBe("token");
    expect(trimNonEmpty("   ")).toBeUndefined();
    expect(trimNonEmpty(123)).toBeUndefined();
  });

  test("parses JSON objects and returns null for invalid or primitive JSON", () => {
    expect(parseJsonObject('{"ok":true}')).toEqual({ ok: true });
    expect(parseJsonObject("not-json")).toBeNull();
    expect(parseJsonObject("null")).toBeNull();
  });

  test("normalizes positive second values into milliseconds", () => {
    expect(normalizePositiveMilliseconds(1.75)).toBe(1750);
    expect(normalizePositiveMilliseconds(" 15 ")).toBe(15000);
    expect(normalizePositiveMilliseconds(0)).toBeUndefined();
    expect(normalizePositiveMilliseconds("-1")).toBeUndefined();
    expect(normalizePositiveMilliseconds("1.5")).toBeUndefined();
  });

  test("normalizes finite numbers from numeric values and strings", () => {
    expect(normalizeFiniteNumber(42)).toBe(42);
    expect(normalizeFiniteNumber(" 12.5 ")).toBe(12.5);
    expect(normalizeFiniteNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(normalizeFiniteNumber("NaN")).toBeUndefined();
  });

  test("formats OpenAI error bodies by preferred specificity", () => {
    expect(
      formatOpenAiError({
        prefix: "Request failed",
        status: 400,
        bodyText:
          '{"error":"invalid_grant","error_description":"token expired"}',
      }),
    ).toBe("Request failed: invalid_grant (token expired)");

    expect(
      formatOpenAiError({
        prefix: "Request failed",
        status: 401,
        bodyText: '{"error":"unauthorized"}',
      }),
    ).toBe("Request failed: unauthorized");

    expect(
      formatOpenAiError({
        prefix: "Request failed",
        status: 500,
        bodyText: " server\nerror ",
      }),
    ).toBe("Request failed: HTTP 500 server error");

    expect(
      formatOpenAiError({
        prefix: "Request failed",
        status: 503,
        bodyText: "   ",
      }),
    ).toBe("Request failed: HTTP 503");
  });
});
