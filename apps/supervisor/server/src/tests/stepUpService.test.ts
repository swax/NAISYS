import type { FastifyReply, FastifyRequest } from "fastify";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userHasPasskey: vi.fn(),
  getExpectedOrigin: vi.fn(),
  rpIdFromHost: vi.fn(),
  verifyAuthentication: vi.fn(),
}));

vi.mock("@naisys/supervisor-database", () => ({
  userHasPasskey: mocks.userHasPasskey,
}));

vi.mock("../services/passkeyService.js", () => ({
  getExpectedOrigin: mocks.getExpectedOrigin,
  rpIdFromHost: mocks.rpIdFromHost,
  verifyAuthentication: mocks.verifyAuthentication,
}));

import {
  requireStepUp,
  STEPUP_CHALLENGE_COOKIE,
} from "../services/stepUpService.js";

function makeRequest(
  overrides: Partial<FastifyRequest> = {},
): FastifyRequest {
  return {
    supervisorUser: {
      id: 7,
      username: "admin",
      uuid: "admin-uuid",
      permissions: ["supervisor_admin"],
    },
    cookies: {},
    headers: { host: "supervisor.example:3301" },
    protocol: "https",
    ...overrides,
  } as FastifyRequest;
}

function makeReply(): FastifyReply & {
  clearCookie: ReturnType<typeof vi.fn>;
} {
  return {
    clearCookie: vi.fn(),
  } as unknown as FastifyReply & { clearCookie: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userHasPasskey.mockResolvedValue(true);
  mocks.rpIdFromHost.mockReturnValue("supervisor.example");
  mocks.getExpectedOrigin.mockReturnValue("https://supervisor.example");
  mocks.verifyAuthentication.mockResolvedValue({ verified: true, userId: 7 });
});

describe("requireStepUp", () => {
  test("rejects unauthenticated callers", async () => {
    const reply = makeReply();
    const result = await requireStepUp(
      makeRequest({ supervisorUser: undefined }),
      reply,
      {},
    );

    expect(result).toEqual({
      ok: false,
      status: 401,
      message: "Authentication required",
    });
    expect(mocks.userHasPasskey).not.toHaveBeenCalled();
    expect(reply.clearCookie).not.toHaveBeenCalled();
  });

  test("bypasses step-up when the caller has no registered passkey", async () => {
    mocks.userHasPasskey.mockResolvedValue(false);

    const result = await requireStepUp(makeRequest(), makeReply(), {});

    expect(result).toEqual({ ok: true });
    expect(mocks.userHasPasskey).toHaveBeenCalledWith(7);
    expect(mocks.verifyAuthentication).not.toHaveBeenCalled();
  });

  test("requires an assertion when the caller has passkeys", async () => {
    const result = await requireStepUp(makeRequest(), makeReply(), {});

    expect(result).toEqual({
      ok: false,
      status: 412,
      message: "Re-verify your passkey to continue.",
    });
    expect(mocks.verifyAuthentication).not.toHaveBeenCalled();
  });

  test("rejects an assertion when the challenge cookie is missing", async () => {
    const result = await requireStepUp(makeRequest(), makeReply(), {
      stepUpAssertion: { id: "credential-id" },
    });

    expect(result).toEqual({
      ok: false,
      status: 412,
      message: "Step-up session expired — re-verify your passkey.",
    });
    expect(mocks.verifyAuthentication).not.toHaveBeenCalled();
  });

  test("verifies the assertion against the stored challenge and clears the step-up cookie", async () => {
    const assertion = { id: "credential-id" };
    const reply = makeReply();
    const result = await requireStepUp(
      makeRequest({
        cookies: { [STEPUP_CHALLENGE_COOKIE]: "challenge" },
      }),
      reply,
      { stepUpAssertion: assertion },
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.rpIdFromHost).toHaveBeenCalledWith("supervisor.example:3301");
    expect(mocks.getExpectedOrigin).toHaveBeenCalled();
    expect(mocks.verifyAuthentication).toHaveBeenCalledWith({
      response: assertion,
      expectedChallenge: "challenge",
      expectedOrigin: "https://supervisor.example",
      expectedRPID: "supervisor.example",
    });
    expect(reply.clearCookie).toHaveBeenCalledWith(
      STEPUP_CHALLENGE_COOKIE,
      { path: "/supervisor/api/" },
    );
  });

  test("rejects assertions verified for a different user", async () => {
    mocks.verifyAuthentication.mockResolvedValue({
      verified: true,
      userId: 99,
    });

    const result = await requireStepUp(
      makeRequest({
        cookies: { [STEPUP_CHALLENGE_COOKIE]: "challenge" },
      }),
      makeReply(),
      { stepUpAssertion: { id: "credential-id" } },
    );

    expect(result).toEqual({
      ok: false,
      status: 401,
      message: "Step-up verification failed",
    });
  });
});
