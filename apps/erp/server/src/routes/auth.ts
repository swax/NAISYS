import {
  hashToken,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@naisys/common-node";
import {
  AuthUserSchema,
  ErrorResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
} from "@naisys/erp-shared";
import {
  authenticateAndCreateSession,
  deleteSession,
} from "@naisys/supervisor-database";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import { authCache } from "../auth-middleware.js";
import erpDb from "../erpDb.js";
import { unauthorized } from "../error-handler.js";
import { isSupervisorAuth } from "../supervisorAuth.js";

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export default function authRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // LOGIN
  app.post("/login", {
    config: {
      rateLimit: {
        max: Number(process.env.AUTH_LOGIN_RATE_LIMIT) || 5,
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
          return unauthorized(reply, "Invalid username or password");
        }

        const ssoData = {
          username,
          passwordHash: authResult.user.passwordHash,
        };
        const user = await erpDb.user.upsert({
          where: { uuid: authResult.user.uuid },
          create: { uuid: authResult.user.uuid, ...ssoData },
          update: ssoData,
        });

        reply.setCookie(
          SESSION_COOKIE_NAME,
          authResult.token,
          sessionCookieOptions(authResult.expiresAt),
        );

        return { user: { id: user.id, username: user.username } };
      }

      // Standalone mode: authenticate against local DB
      const user = await erpDb.user.findUnique({ where: { username } });
      if (!user) {
        return unauthorized(reply, "Invalid username or password");
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return unauthorized(reply, "Invalid username or password");
      }

      const token = randomUUID();
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

      await erpDb.session.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });

      reply.setCookie(
        SESSION_COOKIE_NAME,
        token,
        sessionCookieOptions(expiresAt),
      );

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
      const token = request.cookies?.[SESSION_COOKIE_NAME];

      if (token) {
        const tokenHash = hashToken(token);
        authCache.invalidate(`cookie:${tokenHash}`);

        // Delete from local ERP sessions
        await erpDb.session.deleteMany({ where: { tokenHash } });

        // Also delete from supervisor sessions (SSO mode)
        await deleteSession(tokenHash);
      }

      reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
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
        return unauthorized(reply, "Not authenticated");
      }

      return {
        id: request.erpUser.id,
        username: request.erpUser.username,
        permissions: request.erpUser.permissions,
      };
    },
  });
}
