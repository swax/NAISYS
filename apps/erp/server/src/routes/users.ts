import type { HateoasAction, HateoasLink } from "@naisys/common";
import {
  ChangePasswordSchema,
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
import {
  createUserWithPassword,
  deleteUser,
  getUserApiKey,
  getUserById,
  getUserByUsername,
  listUsers,
  updateUser,
} from "../services/user-service.js";

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
    });
  }

  if (isSelf) {
    actions.push({
      rel: "change-password",
      href: `${API_PREFIX}/users/me/password`,
      method: "POST",
      title: "Change Password",
      schema: `${API_PREFIX}/schemas/ChangePassword`,
    });
  }

  if (isAdmin) {
    actions.push({
      rel: "grant-permission",
      href: `${href}/permissions`,
      method: "POST",
      title: "Grant Permission",
      schema: `${API_PREFIX}/schemas/GrantPermission`,
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
    _links: [selfLink(`/users/${user.username}`)],
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
        },
      ];

      return {
        items: result.items.map(formatListUser),
        total: result.total,
        page,
        pageSize: result.pageSize,
        _links: paginationLinks("users", page, pageSize, result.total, {
          search,
        }),
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
        reply.code(201);
        return formatUser(
          user,
          request.erpUser!.id,
          request.erpUser!.permissions,
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("Unique constraint")) {
          reply.code(409);
          return { success: false, message: "Username already exists" };
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
        return formatUser(
          user,
          request.erpUser!.id,
          request.erpUser!.permissions,
        );
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
