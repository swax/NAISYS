import { afterEach, describe, expect, test, vi } from "vitest";

import { extractBearerToken } from "../src/auth/bearerToken.js";
import { generatePersistentUserApiKey } from "../src/auth/persistentApiKey.js";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "../src/auth/sessionCookie.js";
import { hashToken } from "../src/auth/hashToken.js";

const originalNodeEnv = process.env.NODE_ENV;

function restoreNodeEnv() {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
}

describe("auth helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    restoreNodeEnv();
  });

  test("extracts bearer tokens only from Bearer auth headers", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
    expect(extractBearerToken("Basic abc123")).toBeUndefined();
    expect(extractBearerToken(undefined)).toBeUndefined();
  });

  test("hashes tokens with SHA-256", () => {
    expect(hashToken("secret")).toBe(
      "2bb80d537b1da3e38bd30361aa855686bde0eacd7162" + "fef6a25fe97bf527a25b",
    );
  });

  test("builds session cookie options from expiry and environment", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T00:00:00Z"));
    process.env.NODE_ENV = "production";

    expect(SESSION_COOKIE_NAME).toBe("naisys_session");
    expect(sessionCookieOptions(new Date("2026-05-18T00:05:30Z"))).toEqual({
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: 330,
    });

    process.env.NODE_ENV = "test";
    expect(sessionCookieOptions(new Date("2026-05-18T00:00:30Z")).secure).toBe(
      false,
    );
  });

  test("generates and persists only the hash of a persistent user API key", async () => {
    const updateApiKeyHash = vi.fn();

    const apiKey = await generatePersistentUserApiKey(123, {
      userExists: async (userId) => userId === 123,
      updateApiKeyHash,
    });

    expect(apiKey).toMatch(/^[a-f0-9]{64}$/);
    expect(updateApiKeyHash).toHaveBeenCalledWith(123, hashToken(apiKey));
  });

  test("throws before persisting when the user is missing", async () => {
    const updateApiKeyHash = vi.fn();

    await expect(
      generatePersistentUserApiKey(123, {
        userExists: async () => false,
        updateApiKeyHash,
      }),
    ).rejects.toThrow("User not found");
    expect(updateApiKeyHash).not.toHaveBeenCalled();
  });
});
