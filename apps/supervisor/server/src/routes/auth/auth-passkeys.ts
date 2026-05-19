import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@naisys/common-node";
import {
  createSessionForUser,
  userHasPasskey,
} from "@naisys/supervisor-database";
import {
  AuthUserSchema,
  ErrorResponseSchema,
  PasskeyAuthenticationOptionsSchema,
  PasskeyAuthenticationVerifySchema,
  PasskeyRegistrationOptionsRequestSchema,
  PasskeyRegistrationOptionsSchema,
  PasskeyRegistrationVerifyResponseSchema,
  PasskeyRegistrationVerifySchema,
  StepUpOptionsResponseSchema,
} from "@naisys/supervisor-shared";
import type {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyRequest,
} from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import { unauthorized } from "../../errorHelpers.js";
import {
  consumeTokenAndStoreVerifiedCredential,
  generatePasskeyAuthenticationOptions,
  generatePasskeyRegistrationOptions,
  generatePasskeyStepUpOptions,
  getExpectedOrigin,
  rpIdFromHost,
  storeVerifiedCredentialForUser,
  verifyAuthentication,
  verifyRegistration,
} from "../../services/auth/passkeyService.js";
import { userHasEnabledPassword } from "../../services/auth/passwordLoginConfig.js";
import {
  requireStepUp,
  STEPUP_CHALLENGE_COOKIE,
} from "../../services/auth/stepUpService.js";
import {
  AUTH_CHALLENGE_COOKIE,
  buildAuthUserResponse,
  passkeyChallengeCookieOptions,
  REG_CHALLENGE_COOKIE,
  resolveRegistrationTarget,
  stepUpChallengeCookieOptions,
} from "./authHelpers.js";

export default function authPasskeyRoutes(
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
        // Caller has no passkeys on file. requireStepUp will fall back to a
        // fresh password for password-only users when the feature is enabled.
        if (await userHasEnabledPassword(request.supervisorUser.id)) {
          return { needsStepUp: true, method: "password" as const };
        }
        return { needsStepUp: false };
      }
      reply.setCookie(
        STEPUP_CHALLENGE_COOKIE,
        options.challenge,
        stepUpChallengeCookieOptions(),
      );
      return { needsStepUp: true, method: "passkey" as const, options };
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
        userUuid: target.uuid,
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
}
