import { CODEX_REFRESH_TOKEN_VAR } from "@naisys/common";
import {
  createCodexAccessTokenProvider,
  type DualLogger,
} from "@naisys/common-node";
import type { HubDatabaseService } from "@naisys/hub-database";
import {
  CodexAccessTokenRequestSchema,
  HubEvents,
} from "@naisys/hub-protocol";

import type { HubRedactionService } from "../observability/hubRedactionService.js";
import type { NaisysServer } from "../server/naisysServer.js";

// During an OpenAI auth outage, hold a failure for this long before retrying
// so N agents retrying their LLM queries don't fan out into N /oauth/token
// POSTs. VARIABLES_CHANGED clears this on re-auth.
const REFRESH_FAILURE_COOLDOWN_MS = 15_000;

/** Mints OpenAI Codex access tokens for agents/supervisor. Single owner of the refresh token. */
export function createHubCodexAuthService(
  naisysServer: NaisysServer,
  { hubDb }: HubDatabaseService,
  redactionService: HubRedactionService,
  logService: DualLogger,
) {
  const provider = createCodexAccessTokenProvider({
    failureCooldownMs: REFRESH_FAILURE_COOLDOWN_MS,
    getRefreshToken: async () => {
      const row = await hubDb.variables.findUnique({
        where: { key: CODEX_REFRESH_TOKEN_VAR },
      });
      return row?.value;
    },
    saveRefreshToken: async (refreshToken, priorToken) => {
      if (!priorToken) {
        // No prior persisted value to CAS against — the row was cleared
        // externally while we held an in-memory token. The supervisor is
        // the only legitimate seeder of new rows (device flow), so refuse
        // rather than resurrect the row the operator just removed.
        logService.log(
          `[Hub:OAuth] Refused to save rotated ${CODEX_REFRESH_TOKEN_VAR} — no prior persisted value (likely cleared externally).`,
        );
        return false;
      }
      // Compare-and-swap: only update if the row still holds the value we
      // rotated from. If a concurrent supervisor re-auth replaced it, the
      // count is 0 and we abort so the new account's value is preserved.
      const result = await hubDb.variables.updateMany({
        where: { key: CODEX_REFRESH_TOKEN_VAR, value: priorToken },
        data: {
          value: refreshToken,
          sensitive: true,
          export_to_shell: false,
          updated_by: "hub",
        },
      });
      if (result.count === 0) {
        logService.log(
          `[Hub:OAuth] Skipped save of rotated ${CODEX_REFRESH_TOKEN_VAR} — persisted value changed under us (likely re-auth).`,
        );
        return false;
      }
      // Pull the rotated value into the redaction set so any subsequent log
      // line that happens to contain it gets scrubbed before persistence.
      await redactionService.rebuildDbSecrets();
      logService.log(
        `[Hub:OAuth] Rotated ${CODEX_REFRESH_TOKEN_VAR} after OpenAI refresh`,
      );
      return true;
    },
  });

  naisysServer.registerEvent(
    HubEvents.CODEX_ACCESS_TOKEN_GET,
    async (hostId, data, ack) => {
      try {
        if (data.forceRefresh) {
          provider.invalidate();
        }
        const result = await provider.getAccessToken();
        if (!result) {
          ack({
            success: false,
            error: `Set ${CODEX_REFRESH_TOKEN_VAR} via Supervisor to enable OpenAI Codex.`,
          });
          return;
        }
        ack({
          success: true,
          accessToken: result.accessToken,
          expiresAt: result.expiresAt,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        logService.error(
          `[Hub:OAuth] Access-token mint failed for host ${hostId}: ${message}`,
        );
        ack({ success: false, error: message });
      }
    },
    CodexAccessTokenRequestSchema,
  );

  // External variable changes may include a fresh CODEX_REFRESH_TOKEN
  // (re-auth flow), so reset drops both caches AND the in-memory rotated
  // token — otherwise the in-memory override would shadow the new value.
  naisysServer.registerEvent(HubEvents.VARIABLES_CHANGED, () => {
    provider.reset();
  });

  // Exposed so other hub services (e.g. the cost service's codex usage check)
  // can mint a token through the same single-flight provider.
  return { getAccessToken: provider.getAccessToken };
}

export type HubCodexAuthService = ReturnType<
  typeof createHubCodexAuthService
>;
