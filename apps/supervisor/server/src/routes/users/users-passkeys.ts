import { hashToken, SESSION_COOKIE_NAME } from "@naisys/common-node";
import {
  deleteAllPasskeyCredentialsForUser,
  deleteAllSessionsForUser,
  deletePasskeyCredential,
  listPasskeyCredentialsForUser,
  renamePasskeyDeviceLabel,
  userHasPasskey,
} from "@naisys/supervisor-database";
import {
  ErrorResponseSchema,
  PasskeyCredentialListSchema,
  PasskeyRenameRequestSchema,
  RegistrationTokenResponseSchema,
  StepUpAssertionBodySchema,
  UserActionResultSchema,
} from "@naisys/supervisor-shared";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod/v4";

import { authCache, requirePermission } from "../../authMiddleware.js";
import { conflict, forbidden, notFound } from "../../errorHelpers.js";
import { issueRegistrationLink } from "../../services/auth/passkeyService.js";
import { userHasEnabledPassword } from "../../services/auth/passwordLoginConfig.js";
import { requireStepUp } from "../../services/auth/stepUpService.js";
import { getUserByUsername } from "../../services/userService.js";
import { requireAdminOrSelf } from "./userRouteHelpers.js";

export default function userPasskeyRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const adminPreHandler = [requirePermission("supervisor_admin")];

  const usernameParams = z.object({ username: z.string() });
  const passkeyParams = z.object({
    username: z.string(),
    id: z.coerce.number().int(),
  });

  // LIST PASSKEYS
  app.get(
    "/:username/passkeys",
    {
      preHandler: [requireAdminOrSelf],
      schema: {
        description: "List a user's registered passkeys",
        tags: ["Users"],
        params: usernameParams,
        response: {
          200: PasskeyCredentialListSchema,
          404: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const targetUser = await getUserByUsername(request.params.username);
      if (!targetUser) return notFound(reply, "User not found");

      const credentials = await listPasskeyCredentialsForUser(targetUser.id);
      return {
        credentials: credentials.map((c) => ({
          id: c.id,
          deviceLabel: c.deviceLabel,
          createdAt: c.createdAt.toISOString(),
          lastUsedAt: c.lastUsedAt ? c.lastUsedAt.toISOString() : null,
        })),
      };
    },
  );

  // DELETE PASSKEY (admin or self) — POST not DELETE so we can carry the
  // step-up assertion in the body (some HTTP intermediaries strip DELETE
  // bodies, and we don't want to depend on header-encoded blobs).
  //
  // Step-up is required here specifically to close a session-hijack chain:
  // without it, an attacker holding a stolen cookie could drain a victim's
  // passkeys, and once the victim has zero credentials left, requireStepUp
  // bypasses for all subsequent admin actions on the attacker's session,
  // letting them mint a registration link and enroll their own passkey.
  app.post<{
    Params: z.infer<typeof passkeyParams>;
    Body: z.infer<typeof StepUpAssertionBodySchema>;
  }>(
    "/:username/passkeys/:id/delete",
    {
      preHandler: [requireAdminOrSelf],
      schema: {
        description: "Delete one of a user's registered passkeys",
        tags: ["Users"],
        params: passkeyParams,
        body: StepUpAssertionBodySchema,
        response: {
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
          412: ErrorResponseSchema,
          429: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const stepUp = await requireStepUp(request, reply, request.body);
      if (!stepUp.ok) {
        reply.code(stepUp.status);
        return { success: false as const, message: stepUp.message };
      }

      const targetUser = await getUserByUsername(request.params.username);
      if (!targetUser) return notFound(reply, "User not found");

      const removed = await deletePasskeyCredential(
        request.params.id,
        targetUser.id,
      );
      if (!removed) return notFound(reply, "Passkey not found");

      // Preserve the self-actor's current session only if the account still
      // has a step-up credential after deletion: another passkey, or a
      // password when optional password login is enabled. Any non-actor
      // session is evicted, and step-up still gates further sensitive actions.
      const stillHasPasskey = await userHasPasskey(targetUser.id);
      const stillHasPassword = await userHasEnabledPassword(targetUser.id);
      const actingOnSelf = targetUser.id === request.supervisorUser?.id;
      const cookieToken = request.cookies?.[SESSION_COOKIE_NAME];
      const preserveActorSession =
        (stillHasPasskey || stillHasPassword) && actingOnSelf;
      await deleteAllSessionsForUser(
        targetUser.id,
        preserveActorSession && cookieToken
          ? hashToken(cookieToken)
          : undefined,
      );

      // If the actor just invalidated their own session, tell the browser to
      // drop the now-dead cookie so it doesn't keep presenting it on later
      // requests. Server-side it was already gone after deleteAllSessionsForUser.
      if (actingOnSelf && !preserveActorSession) {
        reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      }

      authCache.clear();
      return { success: true, message: "Passkey removed" };
    },
  );

  // RENAME PASSKEY (admin or self) — pure metadata change, no step-up needed.
  // The browser doesn't tell us which authenticator was actually used at
  // registration (no fingerprinting), so the auto-derived label is just a UA
  // sniff. This lets the user fix it after the fact.
  app.post<{
    Params: z.infer<typeof passkeyParams>;
    Body: z.infer<typeof PasskeyRenameRequestSchema>;
  }>(
    "/:username/passkeys/:id/rename",
    {
      preHandler: [requireAdminOrSelf],
      schema: {
        description: "Rename one of a user's registered passkeys",
        tags: ["Users"],
        params: passkeyParams,
        body: PasskeyRenameRequestSchema,
        response: {
          200: UserActionResultSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
          429: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const targetUser = await getUserByUsername(request.params.username);
      if (!targetUser) return notFound(reply, "User not found");

      const renamed = await renamePasskeyDeviceLabel(
        request.params.id,
        targetUser.id,
        request.body.deviceLabel,
      );
      if (!renamed) return notFound(reply, "Passkey not found");

      return { success: true, message: "Passkey renamed" };
    },
  );

  // ISSUE REGISTRATION TOKEN (admin to invite/reset, or self to add a device)
  //
  // Self-issuance is blocked when the caller has no enabled step-up
  // credential. Passkey users step up with passkeys; password-only users can
  // step up with a password only when ALLOW_PASSWORD_LOGIN=true.
  app.post(
    "/:username/registration-token",
    {
      preHandler: [requireAdminOrSelf],
      schema: {
        description:
          "Issue a one-time registration token for the user. Any prior unused tokens are revoked.",
        tags: ["Users"],
        params: usernameParams,
        body: StepUpAssertionBodySchema,
        response: {
          200: RegistrationTokenResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          412: ErrorResponseSchema,
          429: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const callerId = request.supervisorUser!.id;
      const isSelf =
        request.params.username === request.supervisorUser!.username;
      if (isSelf && !(await userHasPasskey(callerId))) {
        if (!(await userHasEnabledPassword(callerId))) {
          return forbidden(
            reply,
            "First credential setup requires an admin-issued registration link.",
          );
        }
      }
      const stepUp = await requireStepUp(request, reply, request.body);
      if (!stepUp.ok) {
        reply.code(stepUp.status);
        return { success: false as const, message: stepUp.message };
      }
      const targetUser = await getUserByUsername(request.params.username);
      if (!targetUser) return notFound(reply, "User not found");

      const link = await issueRegistrationLink({
        userId: targetUser.id,
        protocol: request.protocol,
        hostHeader: request.headers.host,
      });

      return {
        username: targetUser.username,
        registrationUrl: link.url,
        expiresAt: link.expiresAt.toISOString(),
      };
    },
  );

  // RESET PASSKEYS (admin: wipes all passkeys + issues a fresh registration link)
  app.post(
    "/:username/reset-passkeys",
    {
      preHandler: adminPreHandler,
      schema: {
        description:
          "Wipe all of a user's passkeys and issue a fresh registration token. Use when a user has lost all their devices.",
        tags: ["Users"],
        params: usernameParams,
        body: StepUpAssertionBodySchema,
        response: {
          200: RegistrationTokenResponseSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          412: ErrorResponseSchema,
          429: ErrorResponseSchema,
        },
        security: [{ cookieAuth: [] }],
      },
    },
    async (request, reply) => {
      const stepUp = await requireStepUp(request, reply, request.body);
      if (!stepUp.ok) {
        reply.code(stepUp.status);
        return { success: false as const, message: stepUp.message };
      }
      if (request.params.username === request.supervisorUser!.username) {
        return conflict(
          reply,
          "Use 'Issue Registration Link' on yourself instead",
        );
      }

      const targetUser = await getUserByUsername(request.params.username);
      if (!targetUser) return notFound(reply, "User not found");

      await deleteAllPasskeyCredentialsForUser(targetUser.id);
      // Recovery is the canonical "this user has lost access" action — kill
      // any browser sessions that might still be carrying a session cookie
      // from the prior credentials.
      await deleteAllSessionsForUser(targetUser.id);
      const link = await issueRegistrationLink({
        userId: targetUser.id,
        protocol: request.protocol,
        hostHeader: request.headers.host,
      });

      authCache.clear();
      return {
        username: targetUser.username,
        registrationUrl: link.url,
        expiresAt: link.expiresAt.toISOString(),
      };
    },
  );
}
