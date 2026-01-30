import {
  HEARTBEAT_INTERVAL_MS,
  HeartbeatStatusSchema,
  HubEvents,
} from "@naisys/hub-protocol";
import { IAgentRunner } from "../agent/agentRunnerInterface.js";
import { UserService } from "../agent/userService.js";
import { GlobalConfig } from "../globalConfig.js";
import { HubClient } from "../hub/hubClient.js";

export function createHeartbeatService(
  { globalConfig }: GlobalConfig,
  hubClient: HubClient,
  agentRunner: IAgentRunner,
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
    const activeUserIds = agentRunner.runningAgents.map((a) => a.agentUserId);

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
