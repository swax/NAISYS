import { hashToken, SESSION_COOKIE_NAME } from "@naisys/common-node";
import {
  clearUserPassword,
  deleteAllSessionsForUser,
  userHasPasskey,
} from "@naisys/supervisor-database";
import {
  ErrorResponseSchema,
  StepUpAssertionBodySchema,
  UserActionResultSchema,
} from "@naisys/supervisor-shared";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import { authCache } from "../../authMiddleware.js";
import { conflict, notFound } from "../../errorHelpers.js";
import { requireStepUp } from "../../services/auth/stepUpService.js";
import { getUserByUsername } from "../../services/userService.js";
import { requireAdminOrSelf } from "./userRouteHelpers.js";

export default function userPasswordRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const usernameParams = z.object({ username: z.string() });

  // CLEAR PASSWORD (admin or self) — only when a passkey remains available.
  app.post(
    "/:username/password/clear",
    {
      preHandler: [requireAdminOrSelf],
      schema: {
        description:
          "Remove a user's password credential. Refuses to remove the password when the user has no passkeys.",
        tags: ["Users"],
        params: usernameParams,
        body: StepUpAssertionBodySchema,
        response: {
          200: UserActionResultSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          412: ErrorResponseSchema,
          429: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const targetUser = await getUserByUsername(request.params.username);
      if (!targetUser) return notFound(reply, "User not found");

      if (!targetUser.passwordHash) {
        return { success: true, message: "Password already removed" };
      }

      if (!(await userHasPasskey(targetUser.id))) {
        return conflict(
          reply,
          "Add a passkey before removing this user's password.",
        );
      }

      const stepUp = await requireStepUp(request, reply, request.body);
      if (!stepUp.ok) {
        reply.code(stepUp.status);
        return { success: false as const, message: stepUp.message };
      }

      await clearUserPassword(targetUser.id);
      // The 409 above guarantees the target had a passkey; clearing the
      // password doesn't touch passkeys, so the actor's current cookie can
      // safely stay alive when self-clearing. All other sessions go.
      const actingOnSelf = targetUser.id === request.supervisorUser?.id;
      const cookieToken = request.cookies?.[SESSION_COOKIE_NAME];
      await deleteAllSessionsForUser(
        targetUser.id,
        actingOnSelf && cookieToken ? hashToken(cookieToken) : undefined,
      );

      authCache.clear();
      return { success: true, message: "Password removed" };
    },
  );
}
