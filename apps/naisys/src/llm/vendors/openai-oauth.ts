import { CODEX_REFRESH_TOKEN_VAR } from "@naisys/common";
import {
  type CodexAccessTokenProvider,
  createCodexAccessTokenProvider,
} from "@naisys/common-node";
import { HubEvents } from "@naisys/hub-protocol";

import type { GlobalConfig } from "../../globalConfig.js";
import type { HubClient } from "../../hub/hubClient.js";
import type { LlmMessage } from "../llmDtos.js";
import { sendWithOpenAiStandard } from "./openai-standard.js";
import type { QueryResult, QuerySources, VendorDeps } from "./vendorTypes.js";

// Standalone runs as a single-writer process, but multiple LLM services
// (parent + subagents) share .env and must single-flight rotation through
// one provider — otherwise concurrent refreshes burn the token lineage at
// OpenAI. Module-scoped so all callers in the process share state. Hub
// mode is stateless on the agent side (hub owns rotation).
let standaloneProvider: CodexAccessTokenProvider | undefined;

/**
 * Builds the function vendors call to obtain a Codex OAuth access token.
 *
 * - Hub mode: each call round-trips the hub; the hub is the single-flight
 *   authority and already caches minted tokens. No agent-side cache — the
 *   socket hop is negligible vs LLM latency.
 * - Standalone: rotate locally and persist the refresh token to .env. The
 *   process is single-writer (no concurrent supervisor) so the save path
 *   has no CAS to perform and always reports success.
 */
export function createCodexAccessTokenGetter(
  globalConfigService: GlobalConfig,
  hubClient: HubClient | undefined,
): (forceRefresh?: boolean) => Promise<string | undefined> {
  if (hubClient) {
    return async (forceRefresh) => {
      const response = await hubClient.sendRequest(
        HubEvents.CODEX_ACCESS_TOKEN_GET,
        forceRefresh ? { forceRefresh: true } : {},
      );
      if (!response.success || !response.accessToken) {
        throw new Error(
          response.error ?? "Hub did not return an OpenAI Codex access token.",
        );
      }
      return response.accessToken;
    };
  }

  if (!standaloneProvider) {
    standaloneProvider = createCodexAccessTokenProvider({
      getRefreshToken: () =>
        globalConfigService.globalConfig().variableMap[
          CODEX_REFRESH_TOKEN_VAR
        ],
      saveRefreshToken: (refreshToken) => {
        globalConfigService.setVariableValue(
          CODEX_REFRESH_TOKEN_VAR,
          refreshToken,
          { exportToShell: false },
        );
        return Promise.resolve(true);
      },
    });
  }
  const provider = standaloneProvider;

  return async (forceRefresh) => {
    if (forceRefresh) provider.invalidate();
    return (await provider.getAccessToken())?.accessToken;
  };
}

function isUnauthorizedError(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  return status === 401;
}

export async function sendWithOpenAiOauth(
  deps: VendorDeps,
  modelKey: string,
  systemMessage: string,
  context: LlmMessage[],
  source: QuerySources,
  abortSignal?: AbortSignal,
): Promise<QueryResult> {
  const accessToken = await deps.getCodexAccessToken();

  try {
    return await sendWithOpenAiStandard(
      deps,
      modelKey,
      systemMessage,
      context,
      source,
      accessToken,
      abortSignal,
    );
  } catch (err) {
    if (!isUnauthorizedError(err)) throw err;
    // Token rejected mid-life (revocation, account switch). Force-refresh
    // and retry once; a second 401 is fatal.
    const refreshedToken = await deps.getCodexAccessToken(true);
    return sendWithOpenAiStandard(
      deps,
      modelKey,
      systemMessage,
      context,
      source,
      refreshedToken,
      abortSignal,
    );
  }
}
