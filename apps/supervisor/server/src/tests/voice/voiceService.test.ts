import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getVariableCachedValue: vi.fn(),
  hubFindUser: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  sumUserCostsInPeriod: vi.fn(),
}));

vi.mock("@naisys/hub-database", () => ({
  sumUserCostsInPeriod: mocks.sumUserCostsInPeriod,
}));

vi.mock("../../database/hubDb.js", () => ({
  hubDb: {
    users: {
      findUnique: mocks.hubFindUser,
    },
  },
}));

vi.mock("../../logger.js", () => ({
  getLogger: () => ({
    error: mocks.loggerError,
    warn: mocks.loggerWarn,
  }),
}));

vi.mock("../../services/infra/variableService.js", () => ({
  getVariableCachedValue: mocks.getVariableCachedValue,
}));

import {
  checkVoiceBudget,
  computeVoiceCost,
  getVoiceAvailability,
  getVoiceModel,
  mintVoiceToken,
} from "../../services/voice/voiceService.js";

const from = { username: "admin", title: "Admin" };
const target = { username: "worker", title: "Worker" };

function mockVariable(name: string): string | undefined {
  if (name === "OPENAI_API_KEY") return "sk-test";
  if (name === "VOICE_AGENT_MODEL") return "gpt-realtime";
  return undefined;
}

describe("voiceService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.getVariableCachedValue.mockImplementation(mockVariable);
    mocks.hubFindUser.mockResolvedValue({
      id: 1,
      config: JSON.stringify({
        spendLimitDollars: 25,
        spendLimitHours: 24,
      }),
      user_notifications: {
        spend_limit_reset_at: new Date("2026-05-01T12:00:00.000Z"),
      },
    });
    mocks.sumUserCostsInPeriod.mockResolvedValue(12.5);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("uses the default realtime model when no override is configured", async () => {
    mocks.getVariableCachedValue.mockResolvedValue(undefined);

    await expect(getVoiceModel()).resolves.toBe("gpt-realtime-2");
    expect(mocks.getVariableCachedValue).toHaveBeenCalledWith(
      "VOICE_AGENT_MODEL",
    );
  });

  test("trims and uses the VOICE_AGENT_MODEL override", async () => {
    mocks.getVariableCachedValue.mockResolvedValue(" gpt-realtime ");

    await expect(getVoiceModel()).resolves.toBe("gpt-realtime");
  });

  test("voice availability requires OPENAI_API_KEY to be set", async () => {
    mocks.getVariableCachedValue.mockImplementation((name: string) =>
      name === "OPENAI_API_KEY" ? "" : undefined,
    );

    await expect(getVoiceAvailability()).resolves.toEqual({
      available: false,
      reason:
        "Voice is unavailable: set the OPENAI_API_KEY variable to enable it.",
    });
  });

  test("voice availability is true with API key and known default model", async () => {
    mocks.getVariableCachedValue.mockImplementation((name: string) =>
      name === "OPENAI_API_KEY" ? "sk-test" : undefined,
    );

    await expect(getVoiceAvailability()).resolves.toEqual({
      available: true,
    });
  });

  test("voice availability rejects an unknown VOICE_AGENT_MODEL override", async () => {
    mocks.getVariableCachedValue.mockImplementation((name: string) => {
      if (name === "OPENAI_API_KEY") return "sk-test";
      if (name === "VOICE_AGENT_MODEL") return "gpt-not-a-model";
      return undefined;
    });

    await expect(getVoiceAvailability()).resolves.toEqual({
      available: false,
      reason:
        'Voice is unavailable: VOICE_AGENT_MODEL is set to "gpt-not-a-model", which is not a known realtime model.',
    });
  });

  test("fails token minting when OPENAI_API_KEY is not configured", async () => {
    mocks.getVariableCachedValue.mockResolvedValue(undefined);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(
      mintVoiceToken({
        from,
        target,
        userUuid: "operator-uuid",
        mode: "console",
      }),
    ).rejects.toThrow(
      "Voice agent unavailable: the OPENAI_API_KEY variable is not set.",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  test("mints a locked realtime session with the expected OpenAI request", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          value: "ephemeral-secret",
          expires_at: 1_893_456_000,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetch);

    const result = await mintVoiceToken({
      from,
      target,
      userUuid: "operator-uuid",
      mode: "console",
    });

    expect(result).toEqual({
      clientSecret: "ephemeral-secret",
      expiresAt: "2030-01-01T00:00:00.000Z",
      model: "gpt-realtime",
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/realtime/client_secrets",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
          "Content-Type": "application/json",
          "OpenAI-Safety-Identifier": createHash("sha256")
            .update("operator-uuid")
            .digest("hex")
            .slice(0, 32),
        }),
      }),
    );

    const [, init] = fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.session).toMatchObject({
      type: "realtime",
      model: "gpt-realtime",
      audio: { output: { voice: "marin" } },
      tool_choice: "auto",
    });
    expect(body.session.instructions).toContain(
      "You are the real-time voice interface",
    );
    expect(body.session.instructions).toContain('"Admin" (admin)');
    expect(body.session.instructions).toContain('"Worker" (worker)');
    expect(body.session.instructions).toContain(
      "You have three tools for dispatching to your work loop",
    );
    expect(
      body.session.tools.map((tool: { name: string }) => tool.name),
    ).toEqual(["talk_to_agent", "run_debug_command", "run_command"]);
  });

  test("chat mode only exposes the talk_to_agent tool and adjusts instructions", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          value: "ephemeral-secret",
          expires_at: 1_893_456_000,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetch);

    await mintVoiceToken({
      from,
      target,
      userUuid: "operator-uuid",
      mode: "chat",
    });

    const [, init] = fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(
      body.session.tools.map((tool: { name: string }) => tool.name),
    ).toEqual(["talk_to_agent"]);
    expect(body.session.instructions).toContain(
      "You have one tool for dispatching to your work loop",
    );
    expect(body.session.instructions).toContain(
      "You cannot run shell commands from this voice session",
    );
  });

  test("accepts the older nested client_secret response shape", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          client_secret: {
            value: "nested-secret",
            expires_at: 1_893_456_000,
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(
      mintVoiceToken({
        from,
        target,
        userUuid: "operator-uuid",
        mode: "console",
      }),
    ).resolves.toEqual({
      clientSecret: "nested-secret",
      expiresAt: "2030-01-01T00:00:00.000Z",
      model: "gpt-realtime",
    });
  });

  test("uses a one-minute fallback expiry when OpenAI omits expires_at", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ value: "ephemeral-secret" }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(
      mintVoiceToken({
        from,
        target,
        userUuid: "operator-uuid",
        mode: "console",
      }),
    ).resolves.toMatchObject({
      clientSecret: "ephemeral-secret",
      expiresAt: "2026-05-01T00:01:00.000Z",
    });
  });

  test("logs and throws when OpenAI rejects the mint request", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("bad key", { status: 401 }));
    vi.stubGlobal("fetch", fetch);

    await expect(
      mintVoiceToken({
        from,
        target,
        userUuid: "operator-uuid",
        mode: "console",
      }),
    ).rejects.toThrow("Failed to start voice session (OpenAI returned 401).");
    expect(mocks.loggerError).toHaveBeenCalledWith(
      "[Voice] client_secrets mint failed (401): bad key",
    );
  });

  test("logs and throws when OpenAI returns no token value", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(
      mintVoiceToken({
        from,
        target,
        userUuid: "operator-uuid",
        mode: "console",
      }),
    ).rejects.toThrow("Failed to start voice session (no token returned).");
    expect(mocks.loggerError).toHaveBeenCalledWith(
      "[Voice] client_secrets response missing token value: {}",
    );
  });

  test("computes voice cost and flattened token columns from realtime pricing", () => {
    expect(
      computeVoiceCost("gpt-realtime-2", {
        inputTextTokens: 1_000_000,
        inputAudioTokens: 1_000_000,
        inputImageTokens: 0,
        inputCachedTextTokens: 1_000_000,
        inputCachedAudioTokens: 1_000_000,
        inputCachedImageTokens: 0,
        outputTextTokens: 1_000_000,
        outputAudioTokens: 1_000_000,
      }),
    ).toEqual({
      cost: 124.8,
      inputTokens: 2_000_000,
      outputTokens: 2_000_000,
      cacheReadTokens: 2_000_000,
    });
  });

  test("folds image tokens into input/cache_read columns at the model's image rates", () => {
    expect(
      computeVoiceCost("gpt-realtime-2", {
        inputTextTokens: 0,
        inputAudioTokens: 0,
        inputImageTokens: 1_000_000,
        inputCachedTextTokens: 0,
        inputCachedAudioTokens: 0,
        inputCachedImageTokens: 1_000_000,
        outputTextTokens: 0,
        outputAudioTokens: 0,
      }),
    ).toEqual({
      // 1M image @ $5 + 1M cached image @ $0.5
      cost: 5.5,
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
    });
  });

  test("returns null budget when the admin agent does not exist or has no cap", async () => {
    mocks.hubFindUser.mockResolvedValueOnce(null);
    await expect(checkVoiceBudget()).resolves.toBeNull();

    mocks.hubFindUser.mockResolvedValueOnce({
      id: 1,
      config: JSON.stringify({ title: "Admin" }),
      user_notifications: null,
    });
    await expect(checkVoiceBudget()).resolves.toBeNull();

    expect(mocks.sumUserCostsInPeriod).not.toHaveBeenCalled();
  });

  test("checks admin spend against the configured voice budget window", async () => {
    const resetAt = new Date("2026-05-01T12:00:00.000Z");

    await expect(checkVoiceBudget()).resolves.toEqual({
      spendLimit: 25,
      periodCost: 12.5,
      overBudget: false,
      reason: undefined,
    });
    expect(mocks.hubFindUser).toHaveBeenCalledWith({
      where: { username: "admin" },
      select: {
        id: true,
        config: true,
        user_notifications: { select: { spend_limit_reset_at: true } },
      },
    });
    expect(mocks.sumUserCostsInPeriod).toHaveBeenCalledWith(expect.anything(), {
      userId: 1,
      spendLimitHours: 24,
      spendLimitResetAt: resetAt,
    });
  });

  test("reports over-budget status with a user-facing reason", async () => {
    mocks.sumUserCostsInPeriod.mockResolvedValue(25);

    await expect(checkVoiceBudget()).resolves.toEqual({
      spendLimit: 25,
      periodCost: 25,
      overBudget: true,
      reason:
        "Voice budget exhausted: $25.00 of $25.00 cap used. The cap resets on the next period boundary.",
    });
  });
});
