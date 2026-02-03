import {
  HubEvents,
  SessionCreateResponse,
  SessionIncrementResponse,
} from "@naisys/hub-protocol";
import { AgentConfig } from "../agent/agentConfig.js";
import { GlobalConfig } from "../globalConfig.js";
import { HubClient } from "../hub/hubClient.js";

export async function createRunService(
  { agentConfig }: AgentConfig,
  { globalConfig }: GlobalConfig,
  hubClient: HubClient | undefined,
  localUserId: string,
) {

  /** The run ID of an agent process (there could be multiple runs for the same user). Globally unique */
  let runId = -1;

  /** The session number, incremented when the agent calls ns-session compact */
  let sessionId = -1;

  await init();

  async function init() {
    if (hubClient) {
      const response = await hubClient.sendRequest<SessionCreateResponse>(
        HubEvents.SESSION_CREATE,
        { userId: localUserId, modelName: agentConfig().shellModel },
      );

      if (!response.success) {
        throw new Error(`Failed to create session via hub: ${response.error}`);
      }

      runId = response.runId!;
      sessionId = response.sessionId!;
    } else {
      runId = 1;
      sessionId = 1;
    }
  }

  async function incrementSession(): Promise<void> {
    if (hubClient) {
      const response = await hubClient.sendRequest<SessionIncrementResponse>(
        HubEvents.SESSION_INCREMENT,
        { userId: localUserId, runId },
      );

      if (!response.success) {
        throw new Error(
          `Failed to increment session via hub: ${response.error}`,
        );
      }

      sessionId = response.sessionId!;
    } else {
      sessionId++;
    }
  }

  return {
    incrementSession,
    getRunId: () => runId,
    getSessionId: () => sessionId,
  };
}

export type RunService = Awaited<ReturnType<typeof createRunService>>;
