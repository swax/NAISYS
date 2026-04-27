import type { HateoasAction, HateoasLink } from "@naisys/common";
import { hashToken, SESSION_COOKIE_NAME } from "@naisys/common-node";
import {
  deleteAllPasskeyCredentialsForUser,
  deleteAllSessionsForUser,
  deletePasskeyCredential,
  listPasskeyCredentialsForUser,
  type Permission,
  userHasPasskey,
} from "@naisys/supervisor-database";
import {
  CreateAgentUserSchema,
  CreateUserResponseSchema,
  CreateUserSchema,
  ErrorResponseSchema,
  GrantPermissionSchema,
  PasskeyCredentialListSchema,
  PermissionEnum,
  RegistrationTokenResponseSchema,
  StepUpAssertionBodySchema,
  UpdateUserSchema,
} from "@naisys/supervisor-shared";
import type {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import { authCache, requirePermission } from "../auth-middleware.js";
import {
  conflict,
  forbidden,
  notFound,
  sendForbidden,
  sendUnauthorized,
} from "../error-helpers.js";
import {
  API_PREFIX,
  collectionLink,
  paginationLinks,
  schemaLink,
  selfLink,
} from "../hateoas.js";
import { permGate } from "../route-helpers.js";
import {
  getHubAgentById,
  getHubAgentByUuid,
} from "../services/agentService.js";
import { issueRegistrationLink } from "../services/passkeyService.js";
import { requireStepUp } from "../services/stepUpService.js";
import * as userService from "../services/userService.js";

function userItemLinks(
  username: string,
  agentUsername?: string | null,
): HateoasLink[] {
  const links: HateoasLink[] = [
    selfLink(`/users/${username}`),
    collectionLink("users"),
    schemaLink("UpdateUser"),
  ];
  if (agentUsername != null) {
    links.push({
      rel: "agent",
      href: `${API_PREFIX}/agents/${agentUsername}`,
      title: "View Agent",
    });
  }
  return links;
}

function userActions(
  username: string,
  isSelf: boolean,
  isAdmin: boolean,
): HateoasAction[] {
  const href = `${API_PREFIX}/users/${username}`;
  const adminGate = permGate(isAdmin, "supervisor_admin");
  const actions: HateoasAction[] = [];

  // Admins can edit any user (username only)
  actions.push({
    rel: "update",
    href,
    method: "PUT",
    title: "Update",
    schema: `${API_PREFIX}/schemas/UpdateUser`,
    body: { username: "" },
    ...adminGate,
  });

  actions.push({
    rel: "grant-permission",
    href: `${href}/permissions`,
    method: "POST",
    title: "Grant Permission",
    schema: `${API_PREFIX}/schemas/GrantPermission`,
    body: { permission: "" },
    ...adminGate,
  });

  actions.push({
    rel: "rotate-key",
    href: `${href}/rotate-key`,
    method: "POST",
    title: "Rotate API Key",
    ...adminGate,
  });

  // Admin or self can issue a new registration token (admin to onboard / reset
  // someone, self to add another passkey from a new device). Hide it from
  // viewers who match neither so the UI reflects what the endpoint enforces.
  if (isSelf || isAdmin) {
    actions.push({
      rel: "issue-registration",
      href: `${href}/registration-token`,
      method: "POST",
      title: "Issue Registration Link",
    });
  }

  // Admin-only "wipe all passkeys" reset path. Always available alongside the
  // registration link issue so that a lost-device case can be recovered.
  if (!isSelf) {
    actions.push({
      rel: "reset-passkeys",
      href: `${href}/reset-passkeys`,
      method: "POST",
      title: "Reset Passkeys",
      ...adminGate,
    });
  }

  // Delete: admin-only AND not self (can't delete yourself)
  if (!isSelf) {
    actions.push({
      rel: "delete",
      href,
      method: "DELETE",
      title: "Delete",
      ...adminGate,
    });
  }

  return actions;
}

function permissionActions(
  username: string,
  permission: Permission,
  isSelf: boolean,
  isAdmin: boolean,
): HateoasAction[] {
  const actions: HateoasAction[] = [];

  // Cannot revoke own supervisor_admin (state guard — keep hidden when it applies)
  if (isSelf && permission === "supervisor_admin") return actions;

  actions.push({
    rel: "revoke",
    href: `${API_PREFIX}/users/${username}/permissions/${permission}`,
    method: "DELETE",
    title: "Revoke",
    ...permGate(isAdmin, "supervisor_admin"),
  });

  return actions;
}

function formatUser(
  user: Awaited<ReturnType<typeof userService.getUserById>>,
  currentUserId: number,
  currentUserPermissions: Permission[],
  options?: { agentUsername?: string | null; apiKey?: string | null },
) {
  if (!user) return null;
  const isSelf = user.id === currentUserId;
  const isAdmin = currentUserPermissions.includes("supervisor_admin");
  const apiKeyValue = options?.apiKey ?? null;
  return {
    id: user.id,
    username: user.username,
    isAgent: user.isAgent,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    apiKey: isAdmin ? apiKeyValue : undefined,
    hasApiKey: apiKeyValue !== null,
    permissions: user.permissions.map((p) => ({
      permission: p.permission,
      grantedAt: p.grantedAt.toISOString(),
      grantedBy: p.grantedBy,
      _actions: permissionActions(user.username, p.permission, isSelf, isAdmin),
    })),
    _links: userItemLinks(user.username, options?.agentUsername),
    _actions: userActions(user.username, isSelf, isAdmin),
  };
}

function formatListUser(
  user: Awaited<ReturnType<typeof userService.listUsers>>["items"][number],
) {
  return {
    id: user.id,
    uuid: user.uuid,
    username: user.username,
    isAgent: user.isAgent,
    createdAt: user.createdAt.toISOString(),
    permissionCount: user.permissions.length,
  };
}

export default function userRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const adminPreHandler = [requirePermission("supervisor_admin")];

  const requireAdminOrSelf = async (
    request: FastifyRequest<{ Params: { username: string } }>,
    reply: FastifyReply,
  ) => {
    if (!request.supervisorUser) {
      sendUnauthorized(reply, "Authentication required");
      return;
    }
    const isAdmin =
      request.supervisorUser.permissions.includes("supervisor_admin");
    const isSelf = request.params.username === request.supervisorUser.username;
    if (!isAdmin && !isSelf) {
      sendForbidden(reply, "Permission 'supervisor_admin' required");
      return;
    }
  };

  // LIST USERS
  app.get(
    "/",
    {
      schema: {
        description: "List all users with pagination",
        tags: ["Users"],
        querystring: z.object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(20),
          search: z.string().optional(),
        }),
        security: [{ cookieAuth: [] }],
      },
    },
    async (request) => {
      const { page, pageSize, search } = request.query;
      const result = await userService.listUsers({ page, pageSize, search });

      const isAdmin =
        request.supervisorUser?.permissions.includes("supervisor_admin") ??
        false;
      const adminGate = permGate(isAdmin, "supervisor_admin");
      const actions: HateoasAction[] = [
        {
          rel: "create",
          href: `${API_PREFIX}/users`,
          method: "POST",
          title: "Create User",
          schema: `${API_PREFIX}/schemas/CreateUser`,
          body: { username: "" },
          ...adminGate,
        },
        {
          rel: "create-from-agent",
          href: `${API_PREFIX}/users/from-agent`,
          method: "POST",
          title: "Import User from Agent",
          schema: `${API_PREFIX}/schemas/CreateAgentUser`,
          body: { agentId: 0 },
          ...adminGate,
        },
      ];

      return {
        items: result.items.map(formatListUser),
        total: result.total,
        pageSize: result.pageSize,
        _links: paginationLinks("users", page, pageSize, result.total, {
          search,
        }),
        _linkTemplates: [
          { rel: "item", hrefTemplate: `${API_PREFIX}/users/{username}` },
        ],
        _actions: actions,
      };
    },
  );

  // CREATE USER (returns a registration link instead of accepting a password)
  app.post(
    "/",
    {
      preHandler: adminPreHandler,
      schema: {
        description:
          "Create a new user. Returns a one-time registration URL the new user must open to enroll a passkey.",
        tags: ["Users"],
        body: CreateUserSchema,
        response: {
          201: CreateUserResponseSchema,
          401: ErrorResponseSchema,
          409: ErrorResponseSchema,
          412: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const stepUp = await requireStepUp(request, reply, request.body);
      if (!stepUp.ok) {
        reply.code(stepUp.status);
        return { success: false as const, message: stepUp.message };
      }
      try {
        const user = await userService.createPasskeyUser({
          username: request.body.username,
        });
        const link = await issueRegistrationLink({
          userId: user.id,
          protocol: request.protocol,
          hostHeader: request.headers.host,
        });
        reply.code(201);
        return {
          success: true,
          message: "User created",
          id: user.id,
          username: user.username,
          registrationUrl: link.url,
          registrationExpiresAt: link.expiresAt.toISOString(),
        };
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("Unique constraint")) {
          return conflict(reply, "Username already exists");
        }
        throw err;
      }
    },
  );

  // CREATE AGENT USER (from hub agent)
  app.post(
    "/from-agent",
    {
      preHandler: adminPreHandler,
      schema: {
        description: "Create a supervisor user from an existing hub agent",
        tags: ["Users"],
        body: CreateAgentUserSchema,
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const { agentId } = request.body;

      const hubAgent = await getHubAgentById(agentId);
      if (!hubAgent) {
        return notFound(reply, "Agent not found");
      }

      const existingByUuid = await userService.getUserByUuid(hubAgent.uuid);
      if (existingByUuid) {
        return conflict(reply, "A user with this agent's UUID already exists");
      }

      const existingByUsername = await userService.getUserByUsername(
        hubAgent.username,
      );
      if (existingByUsername) {
        return conflict(reply, "Username already exists");
      }

      const user = await userService.createUserForAgent(
        hubAgent.username,
        hubAgent.uuid,
      );
      reply.code(201);
      return {
        success: true,
        message: "Agent user created",
        id: user.id,
        username: user.username,
      };
    },
  );

  const usernameParams = z.object({ username: z.string() });

  // GET USER
  app.get(
    "/:username",
    {
      schema: {
        description: "Get user details",
        tags: ["Users"],
        params: usernameParams,
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const user = await userService.getUserByUsernameWithPermissions(
        request.params.username,
      );
      if (!user) {
        return notFound(reply, "User not found");
      }

      let agentUsername: string | null = null;
      if (user.isAgent && user.uuid) {
        const hubAgent = await getHubAgentByUuid(user.uuid);
        agentUsername = hubAgent?.username ?? null;
      }

      const apiKey = await userService.getUserApiKey(user.id);

      return formatUser(
        user,
        request.supervisorUser?.id ?? 0,
        request.supervisorUser?.permissions ?? [],
        { agentUsername, apiKey },
      );
    },
  );

  // UPDATE USER (admin only — username only)
  app.put(
    "/:username",
    {
      preHandler: adminPreHandler,
      schema: {
        description: "Update a user",
        tags: ["Users"],
        params: usernameParams,
        body: UpdateUserSchema,
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const targetUser = await userService.getUserByUsernameWithPermissions(
        request.params.username,
      );
      if (!targetUser) {
        return notFound(reply, "User not found");
      }

      try {
        await userService.updateUser(targetUser.id, request.body);
        authCache.clear();
        return { success: true, message: "User updated" };
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("Unique constraint")) {
          return conflict(reply, "Username already exists");
        }
        throw err;
      }
    },
  );

  // DELETE USER
  app.delete(
    "/:username",
    {
      preHandler: adminPreHandler,
      schema: {
        description: "Delete a user",
        tags: ["Users"],
        params: usernameParams,
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      if (request.params.username === request.supervisorUser!.username) {
        return conflict(reply, "Cannot delete yourself");
      }
      const targetUser = await userService.getUserByUsernameWithPermissions(
        request.params.username,
      );
      if (!targetUser) {
        return notFound(reply, "User not found");
      }
      await userService.deleteUser(targetUser.id);
      authCache.clear();
      return { success: true, message: "User deleted" };
    },
  );

  // ROTATE API KEY
  app.post(
    "/:username/rotate-key",
    {
      preHandler: adminPreHandler,
      schema: {
        description: "Rotate a user's API key",
        tags: ["Users"],
        params: usernameParams,
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const targetUser = await userService.getUserByUsernameWithPermissions(
        request.params.username,
      );
      if (!targetUser) {
        return notFound(reply, "User not found");
      }
      await userService.rotateUserApiKey(targetUser.id);
      authCache.clear();
      return { success: true, message: "API key rotated" };
    },
  );

  // GRANT PERMISSION
  app.post(
    "/:username/permissions",
    {
      preHandler: adminPreHandler,
      schema: {
        description: "Grant a permission to a user",
        tags: ["Users"],
        params: usernameParams,
        body: GrantPermissionSchema,
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const targetUser = await userService.getUserByUsernameWithPermissions(
        request.params.username,
      );
      if (!targetUser) {
        return notFound(reply, "User not found");
      }

      try {
        await userService.grantPermission(
          targetUser.id,
          request.body.permission,
          request.supervisorUser!.id,
        );
        authCache.clear();
        return { success: true, message: "Permission granted" };
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("Unique constraint")) {
          return conflict(reply, "Permission already granted");
        }
        throw err;
      }
    },
  );

  // REVOKE PERMISSION
  app.delete(
    "/:username/permissions/:permission",
    {
      preHandler: adminPreHandler,
      schema: {
        description: "Revoke a permission from a user",
        tags: ["Users"],
        params: z.object({
          username: z.string(),
          permission: PermissionEnum,
        }),
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const { username, permission } = request.params;

      // Cannot revoke own supervisor_admin
      if (
        username === request.supervisorUser!.username &&
        permission === "supervisor_admin"
      ) {
        return conflict(
          reply,
          "Cannot revoke your own supervisor_admin permission",
        );
      }

      const targetUser =
        await userService.getUserByUsernameWithPermissions(username);
      if (!targetUser) {
        return notFound(reply, "User not found");
      }

      await userService.revokePermission(targetUser.id, permission);
      authCache.clear();
      return { success: true, message: "Permission revoked" };
    },
  );

  // LIST PASSKEYS
  app.get(
    "/:username/passkeys",
    {
      preHandler: [requireAdminOrSelf],
      schema: {
        description: "List a user's registered passkeys",
        tags: ["Users"],
        params: usernameParams,
        response: {
          200: PasskeyCredentialListSchema,
          404: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const targetUser = await userService.getUserByUsername(
        request.params.username,
      );
      if (!targetUser) return notFound(reply, "User not found");

      const credentials = await listPasskeyCredentialsForUser(targetUser.id);
      return {
        credentials: credentials.map((c) => ({
          id: c.id,
          deviceLabel: c.deviceLabel,
          createdAt: c.createdAt.toISOString(),
          lastUsedAt: c.lastUsedAt ? c.lastUsedAt.toISOString() : null,
        })),
      };
    },
  );

  // DELETE PASSKEY (admin or self) — POST not DELETE so we can carry the
  // step-up assertion in the body (some HTTP intermediaries strip DELETE
  // bodies, and we don't want to depend on header-encoded blobs).
  //
  // Step-up is required here specifically to close a session-hijack chain:
  // without it, an attacker holding a stolen cookie could drain a victim's
  // passkeys, and once the victim has zero credentials left, requireStepUp
  // bypasses for all subsequent admin actions on the attacker's session,
  // letting them mint a registration link and enroll their own passkey.
  const passkeyParams = z.object({
    username: z.string(),
    id: z.coerce.number().int(),
  });
  app.post<{
    Params: z.infer<typeof passkeyParams>;
    Body: z.infer<typeof StepUpAssertionBodySchema>;
  }>(
    "/:username/passkeys/:id/delete",
    {
      preHandler: async (request, reply) => {
        if (!request.supervisorUser) {
          sendUnauthorized(reply, "Authentication required");
          return;
        }
        const isAdmin =
          request.supervisorUser.permissions.includes("supervisor_admin");
        const isSelf =
          request.params.username === request.supervisorUser.username;
        if (!isAdmin && !isSelf) {
          sendForbidden(reply, "Permission 'supervisor_admin' required");
          return;
        }
      },
      schema: {
        description: "Delete one of a user's registered passkeys",
        tags: ["Users"],
        params: passkeyParams,
        body: StepUpAssertionBodySchema,
        response: {
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
          412: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const stepUp = await requireStepUp(request, reply, request.body);
      if (!stepUp.ok) {
        reply.code(stepUp.status);
        return { success: false as const, message: stepUp.message };
      }

      const targetUser = await userService.getUserByUsername(
        request.params.username,
      );
      if (!targetUser) return notFound(reply, "User not found");

      const removed = await deletePasskeyCredential(
        request.params.id,
        targetUser.id,
      );
      if (!removed) return notFound(reply, "Passkey not found");

      // Two cleanup modes depending on what's left:
      //   - Last passkey gone: kill every session, including the actor's.
      //     The account has no credentials behind it anymore, so leaving
      //     any cookie alive is exactly the bypass we're trying to close.
      //   - Still has at least one passkey: kill all sessions except the
      //     self-actor's current cookie, preserving the prune workflow's UX.
      //     Any non-actor session (i.e. attacker on another device) is
      //     evicted, and step-up still gates further sensitive actions.
      const stillHasPasskey = await userHasPasskey(targetUser.id);
      const actingOnSelf = targetUser.id === request.supervisorUser?.id;
      const cookieToken = request.cookies?.[SESSION_COOKIE_NAME];
      const preserveActorSession = stillHasPasskey && actingOnSelf;
      await deleteAllSessionsForUser(
        targetUser.id,
        preserveActorSession && cookieToken ? hashToken(cookieToken) : undefined,
      );

      // If the actor just invalidated their own session (last-passkey case),
      // tell the browser to drop the now-dead cookie so it doesn't keep
      // presenting it on subsequent requests. Server-side it was already
      // gone after deleteAllSessionsForUser; this is purely UX cleanup.
      if (actingOnSelf && !preserveActorSession) {
        reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      }

      authCache.clear();
      return { success: true, message: "Passkey removed" };
    },
  );

  // ISSUE REGISTRATION TOKEN (admin to invite/reset, or self to add a device)
  //
  // Self-issuance is blocked when the caller has zero passkeys: otherwise a
  // stolen session for a zero-passkey user could mint a token here (step-up
  // bypasses with no passkey to verify against) and use it to enroll the
  // attacker's own passkey. First enrollment must come through an admin or
  // the bootstrap setup wizard, never a self-issued link.
  app.post(
    "/:username/registration-token",
    {
      preHandler: [requireAdminOrSelf],
      schema: {
        description:
          "Issue a one-time registration token for the user. Any prior unused tokens are revoked.",
        tags: ["Users"],
        params: usernameParams,
        body: StepUpAssertionBodySchema,
        response: {
          200: RegistrationTokenResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          412: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const callerId = request.supervisorUser!.id;
      const isSelf = request.params.username === request.supervisorUser!.username;
      if (isSelf && !(await userHasPasskey(callerId))) {
        return forbidden(
          reply,
          "First passkey enrollment requires an admin-issued registration link.",
        );
      }
      const stepUp = await requireStepUp(request, reply, request.body);
      if (!stepUp.ok) {
        reply.code(stepUp.status);
        return { success: false as const, message: stepUp.message };
      }
      const targetUser = await userService.getUserByUsername(
        request.params.username,
      );
      if (!targetUser) return notFound(reply, "User not found");

      const link = await issueRegistrationLink({
        userId: targetUser.id,
        protocol: request.protocol,
        hostHeader: request.headers.host,
      });

      return {
        username: targetUser.username,
        registrationUrl: link.url,
        expiresAt: link.expiresAt.toISOString(),
      };
    },
  );

  // RESET PASSKEYS (admin: wipes all passkeys + issues a fresh registration link)
  app.post(
    "/:username/reset-passkeys",
    {
      preHandler: adminPreHandler,
      schema: {
        description:
          "Wipe all of a user's passkeys and issue a fresh registration token. Use when a user has lost all their devices.",
        tags: ["Users"],
        params: usernameParams,
        body: StepUpAssertionBodySchema,
        response: {
          200: RegistrationTokenResponseSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          412: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const stepUp = await requireStepUp(request, reply, request.body);
      if (!stepUp.ok) {
        reply.code(stepUp.status);
        return { success: false as const, message: stepUp.message };
      }
      if (request.params.username === request.supervisorUser!.username) {
        return conflict(reply, "Use 'Issue Registration Link' on yourself instead");
      }

      const targetUser = await userService.getUserByUsername(
        request.params.username,
      );
      if (!targetUser) return notFound(reply, "User not found");

      await deleteAllPasskeyCredentialsForUser(targetUser.id);
      // Recovery is the canonical "this user has lost access" action — kill
      // any browser sessions that might still be carrying a session cookie
      // from the prior credentials.
      await deleteAllSessionsForUser(targetUser.id);
      const link = await issueRegistrationLink({
        userId: targetUser.id,
        protocol: request.protocol,
        hostHeader: request.headers.host,
      });

      authCache.clear();
      return {
        username: targetUser.username,
        registrationUrl: link.url,
        expiresAt: link.expiresAt.toISOString(),
      };
    },
  );
}
