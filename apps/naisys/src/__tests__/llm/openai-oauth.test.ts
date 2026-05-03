import {
  LlmApiType,
  OPENAI_CODEX_ACCESS_TOKEN_VAR,
  OPENAI_CODEX_EXPIRES_AT_VAR,
  OPENAI_CODEX_REFRESH_TOKEN_VAR,
  OPENAI_CODEX_RESPONSES_BASE_URL,
} from "@naisys/common";
import { afterEach, describe, expect, test, vi } from "vitest";

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

import {
  refreshOpenAiCodexToken,
  resolveOpenAiCodexAccessTokenExpiry,
  resolveOpenAiOauthAccessToken,
  sendWithOpenAiOauth,
} from "../../llm/vendors/openai-oauth.js";
import type { VendorDeps } from "../../llm/vendors/vendorTypes.js";

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

describe("OpenAI OAuth vendor auth", () => {
  afterEach(() => {
    vi.useRealTimers();
    openAiMock.create.mockReset();
  });

  test("uses an unexpired access token without refreshing", async () => {
    const now = 1_700_000_000_000;
    const variables: Record<string, string> = {
      [OPENAI_CODEX_ACCESS_TOKEN_VAR]: "access-token",
      [OPENAI_CODEX_REFRESH_TOKEN_VAR]: "refresh-token",
      [OPENAI_CODEX_EXPIRES_AT_VAR]: String(now + 10 * 60_000),
    };
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse({})));

    await expect(
      resolveOpenAiOauthAccessToken({
        variables,
        fetchFn,
        now,
      }),
    ).resolves.toBe("access-token");

    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("refreshes an expired token and persists the replacement values", async () => {
    const now = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const variables: Record<string, string> = {
      [OPENAI_CODEX_ACCESS_TOKEN_VAR]: "old-access",
      [OPENAI_CODEX_REFRESH_TOKEN_VAR]: "old-refresh",
      [OPENAI_CODEX_EXPIRES_AT_VAR]: String(now - 1),
    };
    const updates: Record<string, string> = {};
    const fetchFn = vi.fn((_input, init) => {
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeInstanceOf(URLSearchParams);
      const body = init?.body as URLSearchParams;
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("old-refresh");
      return Promise.resolve(
        jsonResponse({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
        }),
      );
    });

    await expect(
      resolveOpenAiOauthAccessToken({
        variables,
        updateVariable: (key, value) => {
          updates[key] = value;
        },
        fetchFn,
        now,
      }),
    ).resolves.toBe("new-access");

    expect(variables[OPENAI_CODEX_ACCESS_TOKEN_VAR]).toBe("new-access");
    expect(variables[OPENAI_CODEX_REFRESH_TOKEN_VAR]).toBe("new-refresh");
    expect(variables[OPENAI_CODEX_EXPIRES_AT_VAR]).toBe(
      String(now + 3_600_000),
    );
    expect(updates).toEqual(variables);
  });

  test("can refresh when only a refresh token is configured", async () => {
    const variables: Record<string, string> = {
      [OPENAI_CODEX_REFRESH_TOKEN_VAR]: "refresh-token",
    };
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          access_token: "new-access",
          expires_in: "3600",
        }),
      ),
    );

    await expect(
      resolveOpenAiOauthAccessToken({
        variables,
        fetchFn,
      }),
    ).resolves.toBe("new-access");

    expect(variables[OPENAI_CODEX_REFRESH_TOKEN_VAR]).toBe("refresh-token");
    expect(variables[OPENAI_CODEX_ACCESS_TOKEN_VAR]).toBe("new-access");
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

    await expect(
      refreshOpenAiCodexToken("bad-refresh", fetchFn),
    ).rejects.toThrow(
      "OpenAI OAuth refresh failed: invalid_grant (Refresh token expired)",
    );
  });

  test("resolves expiry from access token JWT payloads", () => {
    const exp = 1_700_000_000;
    expect(resolveOpenAiCodexAccessTokenExpiry(makeJwt({ exp }))).toBe(
      exp * 1000,
    );
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
    const variables: Record<string, string> = {
      [OPENAI_CODEX_ACCESS_TOKEN_VAR]: "access-token",
      [OPENAI_CODEX_REFRESH_TOKEN_VAR]: "refresh-token",
      [OPENAI_CODEX_EXPIRES_AT_VAR]: String(Date.now() + 3_600_000),
    };
    const deps = {
      globalConfig: {
        globalConfig: () => ({ variableMap: variables }),
        setVariableValue: (key: string, value: string) => {
          variables[key] = value;
        },
      },
      modelService: {
        getLlmModel: () => ({
          key: "gpt5oauth",
          label: "GPT 5.4 (OpenAI Codex OAuth)",
          versionName: "gpt-5.4",
          baseUrl: OPENAI_CODEX_RESPONSES_BASE_URL,
          apiType: LlmApiType.OpenAIOAuth,
          apiKeyVar: OPENAI_CODEX_ACCESS_TOKEN_VAR,
          maxTokens: 400_000,
          inputCost: 0,
          outputCost: 0,
          reasoningLevel: "medium",
        }),
      },
      costTracker: { recordTokens },
      tools: {},
      useToolsForLlmConsoleResponses: false,
    } as unknown as VendorDeps;

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
    const variables: Record<string, string> = {
      [OPENAI_CODEX_ACCESS_TOKEN_VAR]: "access-token",
      [OPENAI_CODEX_REFRESH_TOKEN_VAR]: "refresh-token",
      [OPENAI_CODEX_EXPIRES_AT_VAR]: String(Date.now() + 3_600_000),
    };
    const deps = {
      globalConfig: {
        globalConfig: () => ({ variableMap: variables }),
        setVariableValue: (key: string, value: string) => {
          variables[key] = value;
        },
      },
      modelService: {
        getLlmModel: () => ({
          key: "gpt5oauth",
          label: "GPT 5.4 (OpenAI Codex OAuth)",
          versionName: "gpt-5.4",
          baseUrl: OPENAI_CODEX_RESPONSES_BASE_URL,
          apiType: LlmApiType.OpenAIOAuth,
          apiKeyVar: OPENAI_CODEX_ACCESS_TOKEN_VAR,
          maxTokens: 400_000,
          inputCost: 0,
          outputCost: 0,
          reasoningLevel: "medium",
        }),
      },
      costTracker: { recordTokens: vi.fn() },
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
      },
      useToolsForLlmConsoleResponses: true,
    } as unknown as VendorDeps;

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
});
