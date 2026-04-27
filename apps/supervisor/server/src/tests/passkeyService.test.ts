import { afterEach, describe, expect, test, vi } from "vitest";

const ENV_KEYS = [
  "SUPERVISOR_WEBAUTHN_RP_ID",
  "SUPERVISOR_WEBAUTHN_ORIGIN",
] as const;

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

async function loadPasskeyService(env: Partial<Record<string, string>> = {}) {
  vi.resetModules();
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
  return import("../services/passkeyService.js");
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  vi.resetModules();
});

describe("passkey relying-party helpers", () => {
  test("derive RP ID, origin, and registration URL from the request host", async () => {
    const { buildRegistrationUrl, originFromRequest, rpIdFromHost } =
      await loadPasskeyService();

    expect(rpIdFromHost("supervisor.local:3301")).toBe("supervisor.local");
    expect(rpIdFromHost(undefined)).toBe("localhost");
    expect(rpIdFromHost(":3301")).toBe("localhost");

    expect(
      originFromRequest({
        protocol: "https",
        hostHeader: "supervisor.local:3301",
      }),
    ).toBe("https://supervisor.local:3301");

    expect(
      buildRegistrationUrl({
        protocol: "https",
        hostHeader: "supervisor.local:3301",
        token: "a b+c?",
      }),
    ).toBe(
      "https://supervisor.local:3301/supervisor/register?token=a%20b%2Bc%3F",
    );
  });

  test("honor configured RP ID and origin overrides", async () => {
    const {
      buildRegistrationUrl,
      configuredExpectedOrigin,
      originFromRequest,
      rpIdFromHost,
    } = await loadPasskeyService({
      SUPERVISOR_WEBAUTHN_RP_ID: "supervisor.example.com",
      SUPERVISOR_WEBAUTHN_ORIGIN:
        "https://supervisor.example.com, http://localhost:3301",
    });

    expect(rpIdFromHost("attacker.example:4444")).toBe(
      "supervisor.example.com",
    );
    expect(
      originFromRequest({
        protocol: "http",
        hostHeader: "attacker.example:4444",
      }),
    ).toBe("https://supervisor.example.com");
    expect(configuredExpectedOrigin()).toEqual([
      "https://supervisor.example.com",
      "http://localhost:3301",
    ]);
    expect(
      buildRegistrationUrl({
        protocol: "http",
        hostHeader: "attacker.example:4444",
        token: "invite-token",
      }),
    ).toBe(
      "https://supervisor.example.com/supervisor/register?token=invite-token",
    );
  });

  test("expected origin prefers the browser Origin header when no override is configured", async () => {
    const { getExpectedOrigin } = await loadPasskeyService();

    const origin = getExpectedOrigin({
      headers: {
        origin: "https://browser.example",
        host: "fallback.example:3301",
      },
      protocol: "http",
    } as never);

    expect(origin).toBe("https://browser.example");
  });

  test("expected origin falls back to protocol and host when Origin is absent", async () => {
    const { getExpectedOrigin } = await loadPasskeyService();

    const origin = getExpectedOrigin({
      headers: { host: "fallback.example:3301" },
      protocol: "https",
    } as never);

    expect(origin).toBe("https://fallback.example:3301");
  });
});
