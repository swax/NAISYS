import { HostList, HubEvents } from "@naisys/hub-protocol";
import { HubServerLog } from "../services/hubServerLog.js";
import { NaisysServer } from "../services/naisysServer.js";

/** Pushes the host list to all NAISYS instances when connected hosts change */
export function createHubHostService(
  naisysServer: NaisysServer,
  logService: HubServerLog,
) {
  let cachedHostListJson = "";

  function pushHostListIfChanged() {
    const hosts = naisysServer.getConnectedClients().map((c) => ({
      hostId: c.getHostId(),
      hostName: c.getHostName(),
    }));

    const payload: HostList = { hosts };
    const json = JSON.stringify(payload);

    if (json === cachedHostListJson) {
      return;
    }

    cachedHostListJson = json;

    logService.log(
      `[HubHostService] Broadcasting host list (${hosts.length} hosts)`,
    );

    for (const connection of naisysServer.getConnectedClients()) {
      naisysServer.sendMessage(
        connection.getHostId(),
        HubEvents.HOST_LIST,
        payload,
      );
    }
  }

  naisysServer.registerEvent(
    HubEvents.CLIENT_CONNECTED,
    (_hostId: string) => {
      pushHostListIfChanged();
    },
  );
}
