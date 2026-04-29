import { HubEvents } from "@naisys/hub-protocol";

import type { AgentConfig } from "../agent/agentConfig.js";
import type { SubagentContext } from "../agent/agentManagerInterface.js";
import type { HubClient } from "../hub/hubClient.js";

export async function createRunService(
  { agentConfig }: AgentConfig,
  /** Host's hubClient for a main agent; parent's hubClient for a subagent
   * (the only hub access a subagent gets, scoped to SESSION_CREATE/INCREMENT). */
  sessionHubClient: HubClient | undefined,
  localUserId: number,
  subagentContext?: SubagentContext,
) {
  /** The run ID of an agent process (there could be multiple runs for the same user). Globally unique */
  let runId = -1;

  /** The session number, incremented when the agent calls ns-session compact */
  let sessionId = -1;

  await init();

  async function init() {
    if (sessionHubClient) {
      const response = await sessionHubClient.sendRequest(
        HubEvents.SESSION_CREATE,
        {
          userId: subagentContext?.parentUserId ?? localUserId,
          modelName: agentConfig().shellModel,
          subagentId: subagentContext?.subagentId,
          parentRunId: subagentContext?.parentRunId,
        },
      );

      if (!response.success) {
        throw new Error(`Failed to create session via hub: ${response.error}`);
      }

      runId = response.runId!;
      sessionId = response.sessionId!;
    } else {
      runId = subagentContext?.parentRunId ?? 1;
      sessionId = 1;
    }
  }

  async function incrementSession(): Promise<void> {
    if (sessionHubClient) {
      const response = await sessionHubClient.sendRequest(
        HubEvents.SESSION_INCREMENT,
        {
          userId: subagentContext?.parentUserId ?? localUserId,
          runId,
          subagentId: subagentContext?.subagentId,
          modelName: agentConfig().shellModel,
        },
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
