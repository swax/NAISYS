import { userHasPasskey } from "@naisys/supervisor-database";
import type { FastifyReply, FastifyRequest } from "fastify";

import {
  getExpectedOrigin,
  rpIdFromHost,
  verifyAuthentication,
} from "./passkeyService.js";

export const STEPUP_CHALLENGE_COOKIE = "naisys_passkey_stepup_chal";

export type StepUpResult =
  | { ok: true }
  | { ok: false; status: 401 | 412; message: string };

/**
 * Require a fresh passkey assertion from the calling user. Called inside
 * privileged route handlers (issue-registration, reset-passkeys, create
 * user) to defend against session-cookie hijack. Returns ok: true on success,
 * or a structured failure the route can forward to the client.
 *
 * Bypassed only when the caller has no passkeys at all — the rare case where
 * requiring step-up would lock a legitimately privileged user (e.g. an admin
 * authenticated via API key) out of necessary actions.
 */
export async function requireStepUp(
  request: FastifyRequest,
  reply: FastifyReply,
  body: { stepUpAssertion?: unknown },
): Promise<StepUpResult> {
  const callerId = request.supervisorUser?.id;
  if (callerId == null) {
    return { ok: false, status: 401, message: "Authentication required" };
  }

  if (!(await userHasPasskey(callerId))) {
    // Bypass: nothing to step up with.
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
