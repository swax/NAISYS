import { loadHubConfig } from "@naisys/common";
import { ConfigResponse, HubEvents } from "@naisys/hub-protocol";
import { HubServerLog } from "../services/hubServerLog.js";
import { NaisysServer } from "../services/naisysServer.js";

/** Pushes the global config to NAISYS instances when they connect */
export function createHubConfigService(
  naisysServer: NaisysServer,
  logService: HubServerLog,
) {
  const hubConfig = loadHubConfig();

  naisysServer.registerEvent(HubEvents.CLIENT_CONNECTED, (hostId: number) => {
    try {
      logService.log(
        `[HubConfigService] Pushing config to naisys instance ${hostId}`,
      );

      naisysServer.sendMessage(hostId, HubEvents.CONFIG, {
        success: true,
        config: hubConfig,
      } satisfies ConfigResponse);
    } catch (error) {
      logService.error(
        `[HubConfigService] Error sending config to naisys instance ${hostId}: ${error}`,
      );
      naisysServer.sendMessage(hostId, HubEvents.CONFIG, {
        success: false,
        error: String(error),
      });
    }
  });
}
