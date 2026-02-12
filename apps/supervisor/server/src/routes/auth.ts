import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import {
  AuthUserSchema,
  ErrorResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  LogoutResponseSchema,
} from "@naisys-supervisor/shared";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  createHubSession,
  deleteHubSession,
  findHubUserByUsername,
  isHubAvailable,
} from "@naisys/database";
import {
  clearSessionOnUser,
  createUser,
  getUserByUsername,
  hashToken,
  setSessionOnUser,
} from "../services/userService.js";

const COOKIE_NAME = "naisys_session";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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

      let user = await getUserByUsername(username);
      let passwordVerified = false;

      // If not found locally, check hub for credentials and auto-provision
      if (!user && isHubAvailable()) {
        const hubUser = await findHubUserByUsername(username);
        if (hubUser) {
          const valid = await bcrypt.compare(password, hubUser.password_hash);
          if (valid) {
            user = await createUser(
              hubUser.username,
              hubUser.password_hash,
              hubUser.uuid,
            );
            passwordVerified = true;
          }
        }
      }

      if (!user) {
        reply.code(401);
        return {
          success: false as const,
          message: "Invalid username or password",
        };
      }

      if (!passwordVerified) {
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
          reply.code(401);
          return {
            success: false as const,
            message: "Invalid username or password",
          };
        }
      }

      const token = randomUUID();
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

      if (isHubAvailable()) {
        // SSO mode: hub is source of truth for sessions
        await createHubSession(
          tokenHash,
          user.username,
          user.password_hash,
          user.uuid,
          "supervisor",
          expiresAt,
        );
        await setSessionOnUser(user.id, "!sso", expiresAt);
      } else {
        // Standalone mode: local session only
        await setSessionOnUser(user.id, tokenHash, expiresAt);
      }

      reply.setCookie(COOKIE_NAME, token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: SESSION_DURATION_MS / 1000,
      });

      return {
        user: {
          id: user.id,
          username: user.username,
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

      if (request.supervisorUser) {
        await clearSessionOnUser(request.supervisorUser.id);
      }

      // Also clear from hub
      if (token) {
        const tokenHash = hashToken(token);
        await deleteHubSession(tokenHash);
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
