import {
  AgentsStatusSchema,
  HEARTBEAT_INTERVAL_MS,
  HubEvents,
} from "@naisys/hub-protocol";

import { IAgentManager } from "../agent/agentManagerInterface.js";
import { UserService } from "../agent/userService.js";
import { HubClient } from "../hub/hubClient.js";

export function createHeartbeatService(
  hubClient: HubClient | undefined,
  agentManager: IAgentManager,
  userService: UserService,
) {
  // In hub mode, listen for agent status pushes from the hub
  if (hubClient) {
    hubClient.registerEvent(HubEvents.AGENTS_STATUS, (data: unknown) => {
      const parsed = AgentsStatusSchema.parse(data);
      userService.setActiveUsers(parsed.hostActiveAgents);
    });

    agentManager.onHeartbeatNeeded = sendHeartbeat;
  }

  function sendHeartbeat() {
    const activeUserIds = agentManager.runningAgents.map((a) => a.agentUserId);

    if (hubClient) {
      hubClient.sendMessage(HubEvents.HEARTBEAT, { activeUserIds });
    } else {
      userService.setActiveUsers({ "": activeUserIds });
    }
  }

  // Start periodic heartbeat
  const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

  function cleanup() {
    clearInterval(interval);
  }

  return { cleanup };
}
