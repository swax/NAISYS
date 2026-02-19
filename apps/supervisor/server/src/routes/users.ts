import { z } from "zod/v4";
import {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  ChangePasswordSchema,
  CreateUserSchema,
  UpdateUserSchema,
  GrantPermissionSchema,
} from "@naisys-supervisor/shared";
import type { Permission } from "@naisys/supervisor-database";
import { requirePermission, authCache } from "../auth-middleware.js";
import * as userService from "../services/userService.js";
import type { HateoasAction, HateoasLink } from "@naisys/common";
import {
  API_PREFIX,
  paginationLinks,
  selfLink,
  collectionLink,
  schemaLink,
} from "../hateoas.js";

function userItemLinks(userId: number): HateoasLink[] {
  return [
    selfLink(`/users/${userId}`),
    collectionLink("users"),
    schemaLink("UpdateUser"),
  ];
}

function userActions(
  userId: number,
  isSelf: boolean,
  isAdmin: boolean,
): HateoasAction[] {
  const href = `${API_PREFIX}/users/${userId}`;
  const actions: HateoasAction[] = [];

  // Admins can edit any user (username + password)
  if (isAdmin) {
    actions.push({
      rel: "update",
      href,
      method: "PUT",
      title: "Update",
      schema: `${API_PREFIX}/schemas/UpdateUser`,
    });
  }

  // Any authenticated user can change their own password
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
  userId: number,
  permission: string,
  isSelf: boolean,
  isAdmin: boolean,
): HateoasAction[] {
  if (!isAdmin) return [];

  const actions: HateoasAction[] = [];

  // Cannot revoke own supervisor_admin
  if (!(isSelf && permission === "supervisor_admin")) {
    actions.push({
      rel: "revoke",
      href: `${API_PREFIX}/users/${userId}/permissions/${permission}`,
      method: "DELETE",
      title: "Revoke",
    });
  }

  return actions;
}

function formatUser(
  user: Awaited<ReturnType<typeof userService.getUserById>>,
  currentUserId: number,
  currentUserPermissions: string[],
) {
  if (!user) return null;
  const isSelf = user.id === currentUserId;
  const isAdmin = currentUserPermissions.includes("supervisor_admin");
  return {
    id: user.id,
    username: user.username,
    isAgent: user.isAgent,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    permissions: user.permissions.map((p) => ({
      permission: p.permission,
      grantedAt: p.grantedAt.toISOString(),
      grantedBy: p.grantedBy,
      _actions: permissionActions(user.id, p.permission, isSelf, isAdmin),
    })),
    _links: userItemLinks(user.id),
    _actions: userActions(user.id, isSelf, isAdmin),
  };
}

function formatListUser(
  user: Awaited<ReturnType<typeof userService.listUsers>>["items"][number],
) {
  return {
    id: user.id,
    username: user.username,
    isAgent: user.isAgent,
    createdAt: user.createdAt.toISOString(),
    permissionCount: user.permissions.length,
    _links: [selfLink(`/users/${user.id}`)],
  };
}

export default async function userRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const adminPreHandler = [requirePermission("supervisor_admin")];

  const requireAdminOrSelf = async (
    request: FastifyRequest<{ Params: { id: number } }>,
    reply: FastifyReply,
  ) => {
    if (!request.supervisorUser) {
      reply.status(401).send({
        statusCode: 401,
        error: "Unauthorized",
        message: "Authentication required",
      });
      return;
    }
    const isAdmin =
      request.supervisorUser.permissions.includes("supervisor_admin");
    const isSelf = request.params.id === request.supervisorUser.id;
    if (!isAdmin && !isSelf) {
      reply.status(403).send({
        statusCode: 403,
        error: "Forbidden",
        message: "Permission 'supervisor_admin' required",
      });
      return;
    }
  };

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
        security: [{ cookieAuth: [] }],
      },
    },
    async (request) => {
      const { page, pageSize, search } = request.query;
      const result = await userService.listUsers({ page, pageSize, search });

      return {
        items: result.items.map(formatListUser),
        total: result.total,
        pageSize: result.pageSize,
        _links: paginationLinks("users", page, pageSize, result.total, {
          search,
        }),
      };
    },
  );

  // CHANGE OWN PASSWORD (must be registered before /:id routes)
  app.post(
    "/me/password",
    {
      schema: {
        description: "Change the current user's password",
        tags: ["Users"],
        body: ChangePasswordSchema,
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      if (!request.supervisorUser) {
        reply.status(401).send({
          statusCode: 401,
          error: "Unauthorized",
          message: "Authentication required",
        });
        return;
      }

      await userService.updateUser(request.supervisorUser.id, {
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
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const user = await userService.createUserWithPassword(request.body);
        reply.code(201);
        return formatUser(
          user,
          request.supervisorUser!.id,
          request.supervisorUser!.permissions,
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
    "/:id",
    {
      preHandler: [requireAdminOrSelf],
      schema: {
        description: "Get user details",
        tags: ["Users"],
        params: z.object({ id: z.coerce.number().int() }),
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const user = await userService.getUserById(request.params.id);
      if (!user) {
        reply.code(404);
        return { success: false, message: "User not found" };
      }
      return formatUser(
        user,
        request.supervisorUser!.id,
        request.supervisorUser!.permissions,
      );
    },
  );

  // UPDATE USER (admin can update any field; non-admin can only change own password)
  app.put(
    "/:id",
    {
      preHandler: [requireAdminOrSelf],
      schema: {
        description: "Update a user",
        tags: ["Users"],
        params: z.object({ id: z.coerce.number().int() }),
        body: UpdateUserSchema,
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const isAdmin =
        request.supervisorUser!.permissions.includes("supervisor_admin");

      // Non-admins can only change their own password
      const body = isAdmin ? request.body : { password: request.body.password };

      try {
        const user = await userService.updateUser(request.params.id, body);
        authCache.clear();
        return formatUser(
          user,
          request.supervisorUser!.id,
          request.supervisorUser!.permissions,
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
    "/:id",
    {
      preHandler: adminPreHandler,
      schema: {
        description: "Delete a user",
        tags: ["Users"],
        params: z.object({ id: z.coerce.number().int() }),
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      if (request.params.id === request.supervisorUser!.id) {
        reply.code(409);
        return { success: false, message: "Cannot delete yourself" };
      }
      await userService.deleteUser(request.params.id);
      authCache.clear();
      return { success: true, message: "User deleted" };
    },
  );

  // GRANT PERMISSION
  app.post(
    "/:id/permissions",
    {
      preHandler: adminPreHandler,
      schema: {
        description: "Grant a permission to a user",
        tags: ["Users"],
        params: z.object({ id: z.coerce.number().int() }),
        body: GrantPermissionSchema,
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        await userService.grantPermission(
          request.params.id,
          request.body.permission as Permission,
          request.supervisorUser!.id,
        );
        authCache.clear();
        const user = await userService.getUserById(request.params.id);
        return formatUser(
          user,
          request.supervisorUser!.id,
          request.supervisorUser!.permissions,
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("Unique constraint")) {
          reply.code(409);
          return {
            success: false,
            message: "Permission already granted",
          };
        }
        throw err;
      }
    },
  );

  // REVOKE PERMISSION
  app.delete(
    "/:id/permissions/:permission",
    {
      preHandler: adminPreHandler,
      schema: {
        description: "Revoke a permission from a user",
        tags: ["Users"],
        params: z.object({
          id: z.coerce.number().int(),
          permission: z.string(),
        }),
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const { id, permission } = request.params;

      // Cannot revoke own supervisor_admin
      if (
        id === request.supervisorUser!.id &&
        permission === "supervisor_admin"
      ) {
        reply.code(409);
        return {
          success: false,
          message: "Cannot revoke your own supervisor_admin permission",
        };
      }

      await userService.revokePermission(id, permission as Permission);
      authCache.clear();
      const user = await userService.getUserById(id);
      return formatUser(
        user,
        request.supervisorUser!.id,
        request.supervisorUser!.permissions,
      );
    },
  );
}
