import {
  AgentsStatusSchema,
  HubEvents,
  NAISYS_HEARTBEAT_INTERVAL_MS,
} from "@naisys/hub-protocol";

import type { IAgentManager } from "../agent/agentManagerInterface.js";
import type { UserService } from "../agent/userService.js";
import type { HubClient } from "../hub/hubClient.js";

export function createHeartbeatService(
  hubClient: HubClient | undefined,
  agentManager: IAgentManager,
  userService: UserService,
) {
  // In hub mode, listen for agent status pushes from the hub
  if (hubClient) {
    hubClient.registerEvent(HubEvents.AGENTS_STATUS, (data) => {
      const parsed = AgentsStatusSchema.parse(data);
      userService.setActiveUsers(parsed.hostActiveAgents);
    });

    agentManager.onHeartbeatNeeded = sendHeartbeat;
  }

  function sendHeartbeat() {
    const activeSessions = agentManager.runningAgents.map((a) => ({
      userId: a.agentUserId,
      runId: a.getRunId(),
      sessionId: a.getSessionId(),
      paused: a.isPaused(),
    }));

    if (hubClient) {
      hubClient.sendMessage(HubEvents.HEARTBEAT, { activeSessions });
    } else {
      userService.setActiveUsers({ "": activeSessions.map((s) => s.userId) });
    }
  }

  // Start periodic heartbeat
  const interval = setInterval(sendHeartbeat, NAISYS_HEARTBEAT_INTERVAL_MS);

  function cleanup() {
    clearInterval(interval);
  }

  return { cleanup };
}
