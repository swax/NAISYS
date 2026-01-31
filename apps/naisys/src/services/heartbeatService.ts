import {
  HEARTBEAT_INTERVAL_MS,
  HeartbeatStatusSchema,
  HubEvents,
} from "@naisys/hub-protocol";
import { IAgentManager } from "../agent/agentManagerInterface.js";
import { UserService } from "../agent/userService.js";
import { GlobalConfig } from "../globalConfig.js";
import { HubClient } from "../hub/hubClient.js";

export function createHeartbeatService(
  { globalConfig }: GlobalConfig,
  hubClient: HubClient,
  agentManager: IAgentManager,
  userService: UserService,
) {
  const isHubMode = globalConfig().isHubMode;

  // In hub mode, listen for heartbeat status pushes from the hub
  if (isHubMode) {
    hubClient.registerEvent(HubEvents.HEARTBEAT_STATUS, (data: unknown) => {
      const parsed = HeartbeatStatusSchema.parse(data);
      userService.setActiveUserIds(parsed.activeUserIds);
    });
  }

  // Start periodic heartbeat
  const interval = setInterval(() => {
    const activeUserIds = agentManager.runningAgents.map((a) => a.agentUserId);

    if (isHubMode) {
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
