import {
  hashToken,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@naisys/common-node";
import {
  createSessionForUser,
  deleteSession,
  userHasPasskey,
} from "@naisys/supervisor-database";
import {
  AuthUserSchema,
  ErrorResponseSchema,
  LogoutResponseSchema,
  PasskeyAuthenticationOptionsSchema,
  PasskeyAuthenticationVerifySchema,
  PasskeyRegistrationOptionsRequestSchema,
  PasskeyRegistrationOptionsSchema,
  PasskeyRegistrationVerifyResponseSchema,
  PasskeyRegistrationVerifySchema,
  RegistrationTokenLookupResponseSchema,
  StepUpOptionsResponseSchema,
} from "@naisys/supervisor-shared";
import type {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyRequest,
} from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import { authCache } from "../auth-middleware.js";
import { unauthorized } from "../error-helpers.js";
import {
  consumeTokenAndStoreVerifiedCredential,
  generatePasskeyAuthenticationOptions,
  generatePasskeyRegistrationOptions,
  generatePasskeyStepUpOptions,
  getExpectedOrigin,
  getUserForRegistrationToken,
  rpIdFromHost,
  storeVerifiedCredentialForUser,
  verifyAuthentication,
  verifyRegistration,
} from "../services/passkeyService.js";
import {
  requireStepUp,
  STEPUP_CHALLENGE_COOKIE,
} from "../services/stepUpService.js";
import { getUserById, getUserPermissions } from "../services/userService.js";

// Challenge cookies: a single shared name per flow means a second tab
// running the same flow will overwrite the first tab's challenge — at worst
// the first tab's verify call returns "session expired — please retry."
// Acceptable; not a security issue.
const REG_CHALLENGE_COOKIE = "naisys_passkey_reg_chal";
const AUTH_CHALLENGE_COOKIE = "naisys_passkey_auth_chal";
const CHALLENGE_TTL_SECONDS = 5 * 60;

/**
 * Login + registration challenge cookies. Scoped to the passkey-flow paths
 * so other API routes never see them — both options-set and verify-read
 * happen under /supervisor/api/auth/passkey/.
 */
function passkeyChallengeCookieOptions() {
  return {
    path: "/supervisor/api/auth/passkey/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: CHALLENGE_TTL_SECONDS,
  };
}

/**
 * Step-up challenge cookie. Set at /auth/passkey/stepup-options but read by
 * the privileged endpoints under /users/, so the path has to be the broader
 * /supervisor/api/.
 */
function stepUpChallengeCookieOptions() {
  return {
    path: "/supervisor/api/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: CHALLENGE_TTL_SECONDS,
  };
}

async function buildAuthUserResponse(userId: number) {
  const user = await getUserById(userId);
  if (!user) return null;
  const permissions = await getUserPermissions(userId);
  return {
    id: user.id,
    username: user.username,
    permissions,
  };
}

export default function authRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // -------- LOGIN: options --------
  app.post(
    "/auth/passkey/login-options",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => req.ip,
        },
      },
      schema: {
        description: "Generate WebAuthn authentication options",
        tags: ["Authentication"],
        response: {
          200: PasskeyAuthenticationOptionsSchema,
          429: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const rpId = rpIdFromHost(request.headers.host);
      const options = await generatePasskeyAuthenticationOptions(rpId);
      reply.setCookie(
        AUTH_CHALLENGE_COOKIE,
        options.challenge,
        passkeyChallengeCookieOptions(),
      );
      return { options };
    },
  );

  // -------- STEP-UP: options --------
  // Sensitive actions (issuing registration links, wiping passkeys, creating
  // users) require a fresh passkey assertion before they're allowed. The
  // client calls this endpoint, runs the assertion in the browser, then
  // sends the response inside the privileged endpoint's body. Server-side
  // verification happens in `requireStepUp` below.
  app.post(
    "/auth/passkey/stepup-options",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => req.ip,
        },
      },
      schema: {
        description: "Generate WebAuthn step-up assertion options",
        tags: ["Authentication"],
        response: {
          200: StepUpOptionsResponseSchema,
          401: ErrorResponseSchema,
          429: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      if (!request.supervisorUser) {
        return unauthorized(reply, "Authentication required");
      }
      const rpId = rpIdFromHost(request.headers.host);
      const options = await generatePasskeyStepUpOptions({
        userId: request.supervisorUser.id,
        rpId,
      });
      if (!options) {
        // Caller has no passkeys on file — bypass step-up rather than lock
        // them out of any privileged action.
        return { needsStepUp: false };
      }
      reply.setCookie(
        STEPUP_CHALLENGE_COOKIE,
        options.challenge,
        stepUpChallengeCookieOptions(),
      );
      return { needsStepUp: true, options };
    },
  );

  // -------- LOGIN: verify --------
  app.post(
    "/auth/passkey/login-verify",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => req.ip,
        },
      },
      schema: {
        description: "Verify WebAuthn authentication response",
        tags: ["Authentication"],
        body: PasskeyAuthenticationVerifySchema,
        response: {
          200: AuthUserSchema,
          401: ErrorResponseSchema,
          429: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const challenge = request.cookies?.[AUTH_CHALLENGE_COOKIE];
      if (!challenge) {
        return unauthorized(reply, "Login session expired — please retry.");
      }
      const rpId = rpIdFromHost(request.headers.host);
      const origin = getExpectedOrigin(request);

      const result = await verifyAuthentication({
        response: request.body.response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
      });

      reply.clearCookie(AUTH_CHALLENGE_COOKIE, {
        path: "/supervisor/api/auth/passkey/",
      });

      if (!result.verified || result.userId == null) {
        return unauthorized(reply, "Passkey verification failed");
      }

      const session = await createSessionForUser(result.userId);
      reply.setCookie(
        SESSION_COOKIE_NAME,
        session.token,
        sessionCookieOptions(session.expiresAt),
      );

      const authUser = await buildAuthUserResponse(result.userId);
      if (!authUser) return unauthorized(reply, "User not found");
      return authUser;
    },
  );

  // -------- REGISTER: options (token-bearer or authenticated user) --------
  //
  // Two entry paths, with very different authorization requirements:
  //   1. Anonymous / token path — caller holds a one-time registration token.
  //      The token itself is the authorization proof; no step-up.
  //   2. Authenticated, no-token path — caller is signed in and adding an
  //      *additional* passkey. We require step-up so a hijacked session
  //      cookie can't silently mint a new persistent credential.
  //
  // The authenticated-no-token path is *forbidden* when the caller has zero
  // passkeys. That case must go through the token path (admin issues a link)
  // — otherwise a hijacked session on a fresh account could enroll the first
  // credential without ever proving the legitimate human is present.
  app.post(
    "/auth/passkey/register-options",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => req.ip,
        },
      },
      schema: {
        description: "Generate WebAuthn registration options",
        tags: ["Authentication"],
        body: PasskeyRegistrationOptionsRequestSchema,
        response: {
          200: PasskeyRegistrationOptionsSchema,
          401: ErrorResponseSchema,
          412: ErrorResponseSchema,
          429: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const target = await resolveRegistrationTarget(request);
      if (!target.ok) return unauthorized(reply, target.message);

      if (!target.viaToken) {
        if (!(await userHasPasskey(target.userId))) {
          // Strict policy: refuse to bootstrap a first passkey from an
          // authenticated session. The legitimate path is a registration
          // link issued by an admin (or by the user from another already-
          // enrolled device).
          reply.code(412);
          return {
            success: false as const,
            message: "Use a registration link to enroll your first passkey.",
          };
        }
        const stepUp = await requireStepUp(request, reply, request.body);
        if (!stepUp.ok) {
          reply.code(stepUp.status);
          return { success: false as const, message: stepUp.message };
        }
      }

      const rpId = rpIdFromHost(request.headers.host);
      const options = await generatePasskeyRegistrationOptions({
        userId: target.userId,
        username: target.username,
        rpId,
      });

      reply.setCookie(
        REG_CHALLENGE_COOKIE,
        options.challenge,
        passkeyChallengeCookieOptions(),
      );
      return { username: target.username, options };
    },
  );

  // -------- REGISTER: verify --------
  app.post(
    "/auth/passkey/register-verify",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          keyGenerator: (req: FastifyRequest) => req.ip,
        },
      },
      schema: {
        description: "Verify WebAuthn registration response",
        tags: ["Authentication"],
        body: PasskeyRegistrationVerifySchema,
        response: {
          200: PasskeyRegistrationVerifyResponseSchema,
          401: ErrorResponseSchema,
          429: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const target = await resolveRegistrationTarget(request);
      if (!target.ok) return unauthorized(reply, target.message);

      const challenge = request.cookies?.[REG_CHALLENGE_COOKIE];
      if (!challenge) {
        return unauthorized(
          reply,
          "Registration session expired — please retry.",
        );
      }
      const rpId = rpIdFromHost(request.headers.host);
      const origin = getExpectedOrigin(request);

      // Crypto-verify first (no DB writes). Then either consume-token-and-store
      // atomically, or store directly under the authenticated session — never
      // the order "store, then consume" which races on shared tokens.
      const verified = await verifyRegistration({
        response: request.body.response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
      });

      reply.clearCookie(REG_CHALLENGE_COOKIE, {
        path: "/supervisor/api/auth/passkey/",
      });

      if (!verified) return unauthorized(reply, "Passkey registration failed");

      if (target.viaToken) {
        const consumed = await consumeTokenAndStoreVerifiedCredential({
          token: target.token,
          verified,
          deviceLabel: request.body.deviceLabel,
        });
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
      }

      // Authenticated path: add a credential to the existing user.
      await storeVerifiedCredentialForUser({
        userId: target.userId,
        verified,
        deviceLabel: request.body.deviceLabel,
      });
      return { success: true };
    },
  );

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

type RegistrationTarget =
  | {
      ok: true;
      userId: number;
      username: string;
      viaToken: true;
      token: string;
    }
  | { ok: true; userId: number; username: string; viaToken: false }
  | { ok: false; message: string };

/**
 * A registration request can come from either:
 *  - An anonymous client holding a one-time registration token (token wins),
 *    OR
 *  - An already-signed-in user adding an additional passkey (no token).
 *
 * Token-first ordering is important: if an admin happens to be signed in and
 * clicks someone else's invite link, we must NOT silently bind the new
 * passkey to the admin account. Reject token+session mismatches outright so
 * the operator notices and signs out (or uses a private window).
 */
async function resolveRegistrationTarget(
  request: FastifyRequest,
): Promise<RegistrationTarget> {
  const body = request.body as { token?: unknown } | undefined;
  const query = request.query as { token?: unknown } | undefined;
  const tokenCandidate =
    typeof body?.token === "string"
      ? body.token
      : typeof query?.token === "string"
        ? query.token
        : undefined;

  if (tokenCandidate) {
    const lookup = await getUserForRegistrationToken(tokenCandidate);
    if (!lookup) {
      return { ok: false, message: "Registration link is invalid or expired" };
    }
    if (request.supervisorUser && request.supervisorUser.id !== lookup.userId) {
      return {
        ok: false,
        message:
          "Sign out of the current session before opening a registration link for a different user.",
      };
    }
    return {
      ok: true,
      userId: lookup.userId,
      username: lookup.username,
      viaToken: true,
      token: tokenCandidate,
    };
  }

  if (request.supervisorUser) {
    return {
      ok: true,
      userId: request.supervisorUser.id,
      username: request.supervisorUser.username,
      viaToken: false,
    };
  }

  return { ok: false, message: "Registration not authorized" };
}
