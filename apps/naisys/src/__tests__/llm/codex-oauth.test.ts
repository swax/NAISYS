import {
  CODEX_REFRESH_TOKEN_VAR,
  CODEX_RESPONSES_BASE_URL,
  LlmApiType,
} from "@naisys/common";
import {
  createCodexAccessTokenCache,
  createCodexAccessTokenProvider,
  refreshCodexToken,
  resolveCodexAccessTokenExpiry,
} from "@naisys/common-node";
import { afterEach, describe, expect, test, vi } from "vitest";

import { sendWithOpenAiOauth } from "../../llm/vendors/openai-oauth.js";
import type { VendorDeps } from "../../llm/vendors/vendorTypes.js";

function makeGlobalConfig(variables: Record<string, string> = {}) {
  return {
    globalConfig: () => ({ variableMap: variables }),
    setVariableValue: vi.fn(),
  } as unknown as VendorDeps["globalConfig"];
}

function makeVendorDeps(overrides: {
  getCodexAccessToken: VendorDeps["getCodexAccessToken"];
  recordTokens?: ReturnType<typeof vi.fn>;
  tools?: VendorDeps["tools"];
  useToolsForLlmConsoleResponses?: boolean;
}): VendorDeps {
  return {
    globalConfig: makeGlobalConfig(),
    modelService: {
      getLlmModel: () => ({
        key: "gpt5oauth",
        label: "GPT 5.4 (OpenAI Codex OAuth)",
        versionName: "gpt-5.4",
        baseUrl: CODEX_RESPONSES_BASE_URL,
        apiType: LlmApiType.OpenAIOAuth,
        apiKeyVar: CODEX_REFRESH_TOKEN_VAR,
        maxTokens: 400_000,
        inputCost: 0,
        outputCost: 0,
        supportsToolUse: true,
        reasoningLevel: "medium",
      }),
    },
    costTracker: { recordTokens: overrides.recordTokens ?? vi.fn() },
    tools: overrides.tools ?? {},
    useToolsForLlmConsoleResponses:
      overrides.useToolsForLlmConsoleResponses ?? false,
    getCodexAccessToken: overrides.getCodexAccessToken,
  } as unknown as VendorDeps;
}

const openAiMock = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("openai", () => ({
  default: vi.fn(function MockOpenAI() {
    return {
      responses: {
        create: openAiMock.create,
      },
    };
  }),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function makeJwt(payload: Record<string, unknown>): string {
  return [
    "header",
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}

describe("OpenAI Codex access-token provider", () => {
  afterEach(() => {
    vi.useRealTimers();
    openAiMock.create.mockReset();
  });

  test("returns undefined when no refresh token is configured", async () => {
    const fetchFn = vi.fn();
    const saveRefreshToken = vi.fn();
    const provider = createCodexAccessTokenProvider({
      getRefreshToken: () => undefined,
      saveRefreshToken,
      fetchFn,
    });

    await expect(provider.getAccessToken()).resolves.toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(saveRefreshToken).not.toHaveBeenCalled();
  });

  test("refreshes against OpenAI and caches the resulting access token", async () => {
    const now = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const fetchFn = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
        }),
      ),
    );
    const saveRefreshToken = vi.fn(() => Promise.resolve(true));
    const provider = createCodexAccessTokenProvider({
      getRefreshToken: () => "old-refresh",
      saveRefreshToken,
      fetchFn,
    });

    await expect(provider.getAccessToken()).resolves.toEqual({
      accessToken: "new-access",
      expiresAt: now + 3_600_000,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(saveRefreshToken).toHaveBeenCalledWith("new-refresh", "old-refresh");

    // Second call returns the cached value without another fetch.
    await expect(provider.getAccessToken()).resolves.toEqual({
      accessToken: "new-access",
      expiresAt: now + 3_600_000,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test("skips saveRefreshToken when the refresh token did not rotate", async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          access_token: "new-access",
          expires_in: 3600,
        }),
      ),
    );
    const saveRefreshToken = vi.fn();
    const provider = createCodexAccessTokenProvider({
      getRefreshToken: () => "same-refresh",
      saveRefreshToken,
      fetchFn,
    });

    await expect(provider.getAccessToken()).resolves.toMatchObject({
      accessToken: "new-access",
    });
    expect(saveRefreshToken).not.toHaveBeenCalled();
  });

  test("single-flights concurrent refresh requests", async () => {
    // Two parallel callers must share one POST — otherwise rotation invalidates one lineage.
    let resolveFetch: (value: Response) => void = () => {};
    const fetchFn = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const saveRefreshToken = vi.fn(() => Promise.resolve(true));
    const provider = createCodexAccessTokenProvider({
      getRefreshToken: () => "refresh-token",
      saveRefreshToken,
      fetchFn,
    });

    const a = provider.getAccessToken();
    const b = provider.getAccessToken();
    // Drain microtasks so the in-flight refresh reaches its fetch call.
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    resolveFetch(
      jsonResponse({
        access_token: "access-token",
        refresh_token: "rotated-refresh",
        expires_in: 3600,
      }),
    );

    await expect(a).resolves.toMatchObject({ accessToken: "access-token" });
    await expect(b).resolves.toMatchObject({ accessToken: "access-token" });
    expect(saveRefreshToken).toHaveBeenCalledTimes(1);
  });

  test("invalidate() forces the next call to refresh again", async () => {
    let counter = 0;
    const fetchFn = vi.fn(() => {
      counter += 1;
      return Promise.resolve(
        jsonResponse({
          access_token: `access-${counter}`,
          expires_in: 3600,
        }),
      );
    });
    const provider = createCodexAccessTokenProvider({
      getRefreshToken: () => "refresh-token",
      saveRefreshToken: vi.fn(() => Promise.resolve(true)),
      fetchFn,
    });

    await expect(provider.getAccessToken()).resolves.toMatchObject({
      accessToken: "access-1",
    });
    provider.invalidate();
    await expect(provider.getAccessToken()).resolves.toMatchObject({
      accessToken: "access-2",
    });
  });

  test("cache returns a cached entry until skew window, then refreshes", async () => {
    const now = 1_700_000_000_000;
    let currentTime = now;
    const resolveFresh = vi
      .fn()
      .mockResolvedValueOnce({
        accessToken: "first",
        expiresAt: now + 10 * 60_000, // 10 min
      })
      .mockResolvedValueOnce({
        accessToken: "second",
        expiresAt: now + 30 * 60_000,
      });
    const cache = createCodexAccessTokenCache({
      resolveFresh,
      now: () => currentTime,
    });

    await expect(cache.getAccessToken()).resolves.toMatchObject({
      accessToken: "first",
    });
    // Still inside the cache window.
    currentTime = now + 4 * 60_000;
    await expect(cache.getAccessToken()).resolves.toMatchObject({
      accessToken: "first",
    });
    expect(resolveFresh).toHaveBeenCalledTimes(1);

    // Inside the 5-minute skew window — should refresh.
    currentTime = now + 6 * 60_000;
    await expect(cache.getAccessToken()).resolves.toMatchObject({
      accessToken: "second",
    });
    expect(resolveFresh).toHaveBeenCalledTimes(2);
  });

  test("cache holds a failure for the cooldown window, then retries", async () => {
    const now = 1_700_000_000_000;
    let currentTime = now;
    const resolveFresh = vi
      .fn()
      .mockRejectedValueOnce(new Error("auth down"))
      .mockResolvedValueOnce({
        accessToken: "recovered",
        expiresAt: now + 10 * 60_000,
      });
    const cache = createCodexAccessTokenCache({
      resolveFresh,
      failureCooldownMs: 30_000,
      now: () => currentTime,
    });

    await expect(cache.getAccessToken()).rejects.toThrow("auth down");
    // Within the cooldown, the cached error is rethrown without re-invoking resolveFresh.
    currentTime = now + 5_000;
    await expect(cache.getAccessToken()).rejects.toThrow("auth down");
    expect(resolveFresh).toHaveBeenCalledTimes(1);

    // Past the cooldown — the next call retries.
    currentTime = now + 31_000;
    await expect(cache.getAccessToken()).resolves.toMatchObject({
      accessToken: "recovered",
    });
    expect(resolveFresh).toHaveBeenCalledTimes(2);
  });

  test("invalidate clears the failure cache so callers can retry immediately", async () => {
    const resolveFresh = vi
      .fn()
      .mockRejectedValueOnce(new Error("auth down"))
      .mockResolvedValueOnce({
        accessToken: "recovered",
        expiresAt: Date.now() + 10 * 60_000,
      });
    const cache = createCodexAccessTokenCache({
      resolveFresh,
      failureCooldownMs: 30_000,
    });

    await expect(cache.getAccessToken()).rejects.toThrow("auth down");
    cache.invalidate();
    await expect(cache.getAccessToken()).resolves.toMatchObject({
      accessToken: "recovered",
    });
    expect(resolveFresh).toHaveBeenCalledTimes(2);
  });

  test("preserves a rotated refresh token in memory when persistence fails", async () => {
    // OpenAI rotates old→new and returns access-1. saveRefreshToken throws,
    // so the provider can't persist "new". The next attempt must use the
    // in-memory "new" — re-reading the stale persisted "old" would burn the
    // lineage at OpenAI (refresh_token_reused).
    const persistedRefresh = "old";
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "access-1",
          refresh_token: "new",
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "access-2",
          refresh_token: "newer",
          expires_in: 3600,
        }),
      );
    const saveRefreshToken = vi
      .fn()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(true);
    const provider = createCodexAccessTokenProvider({
      getRefreshToken: () => persistedRefresh,
      saveRefreshToken,
      fetchFn,
    });

    await expect(provider.getAccessToken()).rejects.toThrow("db down");
    await expect(provider.getAccessToken()).resolves.toMatchObject({
      accessToken: "access-2",
    });

    const secondCallBody = fetchFn.mock.calls[1]?.[1]?.body as URLSearchParams;
    expect(secondCallBody.get("refresh_token")).toBe("new");
  });

  test("reset drops the in-memory refresh override so re-auth takes effect", async () => {
    let persistedRefresh = "old";
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "access-1",
          refresh_token: "rotated",
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "access-2",
          refresh_token: "rotated-2",
          expires_in: 3600,
        }),
      );
    const provider = createCodexAccessTokenProvider({
      getRefreshToken: () => persistedRefresh,
      saveRefreshToken: vi.fn(() => Promise.resolve(true)),
      fetchFn,
    });

    await provider.getAccessToken();

    // Operator re-auths via supervisor: persisted value replaced, reset fires.
    persistedRefresh = "fresh-from-reauth";
    provider.reset();
    await provider.getAccessToken();

    const secondCallBody = fetchFn.mock.calls[1]?.[1]?.body as URLSearchParams;
    expect(secondCallBody.get("refresh_token")).toBe("fresh-from-reauth");
  });

  test("reset during an in-flight refresh discards the stale result instead of clobbering the new account", async () => {
    // OpenAI takes time to respond. While we wait, an operator re-auths via
    // the supervisor (replacing the persisted refresh token with a new
    // account's), then VARIABLES_CHANGED triggers provider.reset(). The
    // in-flight OAuth call must NOT write inMemoryRefresh, must NOT call
    // saveRefreshToken (which would overwrite the new account's row), and
    // must NOT populate cached with old-account tokens.
    let resolveFirstFetch: (value: Response) => void = () => {};
    let persistedRefresh = "old-account-refresh";
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirstFetch = resolve;
          }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "new-account-access",
          refresh_token: "new-account-rotated",
          expires_in: 3600,
        }),
      );
    const saveRefreshToken = vi.fn(() => Promise.resolve(true));
    const provider = createCodexAccessTokenProvider({
      getRefreshToken: () => persistedRefresh,
      saveRefreshToken,
      fetchFn,
    });

    const inFlight = provider.getAccessToken();
    // Let the first fetch begin.
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Operator re-auths: persisted row is replaced and reset fires.
    persistedRefresh = "new-account-refresh";
    provider.reset();

    // OpenAI finally answers the first call — with the OLD account's tokens.
    resolveFirstFetch(
      jsonResponse({
        access_token: "old-account-access",
        refresh_token: "old-account-rotated",
        expires_in: 3600,
      }),
    );

    // The discarded in-flight resolves to undefined; nothing about the old
    // account leaks into our state.
    await expect(inFlight).resolves.toBeUndefined();
    expect(saveRefreshToken).not.toHaveBeenCalled();

    // The next call uses the new account's persisted refresh.
    const result = await provider.getAccessToken();
    expect(result?.accessToken).toBe("new-account-access");
    const secondCallBody = fetchFn.mock.calls[1]?.[1]?.body as URLSearchParams;
    expect(secondCallBody.get("refresh_token")).toBe("new-account-refresh");
  });

  test("discards rotation when saveRefreshToken signals an external change (CAS failed)", async () => {
    // Simulates the supervisor's re-auth writing a new account's refresh
    // token while we were mid-rotation. CAS in saveRefreshToken returns
    // false; the provider must NOT keep the old-account rotated value in
    // memory or in DB.
    let persistedAtStart = "A";
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "old-account-access",
          refresh_token: "old-account-rotated",
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "new-account-access",
          refresh_token: "new-account-rotated",
          expires_in: 3600,
        }),
      );
    const saveRefreshToken = vi
      .fn<
        (newToken: string, priorToken: string | undefined) => Promise<boolean>
      >()
      .mockResolvedValueOnce(false) // first attempt: CAS fails
      .mockResolvedValueOnce(true);
    const provider = createCodexAccessTokenProvider({
      getRefreshToken: () => persistedAtStart,
      saveRefreshToken,
      fetchFn,
    });

    await expect(provider.getAccessToken()).resolves.toBeUndefined();
    // External writer (re-auth) replaced the persisted row; next call must
    // pick that up cleanly rather than replaying the discarded rotation.
    persistedAtStart = "B";
    const result = await provider.getAccessToken();
    expect(result?.accessToken).toBe("new-account-access");
    const secondCallBody = fetchFn.mock.calls[1]?.[1]?.body as URLSearchParams;
    expect(secondCallBody.get("refresh_token")).toBe("B");
    expect(saveRefreshToken).toHaveBeenLastCalledWith(
      "new-account-rotated",
      "B",
    );
  });

  test("detects an external persisted-value change between calls and drops stale in-memory", async () => {
    // Save succeeds normally on the first rotation, but before the second
    // rotation begins the supervisor's re-auth replaces the persisted value.
    // The provider should detect via expectedPersistedRefresh divergence and
    // use the new persisted value (not the stale in-memory rotation).
    let persisted = "A";
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "access-A'",
          refresh_token: "A-rotated",
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "access-B'",
          refresh_token: "B-rotated",
          expires_in: 3600,
        }),
      );
    const saveRefreshToken = vi.fn((newToken: string) => {
      persisted = newToken;
      return Promise.resolve(true);
    });
    const provider = createCodexAccessTokenProvider({
      getRefreshToken: () => persisted,
      saveRefreshToken,
      fetchFn,
    });

    await provider.getAccessToken();
    expect(persisted).toBe("A-rotated");

    // External re-auth replaces the persisted value. The provider has no
    // VARIABLES_CHANGED signal here — it must notice via the divergence check
    // on the next read. invalidate() just forces past the access-token cache
    // so we actually re-enter resolveFresh.
    persisted = "B-from-reauth";
    provider.invalidate();
    await provider.getAccessToken();

    const secondCallBody = fetchFn.mock.calls[1]?.[1]?.body as URLSearchParams;
    expect(secondCallBody.get("refresh_token")).toBe("B-from-reauth");
  });

  test("treats external clear of persisted token as dead lineage and aborts rotation", async () => {
    // Operator clears CODEX_REFRESH_TOKEN via the supervisor. Even
    // though we hold a valid in-memory refresh from a prior rotation, we
    // must not call OAuth and silently recreate the row the operator just
    // removed.
    let persisted: string | undefined = "configured";
    const fetchFn = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        access_token: "access-1",
        refresh_token: "rotated",
        expires_in: 3600,
      }),
    );
    const saveRefreshToken = vi.fn(() => Promise.resolve(true));
    const provider = createCodexAccessTokenProvider({
      getRefreshToken: () => persisted,
      saveRefreshToken,
      fetchFn,
    });

    await provider.getAccessToken();
    expect(saveRefreshToken).toHaveBeenCalledTimes(1);

    // Operator clears the variable. invalidate() forces past the cache.
    persisted = undefined;
    provider.invalidate();
    await expect(provider.getAccessToken()).resolves.toBeUndefined();

    // No second OAuth call: the dead in-memory lineage was not exercised.
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(saveRefreshToken).toHaveBeenCalledTimes(1);
  });

  test("saves when OpenAI doesn't rotate but DB still holds the pre-failure value", async () => {
    // After a transient save failure leaves DB="old" while in-memory="new",
    // a later OAuth response that doesn't rotate (no refresh_token in body)
    // would leave the lineage permanently inconsistent if we only saved
    // on rotation. Save trigger compares against `persisted`, not the
    // refresh token we sent, so this non-rotating response still triggers
    // a save to bring DB up to date.
    const persistedRefresh = "old";
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "access-1",
          refresh_token: "new",
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(
        // No refresh_token — OpenAI doesn't always rotate on every call.
        jsonResponse({
          access_token: "access-2",
          expires_in: 3600,
        }),
      );
    const saveRefreshToken = vi
      .fn<
        (newToken: string, priorToken: string | undefined) => Promise<boolean>
      >()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(true);
    const provider = createCodexAccessTokenProvider({
      getRefreshToken: () => persistedRefresh,
      saveRefreshToken,
      fetchFn,
    });

    await expect(provider.getAccessToken()).rejects.toThrow("db down");
    // DB still holds "old", in-memory holds "new" (from failed save).

    await provider.getAccessToken();
    // Second OAuth call used in-memory "new", got back "new" (no rotation).
    // refreshed.refresh ("new") !== persisted ("old") → must save.
    expect(saveRefreshToken).toHaveBeenCalledTimes(2);
    expect(saveRefreshToken).toHaveBeenLastCalledWith("new", "old");
  });

  test("invalidate keeps the in-memory rotated refresh — force-refresh after a save failure must not replay the stale persisted token", async () => {
    // OpenAI rotates old→new (saveRefreshToken throws), then a client force-
    // refreshes (invalidate). The provider must call OpenAI with "new", not
    // the stale persisted "old" that OpenAI has already invalidated.
    const persistedRefresh = "old";
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "access-1",
          refresh_token: "new",
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "access-2",
          refresh_token: "newer",
          expires_in: 3600,
        }),
      );
    const saveRefreshToken = vi
      .fn()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(true);
    const provider = createCodexAccessTokenProvider({
      getRefreshToken: () => persistedRefresh,
      saveRefreshToken,
      fetchFn,
    });

    await expect(provider.getAccessToken()).rejects.toThrow("db down");

    // Client observed a 401 and called the force-refresh path.
    provider.invalidate();
    await provider.getAccessToken();

    const secondCallBody = fetchFn.mock.calls[1]?.[1]?.body as URLSearchParams;
    expect(secondCallBody.get("refresh_token")).toBe("new");
  });

  test("surfaces OpenAI refresh errors with the provider message", async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          {
            error: "invalid_grant",
            error_description: "Refresh token expired",
          },
          400,
        ),
      ),
    );

    await expect(refreshCodexToken("bad-refresh", fetchFn)).rejects.toThrow(
      "OpenAI OAuth refresh failed: invalid_grant (Refresh token expired)",
    );
  });

  test("resolves expiry from access token JWT payloads", () => {
    const exp = 1_700_000_000;
    expect(resolveCodexAccessTokenExpiry(makeJwt({ exp }))).toBe(exp * 1000);
  });
});

describe("sendWithOpenAiOauth vendor", () => {
  afterEach(() => {
    openAiMock.create.mockReset();
  });

  test("sends Codex OAuth requests as streamed store=false responses", async () => {
    async function* streamResponse() {
      await Promise.resolve();
      yield {
        type: "response.output_text.delta",
        delta: "OK",
      };
      yield {
        type: "response.completed",
        response: {
          output: [],
          output_text: "",
          usage: {
            input_tokens: 3,
            output_tokens: 1,
            input_tokens_details: { cached_tokens: 1 },
          },
        },
      };
    }

    openAiMock.create.mockResolvedValue(streamResponse());
    const recordTokens = vi.fn();
    const getCodexAccessToken = vi.fn().mockResolvedValue("access-token");
    const deps = makeVendorDeps({ getCodexAccessToken, recordTokens });

    await expect(
      sendWithOpenAiOauth(
        deps,
        "gpt5oauth",
        "system",
        [{ role: "user", content: "hello" }],
        "lynx",
      ),
    ).resolves.toEqual({
      responses: ["OK"],
      messagesTokenCount: 3,
    });

    expect(openAiMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.4",
        store: false,
        stream: true,
        reasoning: { effort: "medium" },
      }),
      expect.any(Object),
    );
    expect(recordTokens).toHaveBeenCalledWith("lynx", "gpt5oauth", 2, 1, 0, 1);
    expect(getCodexAccessToken).toHaveBeenCalledTimes(1);
  });

  test("extracts streamed Codex OAuth console tool calls", async () => {
    async function* streamResponse() {
      await Promise.resolve();
      yield {
        type: "response.output_item.done",
        item: {
          type: "function_call",
          name: "submit_commands",
          arguments: '{"comment":"2+2 = 4.","commandList":[]}',
        },
      };
      yield {
        type: "response.completed",
        response: {
          output: [],
          output_text: "",
          usage: {
            input_tokens: 20,
            output_tokens: 10,
            input_tokens_details: { cached_tokens: 0 },
          },
        },
      };
    }

    openAiMock.create.mockResolvedValue(streamResponse());
    const getCodexAccessToken = vi.fn().mockResolvedValue("access-token");
    const deps = makeVendorDeps({
      getCodexAccessToken,
      useToolsForLlmConsoleResponses: true,
      tools: {
        consoleToolOpenAI: {
          function: {
            name: "submit_commands",
            description: "Return commands",
            parameters: {
              type: "object",
              properties: {
                comment: { type: "string" },
                commandList: { type: "array", items: { type: "string" } },
              },
              required: ["comment", "commandList"],
            },
          },
        },
        getCommandsFromOpenAiToolUse: (toolCalls: unknown) => {
          const call = Array.isArray(toolCalls) ? toolCalls[0] : undefined;
          const args = JSON.parse(call.function.arguments);
          return [`ns-comment "${args.comment}"`];
        },
      } as unknown as VendorDeps["tools"],
    });

    await expect(
      sendWithOpenAiOauth(
        deps,
        "gpt5oauth",
        "system",
        [{ role: "user", content: "hello" }],
        "console",
      ),
    ).resolves.toEqual({
      responses: ['ns-comment "2+2 = 4."'],
      messagesTokenCount: 20,
    });
  });

  test("retries once after a 401 with a force-refreshed token", async () => {
    async function* successStream() {
      await Promise.resolve();
      yield {
        type: "response.completed",
        response: {
          output: [],
          output_text: "retried",
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            input_tokens_details: { cached_tokens: 0 },
          },
        },
      };
    }

    const unauthorized = Object.assign(new Error("Unauthorized"), {
      status: 401,
    });
    openAiMock.create
      .mockRejectedValueOnce(unauthorized)
      .mockResolvedValueOnce(successStream());

    const getCodexAccessToken = vi
      .fn()
      .mockResolvedValueOnce("stale-token")
      .mockResolvedValueOnce("fresh-token");
    const deps = makeVendorDeps({ getCodexAccessToken });

    await expect(
      sendWithOpenAiOauth(
        deps,
        "gpt5oauth",
        "system",
        [{ role: "user", content: "hi" }],
        "lynx",
      ),
    ).resolves.toEqual({
      responses: ["retried"],
      messagesTokenCount: 1,
    });

    expect(openAiMock.create).toHaveBeenCalledTimes(2);
    expect(getCodexAccessToken).toHaveBeenCalledTimes(2);
    expect(getCodexAccessToken).toHaveBeenLastCalledWith(true);
  });

  test("does not retry on non-401 errors", async () => {
    const serverError = Object.assign(new Error("server error"), {
      status: 500,
    });
    openAiMock.create.mockRejectedValueOnce(serverError);

    const getCodexAccessToken = vi.fn().mockResolvedValue("access-token");
    const deps = makeVendorDeps({ getCodexAccessToken });

    await expect(
      sendWithOpenAiOauth(
        deps,
        "gpt5oauth",
        "system",
        [{ role: "user", content: "hi" }],
        "lynx",
      ),
    ).rejects.toThrow("server error");

    expect(openAiMock.create).toHaveBeenCalledTimes(1);
    expect(getCodexAccessToken).toHaveBeenCalledTimes(1);
  });
});
