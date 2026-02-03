import {
  HEARTBEAT_INTERVAL_MS,
  HeartbeatStatusSchema,
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
  // In hub mode, listen for heartbeat status pushes from the hub
  if (hubClient) {
    hubClient.registerEvent(HubEvents.HEARTBEAT_STATUS, (data: unknown) => {
      const parsed = HeartbeatStatusSchema.parse(data);
      userService.setActiveUserIds(parsed.activeUserIds);
    });
  }

  // Start periodic heartbeat
  const interval = setInterval(() => {
    const activeUserIds = agentManager.runningAgents.map((a) => a.agentUserId);

    if (hubClient) {
      hubClient.sendMessage(HubEvents.HEARTBEAT, { activeUserIds });
    } else {
      userService.setActiveUserIds(activeUserIds);
    }
  }, HEARTBEAT_INTERVAL_MS);

  function cleanup() {
    clearInterval(interval);
  }

  return { cleanup };
}
