import {
  userHasPasskey,
  verifyUserPassword,
} from "@naisys/supervisor-database";
import type { FastifyReply, FastifyRequest } from "fastify";

import {
  getExpectedOrigin,
  rpIdFromHost,
  verifyAuthentication,
} from "./passkeyService.js";
import { userHasEnabledPassword } from "./passwordLoginConfig.js";

export const STEPUP_CHALLENGE_COOKIE = "naisys_passkey_stepup_chal";
const PASSWORD_STEPUP_MAX_ATTEMPTS = 10;
const PASSWORD_STEPUP_WINDOW_MS = 60 * 1000;
// Sweep expired entries every Nth reservation so the map can't grow without
// bound under a long-lived process. Cheap (O(map size) per sweep) and lazy.
const PASSWORD_STEPUP_SWEEP_EVERY = 100;

// Process-local rate limiter for password step-up. Keyed by `${userId}:${ip}`:
// 10 wrong attempts per (user, IP) pair per minute. The combined key is
// chosen to minimize false-positive lockouts, not to maximize attacker pain:
//   - including userId means a noisy attacker hitting userA from one IP
//     doesn't burn through userB's quota on the same IP (e.g. shared NAT);
//   - including ip means one user's typos don't lock out coworkers behind
//     the same egress.
// Tradeoff: a distributed attacker rotating IPs against a single user gets
// fresh capacity per IP, so this isn't a hard cap on guesses-per-user. If
// that matters, layer a second userId-only bucket on top.
// Also note: in-memory means it doesn't survive restarts and isn't shared
// across supervisor instances. Adequate for single-process deployments; a
// multi-node deploy would want this in Redis or similar.
const passwordStepUpAttempts = new Map<
  string,
  { count: number; resetAt: number }
>();
let sweepCounter = 0;

export type StepUpResult =
  | { ok: true }
  | { ok: false; status: 401 | 412 | 429; message: string };

/**
 * Require a fresh credential proof from the calling user. Called inside
 * privileged route handlers (issue-registration, reset-passkeys, create
 * user) to defend against session-cookie hijack. Returns ok: true on success,
 * or a structured failure the route can forward to the client.
 *
 * Passkeys have precedence. Password step-up is accepted only for users with
 * no passkeys, a password on file, and ALLOW_PASSWORD_LOGIN=true. If neither
 * credential exists, preserve the legacy/bootstrap bypass rather than
 * locking recovery sessions out.
 *
 * Replay tradeoff: passkey step-up uses a fresh server-issued challenge per
 * call, so a captured assertion can't be reused. Password step-up just
 * re-verifies bcrypt — an attacker who has both the session cookie and the
 * password (e.g. via keylogger or phishing) can satisfy step-up indefinitely.
 * Passkey users keep the stronger guarantee; the password path is an opt-in
 * usability fallback.
 */
export async function requireStepUp(
  request: FastifyRequest,
  reply: FastifyReply,
  body: { stepUpAssertion?: unknown; stepUpPassword?: unknown },
): Promise<StepUpResult> {
  const callerId = request.supervisorUser?.id;
  if (callerId == null) {
    return { ok: false, status: 401, message: "Authentication required" };
  }

  if (!(await userHasPasskey(callerId))) {
    if (await userHasEnabledPassword(callerId)) {
      const password = body.stepUpPassword;
      if (typeof password !== "string" || password.length === 0) {
        return {
          ok: false,
          status: 412,
          message: "Re-enter your password to continue.",
        };
      }

      if (!reservePasswordStepUpAttempt(request, callerId)) {
        return {
          ok: false,
          status: 429,
          message: "Too many password step-up attempts. Try again later.",
        };
      }

      const verified = await verifyUserPassword(callerId, password);
      if (!verified) {
        return {
          ok: false,
          status: 401,
          message: "Password step-up failed",
        };
      }

      clearPasswordStepUpAttempts(request, callerId);
      return { ok: true };
    }

    // Bypass: no enabled credential exists to step up with.
    return { ok: true };
  }

  const assertion = body.stepUpAssertion;
  if (
    assertion == null ||
    typeof assertion !== "object" ||
    !("id" in (assertion as object))
  ) {
    return {
      ok: false,
      status: 412,
      message: "Re-verify your passkey to continue.",
    };
  }

  const challenge = request.cookies?.[STEPUP_CHALLENGE_COOKIE];
  if (!challenge) {
    return {
      ok: false,
      status: 412,
      message: "Step-up session expired — re-verify your passkey.",
    };
  }

  const rpId = rpIdFromHost(request.headers.host);
  const origin = getExpectedOrigin(request);

  // verifyAuthentication advances the credential's signature counter as a
  // side effect, so a single assertion can't be replayed against another
  // step-up attempt.
  const verification = await verifyAuthentication({
    response: assertion as Parameters<
      typeof verifyAuthentication
    >[0]["response"],
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
  });

  reply.clearCookie(STEPUP_CHALLENGE_COOKIE, { path: "/supervisor/api/" });

  if (!verification.verified || verification.userId !== callerId) {
    return {
      ok: false,
      status: 401,
      message: "Step-up verification failed",
    };
  }

  return { ok: true };
}

function passwordStepUpKey(request: FastifyRequest, userId: number): string {
  return `${userId}:${request.ip ?? "unknown"}`;
}

function reservePasswordStepUpAttempt(
  request: FastifyRequest,
  userId: number,
): boolean {
  const key = passwordStepUpKey(request, userId);
  const now = Date.now();

  sweepCounter += 1;
  if (sweepCounter >= PASSWORD_STEPUP_SWEEP_EVERY) {
    sweepCounter = 0;
    sweepExpiredAttempts(now);
  }

  const existing = passwordStepUpAttempts.get(key);

  if (!existing || existing.resetAt <= now) {
    passwordStepUpAttempts.set(key, {
      count: 1,
      resetAt: now + PASSWORD_STEPUP_WINDOW_MS,
    });
    return true;
  }

  if (existing.count >= PASSWORD_STEPUP_MAX_ATTEMPTS) return false;
  existing.count += 1;
  return true;
}

function sweepExpiredAttempts(now: number): void {
  for (const [key, entry] of passwordStepUpAttempts) {
    if (entry.resetAt <= now) passwordStepUpAttempts.delete(key);
  }
}

function clearPasswordStepUpAttempts(
  request: FastifyRequest,
  userId: number,
): void {
  passwordStepUpAttempts.delete(passwordStepUpKey(request, userId));
}

export function resetPasswordStepUpRateLimitForTests(): void {
  passwordStepUpAttempts.clear();
  sweepCounter = 0;
}
