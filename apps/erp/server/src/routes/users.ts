import type { HateoasAction, HateoasLink } from "@naisys/common";
import { getHubAgentById } from "@naisys/hub-database";
import {
  ChangePasswordSchema,
  CreateAgentUserSchema,
  CreateUserSchema,
  type ErpPermission,
  UpdateUserSchema,
} from "@naisys-erp/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import {
  authCache,
  hasPermission,
  requirePermission,
} from "../auth-middleware.js";
import {
  API_PREFIX,
  collectionLink,
  paginationLinks,
  schemaLink,
  selfLink,
} from "../hateoas.js";
import { mutationResult } from "../route-helpers.js";
import type { getUserById } from "../services/user-service.js";
import {
  createUserForAgent,
  createUserWithPassword,
  deleteUser,
  getUserApiKey,
  getUserByUsername,
  getUserByUuid,
  listUsers,
  updateUser,
} from "../services/user-service.js";
import { isSupervisorAuth } from "../supervisorAuth.js";

function userItemLinks(username: string): HateoasLink[] {
  return [
    selfLink(`/users/${username}`),
    collectionLink("users"),
    schemaLink("UpdateUser"),
  ];
}

function userActions(
  username: string,
  isSelf: boolean,
  isAdmin: boolean,
): HateoasAction[] {
  const href = `${API_PREFIX}/users/${username}`;
  const actions: HateoasAction[] = [];

  if (isAdmin) {
    actions.push({
      rel: "update",
      href,
      method: "PUT",
      title: "Update",
      schema: `${API_PREFIX}/schemas/UpdateUser`,
      body: { username: "" },
    });
  }

  if (isSelf) {
    actions.push({
      rel: "change-password",
      href: `${API_PREFIX}/users/me/password`,
      method: "POST",
      title: "Change Password",
      schema: `${API_PREFIX}/schemas/ChangePassword`,
      body: { password: "" },
    });
  }

  if (isAdmin) {
    actions.push({
      rel: "grant-permission",
      href: `${href}/permissions`,
      method: "POST",
      title: "Grant Permission",
      schema: `${API_PREFIX}/schemas/GrantPermission`,
      body: { permission: "" },
    });

    actions.push({
      rel: "rotate-key",
      href: `${href}/rotate-key`,
      method: "POST",
      title: "Rotate API Key",
    });

    if (!isSelf) {
      actions.push({
        rel: "delete",
        href,
        method: "DELETE",
        title: "Delete",
      });
    }
  }

  return actions;
}

function permissionActions(
  username: string,
  permission: ErpPermission,
  isSelf: boolean,
  isAdmin: boolean,
): HateoasAction[] {
  if (!isAdmin) return [];

  const actions: HateoasAction[] = [];

  // Cannot revoke own erp_admin
  if (!(isSelf && permission === "erp_admin")) {
    actions.push({
      rel: "revoke",
      href: `${API_PREFIX}/users/${username}/permissions/${permission}`,
      method: "DELETE",
      title: "Revoke",
    });
  }

  return actions;
}

export function formatUser(
  user: Awaited<ReturnType<typeof getUserById>>,
  currentUserId: number,
  currentUserPermissions: ErpPermission[],
  options?: { apiKey?: string | null },
) {
  if (!user) return null;
  const isSelf = user.id === currentUserId;
  const isAdmin = currentUserPermissions.includes("erp_admin");
  return {
    id: user.id,
    username: user.username,
    isAgent: user.isAgent,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    apiKey: isAdmin ? (options?.apiKey ?? null) : undefined,
    permissions: user.permissions.map((p) => ({
      permission: p.permission,
      grantedAt: p.grantedAt.toISOString(),
      grantedBy: p.grantedBy,
      _actions: permissionActions(user.username, p.permission, isSelf, isAdmin),
    })),
    _links: userItemLinks(user.username),
    _actions: userActions(user.username, isSelf, isAdmin),
  };
}

function formatListUser(
  user: Awaited<ReturnType<typeof listUsers>>["items"][number],
) {
  return {
    id: user.id,
    username: user.username,
    isAgent: user.isAgent,
    createdAt: user.createdAt.toISOString(),
    permissionCount: user.permissions.length,
  };
}

export default function userRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const adminPreHandler = [requirePermission("erp_admin")];

  const requireAdminOrSelf = async (
    request: FastifyRequest<{ Params: { username: string } }>,
    reply: FastifyReply,
  ) => {
    if (!request.erpUser) {
      reply.status(401).send({
        statusCode: 401,
        error: "Unauthorized",
        message: "Authentication required",
      });
      return;
    }
    const isAdmin = hasPermission(request.erpUser, "erp_admin");
    const isSelf = request.params.username === request.erpUser.username;
    if (!isAdmin && !isSelf) {
      reply.status(403).send({
        statusCode: 403,
        error: "Forbidden",
        message: "Permission 'erp_admin' required",
      });
      return;
    }
  };

  const usernameParams = z.object({ username: z.string() });

  // LIST USERS
  app.get(
    "/",
    {
      preHandler: adminPreHandler,
      schema: {
        description: "List all users with pagination",
        tags: ["Users"],
        querystring: z.object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(20),
          search: z.string().optional(),
        }),
      },
    },
    async (request) => {
      const { page, pageSize, search } = request.query;
      const result = await listUsers({ page, pageSize, search });

      const actions: HateoasAction[] = [
        {
          rel: "create",
          href: `${API_PREFIX}/users`,
          method: "POST",
          title: "Create User",
          schema: `${API_PREFIX}/schemas/CreateUser`,
          body: { username: "", password: "" },
        },
      ];

      if (isSupervisorAuth()) {
        actions.push({
          rel: "create-from-agent",
          href: `${API_PREFIX}/users/from-agent`,
          method: "POST",
          title: "Create Agent User",
          schema: `${API_PREFIX}/schemas/CreateAgentUser`,
          body: { agentId: 0 },
        });
      }

      return {
        items: result.items.map(formatListUser),
        total: result.total,
        page,
        pageSize: result.pageSize,
        _links: paginationLinks("users", page, pageSize, result.total, {
          search,
        }),
        _linkTemplates: [
          {
            rel: "item",
            hrefTemplate: `${API_PREFIX}/users/{username}`,
          },
        ],
        _actions: actions,
      };
    },
  );

  // CHANGE OWN PASSWORD (must be registered before /:username routes)
  app.post(
    "/me/password",
    {
      schema: {
        description: "Change the current user's password",
        tags: ["Users"],
        body: ChangePasswordSchema,
      },
    },
    async (request, reply) => {
      if (!request.erpUser) {
        reply.status(401).send({
          statusCode: 401,
          error: "Unauthorized",
          message: "Authentication required",
        });
        return;
      }

      await updateUser(request.erpUser.id, {
        password: request.body.password,
      });
      authCache.clear();
      return { success: true, message: "Password changed" };
    },
  );

  // CREATE USER
  app.post(
    "/",
    {
      preHandler: adminPreHandler,
      schema: {
        description: "Create a new user",
        tags: ["Users"],
        body: CreateUserSchema,
      },
    },
    async (request, reply) => {
      try {
        const user = await createUserWithPassword(request.body);
        const full = formatUser(
          user,
          request.erpUser!.id,
          request.erpUser!.permissions,
        );
        reply.code(201);
        return mutationResult(request, reply, full, {
          id: full!.id,
          username: full!.username,
          apiKey: full!.apiKey,
          _links: full!._links,
          _actions: full!._actions,
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("Unique constraint")) {
          reply.code(409);
          return { success: false, message: "Username already exists" };
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
        description: "Create an ERP user from an existing hub agent",
        tags: ["Users"],
        body: CreateAgentUserSchema,
      },
    },
    async (request, reply) => {
      if (!isSupervisorAuth()) {
        reply.code(400);
        return {
          statusCode: 400,
          error: "Bad Request",
          message: "Supervisor auth is not enabled",
        };
      }

      const { agentId } = request.body;

      const hubAgent = await getHubAgentById(agentId);
      if (!hubAgent) {
        reply.code(404);
        return {
          statusCode: 404,
          error: "Not Found",
          message: "Agent not found",
        };
      }

      const existingByUuid = await getUserByUuid(hubAgent.uuid);
      if (existingByUuid) {
        reply.code(409);
        return {
          statusCode: 409,
          error: "Conflict",
          message: "A user with this agent's UUID already exists",
        };
      }

      const existingByUsername = await getUserByUsername(hubAgent.username);
      if (existingByUsername) {
        reply.code(409);
        return {
          statusCode: 409,
          error: "Conflict",
          message: "Username already exists",
        };
      }

      try {
        const user = await createUserForAgent(hubAgent.username, hubAgent.uuid);
        const full = formatUser(
          user,
          request.erpUser!.id,
          request.erpUser!.permissions,
        );
        reply.code(201);
        return mutationResult(request, reply, full, {
          id: full!.id,
          username: full!.username,
          apiKey: full!.apiKey,
          _links: full!._links,
          _actions: full!._actions,
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("Unique constraint")) {
          reply.code(409);
          return {
            statusCode: 409,
            error: "Conflict",
            message: "Username already exists",
          };
        }
        throw err;
      }
    },
  );

  // GET USER (admin or self)
  app.get(
    "/:username",
    {
      preHandler: [requireAdminOrSelf],
      schema: {
        description: "Get user details",
        tags: ["Users"],
        params: usernameParams,
      },
    },
    async (request, reply) => {
      const user = await getUserByUsername(request.params.username);
      if (!user) {
        reply.code(404);
        return { success: false, message: "User not found" };
      }

      const apiKey = await getUserApiKey(user.id);

      return formatUser(
        user,
        request.erpUser!.id,
        request.erpUser!.permissions,
        { apiKey },
      );
    },
  );

  // UPDATE USER (admin can update any field; non-admin can only change own password)
  app.put(
    "/:username",
    {
      preHandler: [requireAdminOrSelf],
      schema: {
        description: "Update a user",
        tags: ["Users"],
        params: usernameParams,
        body: UpdateUserSchema,
      },
    },
    async (request, reply) => {
      const targetUser = await getUserByUsername(request.params.username);
      if (!targetUser) {
        reply.code(404);
        return { success: false, message: "User not found" };
      }

      const isAdmin = hasPermission(request.erpUser, "erp_admin");

      // Non-admins can only change their own password
      const body = isAdmin ? request.body : { password: request.body.password };

      try {
        const user = await updateUser(targetUser.id, body);
        authCache.clear();
        const full = formatUser(
          user,
          request.erpUser!.id,
          request.erpUser!.permissions,
        );
        return mutationResult(request, reply, full, {
          _actions: full!._actions,
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("Unique constraint")) {
          reply.code(409);
          return { success: false, message: "Username already exists" };
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
      },
    },
    async (request, reply) => {
      if (request.params.username === request.erpUser!.username) {
        reply.code(409);
        return { success: false, message: "Cannot delete yourself" };
      }
      const targetUser = await getUserByUsername(request.params.username);
      if (!targetUser) {
        reply.code(404);
        return { success: false, message: "User not found" };
      }
      await deleteUser(targetUser.id);
      authCache.clear();
      return { success: true, message: "User deleted" };
    },
  );
}
