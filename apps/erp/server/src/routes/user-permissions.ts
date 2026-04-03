import { ErpPermissionEnum, GrantPermissionSchema } from "@naisys-erp/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import { authCache, requirePermission } from "../auth-middleware.js";
import { mutationResult } from "../route-helpers.js";
import {
  getUserById,
  getUserByUsername,
  grantPermission,
  revokePermission,
  rotateUserApiKey,
} from "../services/user-service.js";
import { formatUser } from "./users.js";

export default function userPermissionRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const adminPreHandler = [requirePermission("erp_admin")];

  const usernameParams = z.object({ username: z.string() });

  // ROTATE API KEY
  app.post(
    "/:username/rotate-key",
    {
      preHandler: adminPreHandler,
      schema: {
        description: "Rotate a user's API key",
        tags: ["Users"],
        params: usernameParams,
      },
    },
    async (request, reply) => {
      const targetUser = await getUserByUsername(request.params.username);
      if (!targetUser) {
        reply.code(404);
        return { success: false, message: "User not found" };
      }
      await rotateUserApiKey(targetUser.id);
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
      },
    },
    async (request, reply) => {
      const targetUser = await getUserByUsername(request.params.username);
      if (!targetUser) {
        reply.code(404);
        return { success: false, message: "User not found" };
      }

      try {
        await grantPermission(
          targetUser.id,
          request.body.permission,
          request.erpUser!.id,
        );
        authCache.clear();
        const user = await getUserById(targetUser.id);
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
    "/:username/permissions/:permission",
    {
      preHandler: adminPreHandler,
      schema: {
        description: "Revoke a permission from a user",
        tags: ["Users"],
        params: z.object({
          username: z.string(),
          permission: ErpPermissionEnum,
        }),
      },
    },
    async (request, reply) => {
      const { username, permission } = request.params;

      // Cannot revoke own erp_admin
      if (
        username === request.erpUser!.username &&
        permission === "erp_admin"
      ) {
        reply.code(409);
        return {
          success: false,
          message: "Cannot revoke your own erp_admin permission",
        };
      }

      const targetUser = await getUserByUsername(username);
      if (!targetUser) {
        reply.code(404);
        return { success: false, message: "User not found" };
      }

      await revokePermission(targetUser.id, permission);
      authCache.clear();
      const user = await getUserById(targetUser.id);
      const full = formatUser(
        user,
        request.erpUser!.id,
        request.erpUser!.permissions,
      );
      return mutationResult(request, reply, full, {
        _actions: full!._actions,
      });
    },
  );
}
