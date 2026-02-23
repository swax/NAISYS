import { HostList, HubEvents } from "@naisys/hub-protocol";

import { HostRegistrar } from "../services/hostRegistrar.js";
import { HubServerLog } from "../services/hubServerLog.js";
import { NaisysServer } from "../services/naisysServer.js";

/** Pushes the host list to all NAISYS instances when connected hosts change */
export function createHubHostService(
  naisysServer: NaisysServer,
  hostRegistrar: HostRegistrar,
  logService: HubServerLog,
) {
  let cachedHostListJson = "";

  naisysServer.registerEvent(HubEvents.CLIENT_CONNECTED, (hostId: number) => {
    const connectedHostIds = new Set(
      naisysServer.getConnectedClients().map((c) => c.getHostId()),
    );

    const hosts = hostRegistrar.getAllHosts().map((h) => ({
      ...h,
      online: connectedHostIds.has(h.hostId),
    }));

    const payload: HostList = { hosts };
    const json = JSON.stringify(payload);

    // Always send to the newly connecting client
    naisysServer.sendMessage<HostList>(
      hostId,
      HubEvents.HOSTS_UPDATED,
      payload,
    );

    // Broadcast to other existing connections only if the list changed
    if (json !== cachedHostListJson) {
      cachedHostListJson = json;

      logService.log(
        `[Hub:Hosts] Broadcasting host list (${hosts.length} hosts)`,
      );

      for (const connection of naisysServer.getConnectedClients()) {
        if (connection.getHostId() !== hostId) {
          naisysServer.sendMessage<HostList>(
            connection.getHostId(),
            HubEvents.HOSTS_UPDATED,
            payload,
          );
        }
      }
    }
  });
}
