import cookie from "@fastify/cookie";
import { hashToken, SESSION_COOKIE_NAME } from "@naisys/common-node";
import type { AuthUser } from "@naisys/supervisor-shared";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authCacheClear: vi.fn(),
  deleteAllPasskeyCredentialsForUser: vi.fn(),
  deleteAllSessionsForUser: vi.fn(),
  deletePasskeyCredential: vi.fn(),
  listPasskeyCredentialsForUser: vi.fn(),
  renamePasskeyDeviceLabel: vi.fn(),
  userHasPasskey: vi.fn(),
  issueRegistrationLink: vi.fn(),
  requireStepUp: vi.fn(),
  createPasskeyUser: vi.fn(),
  getUserByUsername: vi.fn(),
  getUserByUsernameWithPermissions: vi.fn(),
  listUsers: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  rotateUserApiKey: vi.fn(),
  grantPermission: vi.fn(),
  revokePermission: vi.fn(),
  getUserApiKey: vi.fn(),
  createUserForAgent: vi.fn(),
  getUserByUuid: vi.fn(),
  getHubAgentById: vi.fn(),
  getHubAgentByUuid: vi.fn(),
}));

vi.mock("@naisys/supervisor-database", () => ({
  deleteAllPasskeyCredentialsForUser: mocks.deleteAllPasskeyCredentialsForUser,
  deleteAllSessionsForUser: mocks.deleteAllSessionsForUser,
  deletePasskeyCredential: mocks.deletePasskeyCredential,
  listPasskeyCredentialsForUser: mocks.listPasskeyCredentialsForUser,
  renamePasskeyDeviceLabel: mocks.renamePasskeyDeviceLabel,
  userHasPasskey: mocks.userHasPasskey,
}));

vi.mock("../auth-middleware.js", () => ({
  authCache: {
    clear: mocks.authCacheClear,
  },
  requirePermission: (permission: string) => {
    // eslint-disable-next-line @typescript-eslint/require-await
    return async (request: any, reply: any) => {
      if (!request.supervisorUser) {
        reply.status(401).send({
          success: false,
          message: "Authentication required",
        });
        return;
      }
      const permissions = request.supervisorUser.permissions ?? [];
      if (
        !permissions.includes(permission) &&
        !permissions.includes("supervisor_admin")
      ) {
        reply.status(403).send({
          success: false,
          message: `Permission '${permission}' required`,
        });
      }
    };
  },
}));

vi.mock("../services/agentService.js", () => ({
  getHubAgentById: mocks.getHubAgentById,
  getHubAgentByUuid: mocks.getHubAgentByUuid,
}));

vi.mock("../services/passkeyService.js", () => ({
  issueRegistrationLink: mocks.issueRegistrationLink,
}));

vi.mock("../services/stepUpService.js", () => ({
  requireStepUp: mocks.requireStepUp,
}));

vi.mock("../services/userService.js", () => ({
  createPasskeyUser: mocks.createPasskeyUser,
  createUserForAgent: mocks.createUserForAgent,
  deleteUser: mocks.deleteUser,
  getUserApiKey: mocks.getUserApiKey,
  getUserByUsername: mocks.getUserByUsername,
  getUserByUsernameWithPermissions: mocks.getUserByUsernameWithPermissions,
  getUserByUuid: mocks.getUserByUuid,
  grantPermission: mocks.grantPermission,
  listUsers: mocks.listUsers,
  revokePermission: mocks.revokePermission,
  rotateUserApiKey: mocks.rotateUserApiKey,
  updateUser: mocks.updateUser,
}));

import userRoutes from "../routes/users.js";

const adminUser: AuthUser = {
  id: 7,
  username: "admin",
  permissions: ["supervisor_admin"],
};

const limitedUser: AuthUser = {
  id: 8,
  username: "limited",
  permissions: [],
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
  await app.register(userRoutes, { prefix: "/supervisor/api/users" });
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireStepUp.mockResolvedValue({ ok: true });
  mocks.createPasskeyUser.mockResolvedValue({
    id: 23,
    username: "new-user",
  });
  mocks.issueRegistrationLink.mockResolvedValue({
    url: "https://supervisor.example/supervisor/register?token=invite-token",
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    token: "invite-token",
  });
  mocks.getUserByUsername.mockResolvedValue({
    id: 7,
    username: "admin",
    uuid: "admin-uuid",
    isAgent: false,
  });
  mocks.listPasskeyCredentialsForUser.mockResolvedValue([
    {
      id: 10,
      credentialId: "not-returned-to-client",
      deviceLabel: "Work laptop",
      createdAt: new Date("2026-04-26T10:00:00.000Z"),
      lastUsedAt: new Date("2026-04-26T11:00:00.000Z"),
    },
  ]);
  mocks.deletePasskeyCredential.mockResolvedValue(true);
  mocks.renamePasskeyDeviceLabel.mockResolvedValue(true);
  mocks.userHasPasskey.mockResolvedValue(false);
  mocks.deleteAllSessionsForUser.mockResolvedValue(undefined);
  mocks.deleteAllPasskeyCredentialsForUser.mockResolvedValue(2);
});

describe("passkey user routes", () => {
  test("creates a user by issuing a one-time registration link instead of accepting a password", async () => {
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/users",
        headers: { host: "supervisor.example" },
        payload: { username: "new-user" },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({
        success: true,
        message: "User created",
        id: 23,
        username: "new-user",
        registrationUrl:
          "https://supervisor.example/supervisor/register?token=invite-token",
        registrationExpiresAt: "2030-01-01T00:00:00.000Z",
      });
      expect(mocks.requireStepUp).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { username: "new-user" },
      );
      expect(mocks.createPasskeyUser).toHaveBeenCalledWith({
        username: "new-user",
      });
      expect(mocks.issueRegistrationLink).toHaveBeenCalledWith({
        userId: 23,
        protocol: "http",
        hostHeader: "supervisor.example",
      });
    } finally {
      await app.close();
    }
  });

  test("does not create a user when step-up is required but missing", async () => {
    mocks.requireStepUp.mockResolvedValue({
      ok: false,
      status: 412,
      message: "Re-verify your passkey to continue.",
    });
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/users",
        payload: { username: "new-user" },
      });

      expect(response.statusCode).toBe(412);
      expect(response.json()).toEqual({
        success: false,
        message: "Re-verify your passkey to continue.",
      });
      expect(mocks.createPasskeyUser).not.toHaveBeenCalled();
      expect(mocks.issueRegistrationLink).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("lists passkeys without exposing credential IDs or public keys", async () => {
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "GET",
        url: "/supervisor/api/users/admin/passkeys",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        credentials: [
          {
            id: 10,
            deviceLabel: "Work laptop",
            createdAt: "2026-04-26T10:00:00.000Z",
            lastUsedAt: "2026-04-26T11:00:00.000Z",
          },
        ],
      });
      expect(response.body).not.toContain("not-returned-to-client");
      expect(mocks.listPasskeyCredentialsForUser).toHaveBeenCalledWith(7);
    } finally {
      await app.close();
    }
  });

  test("renames a self passkey without step-up", async () => {
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/users/admin/passkeys/10/rename",
        payload: { deviceLabel: "YubiKey 5C" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        success: true,
        message: "Passkey renamed",
      });
      expect(mocks.renamePasskeyDeviceLabel).toHaveBeenCalledWith(
        10,
        7,
        "YubiKey 5C",
      );
      expect(mocks.requireStepUp).not.toHaveBeenCalled();
      expect(mocks.authCacheClear).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("admin can rename another user's passkey", async () => {
    mocks.getUserByUsername.mockResolvedValue({
      id: 42,
      username: "target",
      uuid: "target-uuid",
      isAgent: false,
    });
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/users/target/passkeys/11/rename",
        payload: { deviceLabel: "Recovery key" },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.renamePasskeyDeviceLabel).toHaveBeenCalledWith(
        11,
        42,
        "Recovery key",
      );
      expect(mocks.requireStepUp).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("forbids non-admin users from renaming another user's passkey", async () => {
    const app = await buildApp(limitedUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/users/admin/passkeys/10/rename",
        payload: { deviceLabel: "Unauthorized edit" },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        success: false,
        message: "Permission 'supervisor_admin' required",
      });
      expect(mocks.getUserByUsername).not.toHaveBeenCalled();
      expect(mocks.renamePasskeyDeviceLabel).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("rename returns 404 when the passkey does not belong to the target user", async () => {
    mocks.renamePasskeyDeviceLabel.mockResolvedValue(false);
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/users/admin/passkeys/99/rename",
        payload: { deviceLabel: "Missing key" },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        success: false,
        message: "Passkey not found",
      });
      expect(mocks.renamePasskeyDeviceLabel).toHaveBeenCalledWith(
        99,
        7,
        "Missing key",
      );
    } finally {
      await app.close();
    }
  });

  test("rename rejects labels longer than 64 characters before updating", async () => {
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/users/admin/passkeys/10/rename",
        payload: { deviceLabel: "x".repeat(65) },
      });

      expect(response.statusCode).toBe(400);
      expect(mocks.renamePasskeyDeviceLabel).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("deleting the last self passkey revokes every session and clears the actor cookie", async () => {
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/users/admin/passkeys/10/delete",
        headers: { cookie: `${SESSION_COOKIE_NAME}=actor-token` },
        payload: { stepUpAssertion: { id: "assertion-id" } },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        success: true,
        message: "Passkey removed",
      });
      expect(mocks.deletePasskeyCredential).toHaveBeenCalledWith(10, 7);
      expect(mocks.userHasPasskey).toHaveBeenCalledWith(7);
      expect(mocks.deleteAllSessionsForUser).toHaveBeenCalledWith(7, undefined);
      expect(response.headers["set-cookie"]).toContain(
        `${SESSION_COOKIE_NAME}=`,
      );
      expect(mocks.authCacheClear).toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("deleting one of several self passkeys preserves the actor's current session", async () => {
    mocks.userHasPasskey.mockResolvedValue(true);
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/users/admin/passkeys/10/delete",
        headers: { cookie: `${SESSION_COOKIE_NAME}=actor-token` },
        payload: { stepUpAssertion: { id: "assertion-id" } },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.deleteAllSessionsForUser).toHaveBeenCalledWith(
        7,
        hashToken("actor-token"),
      );
      expect(response.headers["set-cookie"]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  test("issues a registration link for self after step-up", async () => {
    mocks.userHasPasskey.mockResolvedValue(true);
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/users/admin/registration-token",
        headers: { host: "supervisor.example" },
        payload: { stepUpAssertion: { id: "assertion-id" } },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        username: "admin",
        registrationUrl:
          "https://supervisor.example/supervisor/register?token=invite-token",
        expiresAt: "2030-01-01T00:00:00.000Z",
      });
      expect(mocks.requireStepUp).toHaveBeenCalled();
      expect(mocks.issueRegistrationLink).toHaveBeenCalledWith({
        userId: 7,
        protocol: "http",
        hostHeader: "supervisor.example",
      });
    } finally {
      await app.close();
    }
  });

  test("refuses self-issued registration tokens when the caller has zero passkeys", async () => {
    // Closes the bypass: a stolen zero-passkey session would otherwise mint
    // a self-token (step-up bypassed) and use it to enroll the attacker's
    // own passkey on the victim's account.
    mocks.userHasPasskey.mockResolvedValue(false);
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/users/admin/registration-token",
        headers: { host: "supervisor.example" },
        payload: {},
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        success: false,
        message:
          "First passkey enrollment requires an admin-issued registration link.",
      });
      expect(mocks.userHasPasskey).toHaveBeenCalledWith(7);
      expect(mocks.requireStepUp).not.toHaveBeenCalled();
      expect(mocks.issueRegistrationLink).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("admin can still issue a registration token for another zero-passkey user", async () => {
    // Bootstrap / lost-device recovery: admin → other user is unaffected by
    // the self-issuance gate, even when the target has no passkeys.
    mocks.userHasPasskey.mockResolvedValue(false);
    mocks.getUserByUsername.mockResolvedValue({
      id: 42,
      username: "newbie",
      uuid: "newbie-uuid",
      isAgent: false,
    });
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/users/newbie/registration-token",
        headers: { host: "supervisor.example" },
        payload: { stepUpAssertion: { id: "assertion-id" } },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.requireStepUp).toHaveBeenCalled();
      expect(mocks.issueRegistrationLink).toHaveBeenCalledWith({
        userId: 42,
        protocol: "http",
        hostHeader: "supervisor.example",
      });
    } finally {
      await app.close();
    }
  });

  test("reset-passkeys refuses to reset the caller's own passkeys", async () => {
    const app = await buildApp(adminUser);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/supervisor/api/users/admin/reset-passkeys",
        payload: { stepUpAssertion: { id: "assertion-id" } },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        success: false,
        message: "Use 'Issue Registration Link' on yourself instead",
      });
      expect(mocks.deleteAllPasskeyCredentialsForUser).not.toHaveBeenCalled();
      expect(mocks.issueRegistrationLink).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
