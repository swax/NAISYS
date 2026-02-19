import {
  AuthUserSchema,
  ErrorResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  LogoutResponseSchema,
} from "@naisys-supervisor/shared";
import { hashToken } from "@naisys/common-node";
import {
  authenticateAndCreateSession,
  deleteSession,
} from "@naisys/supervisor-database";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { authCache } from "../auth-middleware.js";
import {
  getUserByUsername,
  getUserPermissions,
} from "../services/userService.js";

const COOKIE_NAME = "naisys_session";

let lastLoginRequestTime = 0;

export default async function authRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LOGIN
  app.post(
    "/auth/login",
    {
      schema: {
        description: "Authenticate with username and password",
        tags: ["Authentication"],
        body: LoginRequestSchema,
        response: {
          200: LoginResponseSchema,
          401: ErrorResponseSchema,
          429: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const currentTime = Date.now();

      if (currentTime - lastLoginRequestTime < 5000) {
        reply.code(429);
        return {
          success: false as const,
          message: "Too many requests. Please wait before trying again.",
        };
      }

      lastLoginRequestTime = currentTime;

      const { username, password } = request.body;

      const authResult = await authenticateAndCreateSession(username, password);
      if (!authResult) {
        reply.code(401);
        return {
          success: false as const,
          message: "Invalid username or password",
        };
      }

      reply.setCookie(COOKIE_NAME, authResult.token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: Math.floor(
          (authResult.expiresAt.getTime() - Date.now()) / 1000,
        ),
      });

      const user = await getUserByUsername(username);
      const permissions = user ? await getUserPermissions(user.id) : [];

      return {
        user: {
          id: user?.id ?? 0,
          username: authResult.user.username,
          permissions,
        },
      };
    },
  );

  // LOGOUT
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
      const token = request.cookies?.[COOKIE_NAME];

      // Clear from hub and auth cache
      if (token) {
        const tokenHash = hashToken(token);
        authCache.invalidate(`cookie:${tokenHash}`);
        await deleteSession(tokenHash);
      }

      reply.clearCookie(COOKIE_NAME, { path: "/" });
      return {
        success: true,
        message: "Logged out successfully",
      };
    },
  );

  // ME
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
