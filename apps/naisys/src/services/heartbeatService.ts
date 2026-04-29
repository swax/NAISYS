import type { HeartbeatSession } from "@naisys/hub-protocol";
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
    // Ephemerals ride under the parent's userId so the synthetic id never
    // enters hub-user tracking. The subagentId still distinguishes the row.
    // Skip an entry rather than ever emitting a synthetic id as `userId`.
    const activeSessions: HeartbeatSession[] = [];
    for (const a of agentManager.runningAgents) {
      const user = userService.getUserById(a.agentUserId);
      let userId: number;
      let subagentId: number | undefined;
      if (user?.isEphemeral) {
        if (user.leadUserId == null) continue; // orphan ephemeral — shouldn't happen
        userId = user.leadUserId;
        subagentId = a.agentUserId;
      } else {
        // Negative agentUserId without an isEphemeral user record means we're
        // racing teardown (user record cleared before splice). Drop it.
        if (a.agentUserId < 0) continue;
        userId = a.agentUserId;
      }
      activeSessions.push({
        userId,
        runId: a.getRunId(),
        subagentId,
        sessionId: a.getSessionId(),
        paused: a.isPaused(),
        state: a.getState(),
      });
    }

    if (hubClient) {
      hubClient.sendMessage(HubEvents.HEARTBEAT, { activeSessions });
    } else {
      const uniqueUserIds = [...new Set(activeSessions.map((s) => s.userId))];
      userService.setActiveUsers({ "": uniqueUserIds });
    }
  }

  // Start periodic heartbeat
  const interval = setInterval(sendHeartbeat, NAISYS_HEARTBEAT_INTERVAL_MS);

  function cleanup() {
    clearInterval(interval);
  }

  return { cleanup };
}
