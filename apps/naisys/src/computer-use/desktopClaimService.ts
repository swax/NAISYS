/**
 * Host-level cooperative claim on the shared desktop — one display, multiple
 * agents. Auto-expires after STALE_AFTER_MS of inactivity so a crashed agent
 * can't lock the desktop forever if cleanup didn't run.
 */

const STALE_AFTER_MS = 10 * 60 * 1000;

type Claim = {
  agentUsername: string;
  claimedAt: Date;
  lastUsedAt: Date;
};

export type ClaimAttempt =
  | { ok: true; took: "fresh" | "refreshed" | "stolen-stale" }
  | { ok: false; holderUsername: string; lastUsedAt: Date };

export type ClaimStatus = {
  agentUsername: string;
  claimedAt: Date;
  lastUsedAt: Date;
  isStale: boolean;
};

export function createDesktopClaimService() {
  let claim: Claim | null = null;

  function isStale(c: Claim, now: Date): boolean {
    return now.getTime() - c.lastUsedAt.getTime() > STALE_AFTER_MS;
  }

  return {
    /** Succeeds when free, held by this agent, or held by a stale agent. */
    tryClaim(agentUsername: string): ClaimAttempt {
      const now = new Date();
      if (claim && claim.agentUsername !== agentUsername && !isStale(claim, now)) {
        return {
          ok: false,
          holderUsername: claim.agentUsername,
          lastUsedAt: claim.lastUsedAt,
        };
      }
      let took: "fresh" | "refreshed" | "stolen-stale";
      if (!claim) {
        took = "fresh";
        claim = { agentUsername, claimedAt: now, lastUsedAt: now };
      } else if (claim.agentUsername === agentUsername) {
        took = "refreshed";
        claim.lastUsedAt = now;
      } else {
        took = "stolen-stale";
        claim = { agentUsername, claimedAt: now, lastUsedAt: now };
      }
      return { ok: true, took };
    },

    // Scoped to the agent so a late cleanup from a stale-then-stolen-from
    // holder can't clear the new owner's claim.
    release(agentUsername: string): boolean {
      if (claim && claim.agentUsername === agentUsername) {
        claim = null;
        return true;
      }
      return false;
    },

    getStatus(): ClaimStatus | null {
      if (!claim) return null;
      return {
        agentUsername: claim.agentUsername,
        claimedAt: claim.claimedAt,
        lastUsedAt: claim.lastUsedAt,
        isStale: isStale(claim, new Date()),
      };
    },
  };
}

export type DesktopClaimService = ReturnType<typeof createDesktopClaimService>;
