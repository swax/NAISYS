import type {
  VoiceCostRequest,
  VoiceCostResponse,
  VoiceMode,
  VoiceTokenRequest,
  VoiceTokenResponse,
  VoiceToolCallRequest,
  VoiceToolCallResponse,
  VoiceUsage,
} from "./apiClient";
import { api, apiEndpoints } from "./apiClient";

/**
 * Client API for the voice agent feature. The realtime session runs in the
 * browser (see VoiceSessionContext); these wrappers talk to the supervisor's
 * thin action backend. See docs/019-voice-agent.md.
 */

/** Mint an ephemeral gpt-realtime session token. `fromUsername` is X — the
 *  page's `{agent}` perspective the session speaks as; `targetUsername` is Y —
 *  the agent being operated. `mode` scopes the baked tools and instructions.
 *  Throws on failure (caller surfaces the error). */
export const mintVoiceToken = async (
  fromUsername: string,
  targetUsername: string,
  mode: VoiceMode,
): Promise<VoiceTokenResponse> => {
  return await api.post<VoiceTokenRequest, VoiceTokenResponse>(
    apiEndpoints.voiceToken(fromUsername),
    { targetUsername, mode },
  );
};

/** Forward a voice-agent tool call to the server bridge for execution. Never
 *  throws — auth/transport failures are normalized into a tool result so the
 *  realtime model can narrate them back to the operator. */
export const executeVoiceTool = async (
  fromUsername: string,
  call: VoiceToolCallRequest,
): Promise<VoiceToolCallResponse> => {
  try {
    return await api.post<VoiceToolCallRequest, VoiceToolCallResponse>(
      apiEndpoints.voiceTool(fromUsername),
      call,
    );
  } catch (error) {
    return {
      success: false,
      result:
        error instanceof Error
          ? error.message
          : "The tool call could not be completed.",
    };
  }
};

/** Push one `response.done` turn's usage for cost recording. The server
 *  requires a minted `voiceSessionId` so cost rows can't be forged by a
 *  session-less user. Failures are normalized to `{ success: false }`; the
 *  caller hangs up on any non-success so the model can't burn untracked
 *  tokens after accounting has stopped working. */
export const recordVoiceCost = async (
  fromUsername: string,
  voiceSessionId: string,
  usage: VoiceUsage,
): Promise<VoiceCostResponse> => {
  try {
    return await api.post<VoiceCostRequest, VoiceCostResponse>(
      apiEndpoints.voiceCost(fromUsername),
      { voiceSessionId, usage },
    );
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Cost recording failed.",
    };
  }
};
