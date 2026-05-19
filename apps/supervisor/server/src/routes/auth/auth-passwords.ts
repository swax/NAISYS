import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@naisys/common-node";
import {
  consumeTokenAndSetPassword,
  createSessionForUser,
  PasswordValidationError,
  verifyPassword,
  verifyUserPassword,
} from "@naisys/supervisor-database";
import {
  AuthUserSchema,
  ErrorResponseSchema,
  PasswordLoginRequestSchema,
  PasswordRegistrationRequestSchema,
  PasswordRegistrationResponseSchema,
  PasswordVerifyRequestSchema,
  PasswordVerifyResponseSchema,
} from "@naisys/supervisor-shared";
import type {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyRequest,
} from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import { badRequest, notFound, unauthorized } from "../../errorHelpers.js";
import { isPasswordLoginAllowed } from "../../services/auth/passwordLoginConfig.js";
import { getUserByUsername } from "../../services/userService.js";
import {
  buildAuthUserResponse,
  resolveRegistrationTarget,
} from "./authHelpers.js";

export default function authPasswordRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // -------- PASSWORD LOGIN --------
  app.post(
    "/auth/password/login",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => req.ip,
        },
      },
      schema: {
        description: "Authenticate with username and password",
        tags: ["Authentication"],
        body: PasswordLoginRequestSchema,
        response: {
          200: AuthUserSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!isPasswordLoginAllowed()) {
        return notFound(reply, "Password login is disabled");
      }

      // Always run bcrypt — verifyPassword falls back to a dummy hash when the
      // user is missing, so timing doesn't reveal whether the username exists.
      const { username, password } = request.body;
      const user = await getUserByUsername(username);
      const valid = await verifyPassword(password, user?.passwordHash);
      if (!user || !valid) {
        return unauthorized(reply, "Invalid username or password");
      }

      const session = await createSessionForUser(user.id);
      reply.setCookie(
        SESSION_COOKIE_NAME,
        session.token,
        sessionCookieOptions(session.expiresAt),
      );

      const authUser = await buildAuthUserResponse(user.id);
      if (!authUser) return unauthorized(reply, "User not found");
      return authUser;
    },
  );

  // -------- PASSWORD REGISTRATION --------
  app.post(
    "/auth/password/register",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => req.ip,
        },
      },
      schema: {
        description: "Set a password using a one-time registration token",
        tags: ["Authentication"],
        body: PasswordRegistrationRequestSchema,
        response: {
          200: PasswordRegistrationResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!isPasswordLoginAllowed()) {
        return notFound(reply, "Password login is disabled");
      }

      const target = await resolveRegistrationTarget(request);
      if (!target.ok) return unauthorized(reply, target.message);
      if (!target.viaToken) {
        return unauthorized(reply, "Registration link is required");
      }

      let consumed: { userId: number; username: string } | null;
      try {
        consumed = await consumeTokenAndSetPassword({
          token: target.token,
          password: request.body.password,
        });
      } catch (err) {
        if (err instanceof PasswordValidationError) {
          return badRequest(reply, err.message);
        }
        throw err;
      }

      if (!consumed) {
        return unauthorized(
          reply,
          "Registration link is no longer valid — request a new one.",
        );
      }

      const session = await createSessionForUser(consumed.userId);
      reply.setCookie(
        SESSION_COOKIE_NAME,
        session.token,
        sessionCookieOptions(session.expiresAt),
      );
      const authUser = await buildAuthUserResponse(consumed.userId);
      return { success: true, user: authUser ?? undefined };
    },
  );

  // -------- PASSWORD VERIFY (own credential, used by step-up modal) --------
  //
  // Lets the password step-up modal pre-validate the user's input so a typo
  // surfaces inline instead of failing the privileged action. Doesn't replace
  // step-up — privileged endpoints still re-verify the password they receive.
  app.post(
    "/auth/password/verify",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => req.ip,
        },
      },
      schema: {
        description: "Verify the current user's password (for step-up UX)",
        tags: ["Authentication"],
        body: PasswordVerifyRequestSchema,
        response: {
          200: PasswordVerifyResponseSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      if (!isPasswordLoginAllowed()) {
        return notFound(reply, "Password login is disabled");
      }
      if (!request.supervisorUser) {
        return unauthorized(reply, "Authentication required");
      }
      const valid = await verifyUserPassword(
        request.supervisorUser.id,
        request.body.password,
      );
      if (!valid) {
        return unauthorized(reply, "Incorrect password");
      }
      return { success: true as const };
    },
  );
}
