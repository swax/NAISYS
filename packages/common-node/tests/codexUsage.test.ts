import { afterEach, describe, expect, test, vi } from "vitest";

import { fetchCodexUsage } from "../src/codex/codexUsage.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("fetchCodexUsage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("fetches usage with bearer auth and normalizes usage windows", async () => {
    const now = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const fetchFn = vi.fn(async () =>
      jsonResponse({
        rate_limit: {
          limit_reached: false,
          primary_window: {
            limit_window_seconds: "7200",
            used_percent: 12.5,
            reset_at: "1700000300",
            reset_after_seconds: "300",
          },
          secondary_window: {
            used_percent: "98.25",
          },
        },
      }),
    );

    await expect(
      fetchCodexUsage({ accessToken: "access-token", fetchFn }),
    ).resolves.toEqual({
      checkedAt: now,
      limitReached: false,
      primaryWindow: {
        limitWindowSeconds: 7200,
        usedPercent: 12.5,
        resetAt: 1700000300,
        resetAfterSeconds: 300,
      },
      secondaryWindow: {
        usedPercent: 98.25,
      },
    });

    expect(fetchFn).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/wham/usage",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer access-token",
          Accept: "application/json",
        },
      },
    );
  });

  test("omits optional fields when the response shape is not usable", async () => {
    const now = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const fetchFn = vi.fn(async () =>
      jsonResponse({
        rate_limit: {
          limit_reached: "false",
          primary_window: {
            limit_window_seconds: "soon",
          },
          secondary_window: null,
        },
      }),
    );

    await expect(
      fetchCodexUsage({ accessToken: "access-token", fetchFn }),
    ).resolves.toEqual({ checkedAt: now });
  });

  test("formats OpenAI error responses", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        {
          error: "rate_limited",
          error_description: "try again later",
        },
        429,
      ),
    );

    await expect(
      fetchCodexUsage({ accessToken: "access-token", fetchFn }),
    ).rejects.toThrow(
      "OpenAI Codex usage check failed: rate_limited (try again later)",
    );
  });
});
