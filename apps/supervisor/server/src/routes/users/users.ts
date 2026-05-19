import type { HateoasAction, HateoasLink } from "@naisys/common";
import type { Permission } from "@naisys/supervisor-database";
import {
  CreateAgentUserSchema,
  CreateUserResponseSchema,
  CreateUserSchema,
  ErrorResponseSchema,
  GrantPermissionSchema,
  PermissionEnum,
  UpdateUserSchema,
} from "@naisys/supervisor-shared";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import { authCache, requirePermission } from "../../authMiddleware.js";
import { conflict, notFound } from "../../errorHelpers.js";
import {
  API_PREFIX,
  collectionLink,
  paginationLinks,
  schemaLink,
  selfLink,
} from "../../hateoas.js";
import { permGate } from "../../routeHelpers.js";
import {
  getHubAgentById,
  getHubAgentByUuid,
} from "../../services/agents/agentService.js";
import { issueRegistrationLink } from "../../services/auth/passkeyService.js";
import { requireStepUp } from "../../services/auth/stepUpService.js";
import * as userService from "../../services/userService.js";
import userPasskeyRoutes from "./users-passkeys.js";
import userPasswordRoutes from "./users-passwords.js";

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
  hasPassword: boolean,
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
    title: "Generate API Key",
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

  if (hasPassword && (isSelf || isAdmin)) {
    actions.push({
      rel: "clear-password",
      href: `${href}/password/clear`,
      method: "POST",
      title: "Remove Password",
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
  options?: { agentUsername?: string | null; hasApiKey?: boolean },
) {
  if (!user) return null;
  const isSelf = user.id === currentUserId;
  const isAdmin = currentUserPermissions.includes("supervisor_admin");
  const hasApiKey = options?.hasApiKey ?? false;
  return {
    id: user.id,
    username: user.username,
    isAgent: user.isAgent,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    hasApiKey,
    hasPassword: Boolean(user.passwordHash),
    permissions: user.permissions.map((p) => ({
      permission: p.permission,
      grantedAt: p.grantedAt.toISOString(),
      grantedBy: p.grantedBy,
      _actions: permissionActions(user.username, p.permission, isSelf, isAdmin),
    })),
    _links: userItemLinks(user.username, options?.agentUsername),
    _actions: userActions(
      user.username,
      isSelf,
      isAdmin,
      Boolean(user.passwordHash),
    ),
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

export default async function userRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const adminPreHandler = [requirePermission("supervisor_admin")];

  await fastify.register(userPasskeyRoutes);
  await fastify.register(userPasswordRoutes);

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

  // CREATE USER (returns a registration link instead of accepting a credential)
  app.post(
    "/",
    {
      preHandler: adminPreHandler,
      schema: {
        description:
          "Create a new user. Returns a one-time registration URL the new user must open to set up a credential.",
        tags: ["Users"],
        body: CreateUserSchema,
        response: {
          201: CreateUserResponseSchema,
          401: ErrorResponseSchema,
          409: ErrorResponseSchema,
          412: ErrorResponseSchema,
          429: ErrorResponseSchema,
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

      const hasApiKey = await userService.hasUserApiKey(user.id);

      return formatUser(
        user,
        request.supervisorUser?.id ?? 0,
        request.supervisorUser?.permissions ?? [],
        { agentUsername, hasApiKey },
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
      const apiKey = await userService.rotateUserApiKey(targetUser.id);
      authCache.clear();
      return {
        success: true,
        message: "API key generated. Copy it now; it cannot be shown again.",
        apiKey,
      };
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
}
