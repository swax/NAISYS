import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  ErrorResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  AuthUserSchema,
} from "@naisys-erp/shared";
import prisma from "../db.js";
import { sendError } from "../error-handler.js";
import { authCache } from "../auth-middleware.js";
import {
  authenticateAndCreateSession,
  deleteSession,
} from "@naisys/supervisor-database";
import { hashToken } from "@naisys/common-node";
import { isSupervisorAuth } from "../supervisorAuth.js";

const COOKIE_NAME = "naisys_session";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export default async function authRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LOGIN
  app.post("/login", {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: "1 minute",
      },
    },
    schema: {
      description: "Authenticate with username and password",
      tags: ["Auth"],
      body: LoginRequestSchema,
      response: {
        200: LoginResponseSchema,
        401: ErrorResponseSchema,
        429: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { username, password } = request.body;

      // SSO mode: authenticate against supervisor DB
      if (isSupervisorAuth()) {
        const authResult = await authenticateAndCreateSession(
          username,
          password,
        );
        if (!authResult) {
          return sendError(
            reply,
            401,
            "Unauthorized",
            "Invalid username or password",
          );
        }

        const ssoData = {
          username,
          passwordHash: authResult.user.passwordHash,
          sessionTokenHash: "!sso",
          sessionExpiresAt: authResult.expiresAt,
        };
        const user = await prisma.user.upsert({
          where: { uuid: authResult.user.uuid },
          create: { uuid: authResult.user.uuid, ...ssoData },
          update: ssoData,
        });

        reply.setCookie(COOKIE_NAME, authResult.token, {
          path: "/",
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          maxAge: (authResult.expiresAt.getTime() - Date.now()) / 1000,
        });

        return { user: { id: user.id, username: user.username } };
      }

      // Standalone mode: authenticate against local DB
      const user = await prisma.user.findUnique({ where: { username } });
      if (!user) {
        return sendError(
          reply,
          401,
          "Unauthorized",
          "Invalid username or password",
        );
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return sendError(
          reply,
          401,
          "Unauthorized",
          "Invalid username or password",
        );
      }

      const token = randomUUID();
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

      await prisma.user.update({
        where: { id: user.id },
        data: { sessionTokenHash: tokenHash, sessionExpiresAt: expiresAt },
      });

      reply.setCookie(COOKIE_NAME, token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: SESSION_DURATION_MS / 1000,
      });

      return { user: { id: user.id, username: user.username } };
    },
  });

  // LOGOUT
  app.post("/logout", {
    schema: {
      description: "Log out and clear session",
      tags: ["Auth"],
    },
    handler: async (request, reply) => {
      const token = request.cookies?.[COOKIE_NAME];

      if (request.erpUser) {
        await prisma.user.update({
          where: { id: request.erpUser.id },
          data: {
            sessionTokenHash: null,
            sessionExpiresAt: null,
          },
        });
      }

      // Also clear from hub and auth cache
      if (token) {
        const tokenHash = hashToken(token);
        authCache.invalidate(`cookie:${tokenHash}`);
        await deleteSession(tokenHash);
      }

      reply.clearCookie(COOKIE_NAME, { path: "/" });
      return { ok: true };
    },
  });

  // ME
  app.get("/me", {
    schema: {
      description: "Get current authenticated user",
      tags: ["Auth"],
      response: {
        200: AuthUserSchema,
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      if (!request.erpUser) {
        return sendError(reply, 401, "Unauthorized", "Not authenticated");
      }

      return request.erpUser;
    },
  });
}
