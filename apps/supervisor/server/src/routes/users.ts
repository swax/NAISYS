import { z } from "zod/v4";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  CreateUserSchema,
  UpdateUserSchema,
  GrantPermissionSchema,
} from "@naisys-supervisor/shared";
import type { Permission } from "../generated/prisma/client.js";
import { requirePermission, authCache } from "../auth-middleware.js";
import * as userService from "../services/userService.js";
import {
  userItemLinks,
  userActions,
  permissionActions,
  paginationLinks,
  selfLink,
  collectionLink,
} from "../hateoas.js";

function formatUser(
  user: Awaited<ReturnType<typeof userService.getUserById>>,
  currentUserId: number,
) {
  if (!user) return null;
  const isSelf = user.id === currentUserId;
  return {
    id: user.id,
    username: user.username,
    authType: user.authType,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    permissions: user.permissions.map((p) => ({
      permission: p.permission,
      grantedAt: p.grantedAt.toISOString(),
      grantedBy: p.grantedBy,
      _actions: permissionActions(user.id, p.permission, isSelf),
    })),
    _links: userItemLinks(user.id),
    _actions: userActions(user.id, isSelf),
  };
}

function formatListUser(
  user: Awaited<ReturnType<typeof userService.listUsers>>["items"][number],
) {
  return {
    id: user.id,
    username: user.username,
    authType: user.authType,
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
        return formatUser(user, request.supervisorUser!.id);
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.message.includes("Unique constraint")
        ) {
          reply.code(409);
          return { success: false, message: "Username already exists" };
        }
        throw err;
      }
    },
  );

  // GET USER
  app.get(
    "/:id",
    {
      preHandler: adminPreHandler,
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
      return formatUser(user, request.supervisorUser!.id);
    },
  );

  // UPDATE USER
  app.put(
    "/:id",
    {
      preHandler: adminPreHandler,
      schema: {
        description: "Update a user",
        tags: ["Users"],
        params: z.object({ id: z.coerce.number().int() }),
        body: UpdateUserSchema,
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      try {
        const user = await userService.updateUser(
          request.params.id,
          request.body,
        );
        authCache.clear();
        return formatUser(user, request.supervisorUser!.id);
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.message.includes("Unique constraint")
        ) {
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
        return formatUser(user, request.supervisorUser!.id);
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.message.includes("Unique constraint")
        ) {
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
      return formatUser(user, request.supervisorUser!.id);
    },
  );
}
