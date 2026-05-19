import { hashToken, SESSION_COOKIE_NAME } from "@naisys/common-node";
import { deleteSession } from "@naisys/supervisor-database";
import {
  AuthUserSchema,
  ErrorResponseSchema,
  LogoutResponseSchema,
  RegistrationTokenLookupResponseSchema,
} from "@naisys/supervisor-shared";
import type {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyRequest,
} from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import { authCache } from "../../authMiddleware.js";
import { getUserForRegistrationToken } from "../../services/auth/passkeyService.js";
import authPasskeyRoutes from "./auth-passkeys.js";
import authPasswordRoutes from "./auth-passwords.js";

export default async function authRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  await fastify.register(authPasskeyRoutes);
  await fastify.register(authPasswordRoutes);

  // -------- Lookup: validate a registration token (for the register page) --------
  app.get(
    "/auth/registration-token/lookup",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => req.ip,
        },
      },
      schema: {
        description:
          "Validate a registration token and return the target username",
        tags: ["Authentication"],
        querystring: z.object({ token: z.string() }),
        response: {
          200: RegistrationTokenLookupResponseSchema,
          404: ErrorResponseSchema,
          429: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const lookup = await getUserForRegistrationToken(request.query.token);
      if (!lookup) {
        return reply.code(404).send({
          success: false,
          message: "Token is invalid or expired",
        });
      }
      return { username: lookup.username };
    },
  );

  // -------- LOGOUT --------
  app.post(
    "/auth/logout",
    {
      schema: {
        description: "Log out and clear session",
        tags: ["Authentication"],
        response: {
          200: LogoutResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const token = request.cookies?.[SESSION_COOKIE_NAME];

      if (token) {
        const tokenHash = hashToken(token);
        authCache.invalidate(`cookie:${tokenHash}`);
        await deleteSession(tokenHash);
      }

      reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      return {
        success: true,
        message: "Logged out successfully",
      };
    },
  );

  // -------- ME --------
  app.get(
    "/auth/me",
    {
      schema: {
        description: "Get current authenticated user",
        tags: ["Authentication"],
        response: {
          200: AuthUserSchema,
          401: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      if (!request.supervisorUser) {
        reply.code(401);
        return {
          success: false as const,
          message: "Not authenticated",
        };
      }

      return request.supervisorUser;
    },
  );
}
