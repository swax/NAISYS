import type { FastifyRequest } from "fastify";

import { getUserForRegistrationToken } from "../../services/auth/passkeyService.js";
import { getUserById, getUserPermissions } from "../../services/userService.js";

export async function buildAuthUserResponse(userId: number) {
  const user = await getUserById(userId);
  if (!user) return null;
  const permissions = await getUserPermissions(userId);
  return {
    id: user.id,
    username: user.username,
    permissions,
  };
}

export type RegistrationTarget =
  | {
      ok: true;
      userId: number;
      username: string;
      uuid: string;
      viaToken: true;
      token: string;
    }
  | {
      ok: true;
      userId: number;
      username: string;
      uuid: string;
      viaToken: false;
    }
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
export async function resolveRegistrationTarget(
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
      uuid: lookup.uuid,
      viaToken: true,
      token: tokenCandidate,
    };
  }

  if (request.supervisorUser) {
    return {
      ok: true,
      userId: request.supervisorUser.id,
      username: request.supervisorUser.username,
      uuid: request.supervisorUser.uuid,
      viaToken: false,
    };
  }

  return { ok: false, message: "Registration not authorized" };
}

// Challenge cookies: a single shared name per flow means a second tab
// running the same flow will overwrite the first tab's challenge — at worst
// the first tab's verify call returns "session expired — please retry."
// Acceptable; not a security issue.
export const REG_CHALLENGE_COOKIE = "naisys_passkey_reg_chal";
export const AUTH_CHALLENGE_COOKIE = "naisys_passkey_auth_chal";
export const CHALLENGE_TTL_SECONDS = 5 * 60;

/**
 * Login + registration challenge cookies. Scoped to the passkey-flow paths
 * so other API routes never see them — both options-set and verify-read
 * happen under /supervisor/api/auth/passkey/.
 */
export function passkeyChallengeCookieOptions() {
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
export function stepUpChallengeCookieOptions() {
  return {
    path: "/supervisor/api/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: CHALLENGE_TTL_SECONDS,
  };
}
