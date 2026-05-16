import { randomUUID } from "node:crypto";

import type { VoiceMode } from "@naisys/supervisor-shared";

/**
 * In-memory registry of active voice sessions. Hands out an opaque id at
 * /voice/token mint time, bound to (user, X, Y, mode), checked on every
 * /voice/cost and /voice/tool post. Process-local — restarts invalidate
 * sessions; the client tears down on the next failed post.
 */

const VOICE_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const VOICE_SESSION_SWEEP_INTERVAL_MS = 60 * 1000;

export interface VoiceSessionRecord {
  userUuid: string;
  /** Resolved hub username for X (post-admin-fallback). Follow-up posts must
   *  come from `/agents/{this}/...` — the resolved identity the client echoes. */
  fromUsername: string;
  targetUsername: string;
  /** Re-checked on /voice/tool so a tampered session config can't widen
   *  the toolset past what the mint mode permits. */
  mode: VoiceMode;
  /** Model id this session was minted with. Stashed at mint time so cost
   *  rows attribute the actually-negotiated model even if VOICE_AGENT_MODEL
   *  is changed mid-session. */
  model: string;
  createdAt: number;
  lastSeen: number;
}

const voiceSessions = new Map<string, VoiceSessionRecord>();
let lastSweep = 0;

/** Drop sessions idle past the timeout. Called opportunistically from
 *  register/validate (not on a setInterval) so no background timer holds the
 *  event loop open in tests. */
function maybeSweepExpired(now: number): void {
  if (now - lastSweep < VOICE_SESSION_SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  const cutoff = now - VOICE_SESSION_IDLE_TIMEOUT_MS;
  for (const [id, rec] of voiceSessions) {
    if (rec.lastSeen < cutoff) voiceSessions.delete(id);
  }
}

/** Mint a new voice session id bound to (user, X, Y, mode), checked on every post. */
export function registerVoiceSession(opts: {
  userUuid: string;
  fromUsername: string;
  targetUsername: string;
  mode: VoiceMode;
  model: string;
}): string {
  const now = Date.now();
  maybeSweepExpired(now);
  const id = randomUUID();
  voiceSessions.set(id, {
    userUuid: opts.userUuid,
    fromUsername: opts.fromUsername,
    targetUsername: opts.targetUsername,
    mode: opts.mode,
    model: opts.model,
    createdAt: now,
    lastSeen: now,
  });
  return id;
}

/** Validate a session id against the calling user. Returns the bound record
 *  on success (with `lastSeen` refreshed), or null when the id is unknown,
 *  belongs to a different user, or has gone idle past the timeout. */
export function validateVoiceSession(
  sessionId: string | undefined,
  userUuid: string,
): VoiceSessionRecord | null {
  if (!sessionId) return null;
  const now = Date.now();
  maybeSweepExpired(now);
  const rec = voiceSessions.get(sessionId);
  if (!rec) return null;
  if (rec.userUuid !== userUuid) return null;
  if (now - rec.lastSeen > VOICE_SESSION_IDLE_TIMEOUT_MS) {
    voiceSessions.delete(sessionId);
    return null;
  }
  rec.lastSeen = now;
  return rec;
}
