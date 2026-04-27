import cookie from "@fastify/cookie";
import { SESSION_COOKIE_NAME } from "@naisys/common-node";
import type { AuthUser } from "@naisys/supervisor-shared";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authCacheInvalidate: vi.fn(),
  createSessionForUser: vi.fn(),
  deleteSession: vi.fn(),
  userHasPasskey: vi.fn(),
  consumeTokenAndStoreVerifiedCredential: vi.fn(),
  generatePasskeyAuthenticationOptions: vi.fn(),
  generatePasskeyRegistrationOptions: vi.fn(),
  generatePasskeyStepUpOptions: vi.fn(),
  getExpectedOrigin: vi.fn(),
  getUserForRegistrationToken: vi.fn(),
  rpIdFromHost: vi.fn(),
  storeVerifiedCredentialForUser: vi.fn(),
  verifyAuthentication: vi.fn(),
  verifyRegistration: vi.fn(),
  requireStepUp: vi.fn(),
  getUserById: vi.fn(),
  getUserPermissions: vi.fn(),
}));

vi.mock("@naisys/supervisor-database", () => ({
  createSessionForUser: mocks.createSessionForUser,
  deleteSession: mocks.deleteSession,
  userHasPasskey: mocks.userHasPasskey,
}));

vi.mock("../auth-middleware.js", () => ({
  authCache: {
    invalidate: mocks.authCacheInvalidate,
  },
}));

vi.mock("../services/passkeyService.js", () => ({
  consumeTokenAndStoreVerifiedCredential:
    mocks.consumeTokenAndStoreVerifiedCredential,
  generatePasskeyAuthenticationOptions:
    mocks.generatePasskeyAuthenticationOptions,
  generatePasskeyRegistrationOptions: mocks.generatePasskeyRegistrationOptions,
  generatePasskeyStepUpOptions: mocks.generatePasskeyStepUpOptions,
  getExpectedOrigin: mocks.getExpectedOrigin,
  getUserForRegistrationToken: mocks.getUserForRegistrationToken,
  rpIdFromHost: mocks.rpIdFromHost,
  storeVerifiedCredentialForUser: mocks.storeVerifiedCredentialForUser,
  verifyAuthentication: mocks.verifyAuthentication,
  verifyRegistration: mocks.verifyRegistration,
}));

vi.mock("../services/stepUpService.js", () => ({
  STEPUP_CHALLENGE_COOKIE: "naisys_passkey_stepup_chal",
  requireStepUp: mocks.requireStepUp,
}));

vi.mock("../services/userService.js", () => ({
  getUserById: mocks.getUserById,
  getUserPermissions: mocks.getUserPermissions,
}));

import authRoutes from "../routes/auth.js";

const authChallengeCookie = "naisys_passkey_auth_chal";
const regChallengeCookie = "naisys_passkey_reg_chal";

const adminUser: AuthUser = {
  id: 7,
  username: "admin",
  permissions: ["supervisor_admin"],
};

async function buildApp(supervisorUser?: AuthUser): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(cookie);
  app.addHook("onRequest", (request, _reply, done) => {
    if (supervisorUser) {
      request.supervisorUser = {
        id: supervisorUser.id,
        username: supervisorUser.username,
        uuid: `${supervisorUser.username}-uuid`,
        permissions: supervisorUser.permissions as never,
      };
    }
    done();
  });
  await app.register(authRoutes, { prefix: "/supervisor/api" });
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpIdFromHost.mockReturnValue("supervisor.example");
  mocks.getExpectedOrigin.mockReturnValue("https://supervisor.example");
  mocks.generatePasskeyAuthenticationOptions.mockResolvedValue({
    challenge: "auth-challenge",
    allowCredentials: [],
    userVerification: "required",
  });
  mocks.generatePasskeyRegistrationOptions.mockResolvedValue({
    challenge: "reg-challenge",
    user: { name: "target" },
  });
  mocks.generatePasskeyStepUpOptions.mockResolvedValue({
    challenge: "step-up-challenge",
  });
  mocks.verifyAuthentication.mockResolvedValue({
    verified: true,
    userId: 42,
    username: "target",
  });
  mocks.verifyRegistration.mockResolvedValue({
    credentialId: "credential-id",
    publicKey: "public-key",
    counter: 0,
    transports: ["internal"],
  });
  mocks.consumeTokenAndStoreVerifiedCredential.mockResolvedValue({
    userId: 42,
    username: "target",
  });
  mocks.createSessionForUser.mockResolvedValue({
    token: "session-token",
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    user: {
      userId: 42,
      username: "target",
      uuid: "target-uuid",
    },
  });
  mocks.getUserById.mockResolvedValue({
    id: 42,
    username: "target",
  });
  mocks.getUserPermissions.mockResolvedValue(["manage_agents"]);
  mocks.getUserForRegistrationToken.mockResolvedValue({
    userId: 42,
    username: "target",
    uuid: "target-uuid",
  });
  mocks.userHasPasskey.mockResolvedValue(true);
  mocks.requireStepUp.mockResolvedValue({ ok: true });
});

describe("passkey auth routes", () => {
  test("login-options sets a scoped challenge cookie", async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/auth/passkey/login-options",
        headers: { host: "supervisor.example:3301" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        options: {
          challenge: "auth-challenge",
          allowCredentials: [],
          userVerification: "required",
        },
      });
      expect(mocks.rpIdFromHost).toHaveBeenCalledWith(
        "supervisor.example:3301",
      );
      expect(mocks.generatePasskeyAuthenticationOptions).toHaveBeenCalledWith(
        "supervisor.example",
      );
      expect(response.headers["set-cookie"]).toContain(
        `${authChallengeCookie}=auth-challenge`,
      );
      expect(response.headers["set-cookie"]).toContain(
        "Path=/supervisor/api/auth/passkey/",
      );
    } finally {
      await app.close();
    }
  });

  test("login-verify rejects missing challenge cookies before verification", async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/auth/passkey/login-verify",
        payload: { response: { id: "credential-id" } },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        success: false,
        message: "Login session expired — please retry.",
      });
      expect(mocks.verifyAuthentication).not.toHaveBeenCalled();
      expect(mocks.createSessionForUser).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("login-verify creates a session and returns the authenticated user", async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/auth/passkey/login-verify",
        headers: {
          host: "supervisor.example:3301",
          origin: "https://supervisor.example",
          cookie: `${authChallengeCookie}=auth-challenge`,
        },
        payload: { response: { id: "credential-id" } },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        id: 42,
        username: "target",
        permissions: ["manage_agents"],
      });
      expect(mocks.verifyAuthentication).toHaveBeenCalledWith({
        response: { id: "credential-id" },
        expectedChallenge: "auth-challenge",
        expectedOrigin: "https://supervisor.example",
        expectedRPID: "supervisor.example",
      });
      expect(mocks.createSessionForUser).toHaveBeenCalledWith(42);
      const cookies = response.headers["set-cookie"];
      expect(cookies).toEqual(
        expect.arrayContaining([
          expect.stringContaining(`${SESSION_COOKIE_NAME}=session-token`),
          expect.stringContaining(`${authChallengeCookie}=`),
        ]),
      );
    } finally {
      await app.close();
    }
  });

  test("register-options rejects an invite token for a different signed-in user", async () => {
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/auth/passkey/register-options",
        payload: { token: "target-token" },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        success: false,
        message:
          "Sign out of the current session before opening a registration link for a different user.",
      });
      expect(mocks.generatePasskeyRegistrationOptions).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("register-options allows token-based registration and sets a registration challenge cookie", async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/auth/passkey/register-options",
        headers: { host: "supervisor.example:3301" },
        payload: { token: "target-token" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        username: "target",
        options: {
          challenge: "reg-challenge",
          user: { name: "target" },
        },
      });
      expect(mocks.generatePasskeyRegistrationOptions).toHaveBeenCalledWith({
        userId: 42,
        userUuid: "target-uuid",
        username: "target",
        rpId: "supervisor.example",
      });
      expect(response.headers["set-cookie"]).toContain(
        `${regChallengeCookie}=reg-challenge`,
      );
      // Token path is its own authorization proof — never gated by step-up.
      expect(mocks.requireStepUp).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("authenticated register-options refuses to bootstrap a first passkey without a token", async () => {
    mocks.getUserForRegistrationToken.mockResolvedValue(null);
    mocks.userHasPasskey.mockResolvedValue(false);
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/auth/passkey/register-options",
        headers: { host: "supervisor.example:3301" },
        payload: {},
      });

      expect(response.statusCode).toBe(412);
      expect(response.json()).toEqual({
        success: false,
        message: "Use a registration link to enroll your first passkey.",
      });
      expect(mocks.userHasPasskey).toHaveBeenCalledWith(7);
      expect(mocks.requireStepUp).not.toHaveBeenCalled();
      expect(mocks.generatePasskeyRegistrationOptions).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("authenticated register-options requires step-up before issuing options", async () => {
    mocks.getUserForRegistrationToken.mockResolvedValue(null);
    mocks.userHasPasskey.mockResolvedValue(true);
    mocks.requireStepUp.mockResolvedValue({
      ok: false,
      status: 412,
      message: "Re-verify your passkey to continue.",
    });
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/auth/passkey/register-options",
        headers: { host: "supervisor.example:3301" },
        payload: {},
      });

      expect(response.statusCode).toBe(412);
      expect(response.json()).toEqual({
        success: false,
        message: "Re-verify your passkey to continue.",
      });
      expect(mocks.requireStepUp).toHaveBeenCalled();
      expect(mocks.generatePasskeyRegistrationOptions).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("authenticated register-options issues options once step-up passes", async () => {
    mocks.getUserForRegistrationToken.mockResolvedValue(null);
    mocks.userHasPasskey.mockResolvedValue(true);
    mocks.requireStepUp.mockResolvedValue({ ok: true });
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/auth/passkey/register-options",
        headers: { host: "supervisor.example:3301" },
        payload: { stepUpAssertion: { id: "assertion-id" } },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.requireStepUp).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { stepUpAssertion: { id: "assertion-id" } },
      );
      expect(mocks.generatePasskeyRegistrationOptions).toHaveBeenCalledWith({
        userId: 7,
        userUuid: "admin-uuid",
        username: "admin",
        rpId: "supervisor.example",
      });
      expect(response.headers["set-cookie"]).toContain(
        `${regChallengeCookie}=reg-challenge`,
      );
    } finally {
      await app.close();
    }
  });

  test("register-verify verifies before atomically consuming the registration token", async () => {
    const callOrder: string[] = [];
    mocks.verifyRegistration.mockImplementation(() => {
      callOrder.push("verify");
      return Promise.resolve({
        credentialId: "credential-id",
        publicKey: "public-key",
        counter: 0,
        transports: ["internal"],
      });
    });
    mocks.consumeTokenAndStoreVerifiedCredential.mockImplementation(() => {
      callOrder.push("consume");
      return Promise.resolve({ userId: 42, username: "target" });
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/auth/passkey/register-verify",
        headers: {
          host: "supervisor.example:3301",
          origin: "https://supervisor.example",
          cookie: `${regChallengeCookie}=reg-challenge`,
        },
        payload: {
          token: "target-token",
          response: { id: "credential-id" },
          deviceLabel: "Work laptop",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        success: true,
        user: {
          id: 42,
          username: "target",
          permissions: ["manage_agents"],
        },
      });
      expect(callOrder).toEqual(["verify", "consume"]);
      expect(mocks.consumeTokenAndStoreVerifiedCredential).toHaveBeenCalledWith(
        {
          token: "target-token",
          verified: {
            credentialId: "credential-id",
            publicKey: "public-key",
            counter: 0,
            transports: ["internal"],
          },
          deviceLabel: "Work laptop",
        },
      );
      expect(mocks.createSessionForUser).toHaveBeenCalledWith(42);
      expect(response.headers["set-cookie"]).toEqual(
        expect.arrayContaining([
          expect.stringContaining(`${SESSION_COOKIE_NAME}=session-token`),
          expect.stringContaining(`${regChallengeCookie}=`),
        ]),
      );
    } finally {
      await app.close();
    }
  });

  test("authenticated register-verify stores an additional passkey without rotating the session", async () => {
    mocks.getUserForRegistrationToken.mockResolvedValue(null);
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/auth/passkey/register-verify",
        headers: {
          host: "supervisor.example:3301",
          cookie: `${regChallengeCookie}=reg-challenge`,
        },
        payload: {
          response: { id: "credential-id" },
          deviceLabel: "Phone",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
      expect(mocks.storeVerifiedCredentialForUser).toHaveBeenCalledWith({
        userId: 7,
        verified: {
          credentialId: "credential-id",
          publicKey: "public-key",
          counter: 0,
          transports: ["internal"],
        },
        deviceLabel: "Phone",
      });
      expect(
        mocks.consumeTokenAndStoreVerifiedCredential,
      ).not.toHaveBeenCalled();
      expect(mocks.createSessionForUser).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("logout invalidates the cookie session and clears the browser cookie", async () => {
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/auth/logout",
        headers: { cookie: `${SESSION_COOKIE_NAME}=session-token` },
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        success: true,
        message: "Logged out successfully",
      });
      expect(mocks.authCacheInvalidate).toHaveBeenCalledWith(
        expect.stringMatching(/^cookie:/),
      );
      expect(mocks.deleteSession).toHaveBeenCalledWith(expect.any(String));
      expect(response.headers["set-cookie"]).toContain(
        `${SESSION_COOKIE_NAME}=`,
      );
      expect(response.headers["set-cookie"]).toContain("Path=/");
    } finally {
      await app.close();
    }
  });
});
