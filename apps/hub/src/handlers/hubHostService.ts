import type { DualLogger } from "@naisys/common-node";
import type { HostList } from "@naisys/hub-protocol";
import { HubEvents } from "@naisys/hub-protocol";

import type { HostRegistrar } from "../services/hostRegistrar.js";
import type { NaisysConnection } from "../services/naisysConnection.js";
import type { NaisysServer } from "../services/naisysServer.js";
import { getHubVersion } from "../version.js";

/** Pushes the host list to all connections when connected hosts change */
export function createHubHostService(
  naisysServer: NaisysServer,
  hostRegistrar: HostRegistrar,
  logService: DualLogger,
) {
  let cachedHostListJson = "";

  function broadcastHostList(newConnection?: NaisysConnection) {
    // Index connected clients by hostId for O(1) lookup of online + version
    const clientByHostId = new Map(
      naisysServer
        .getConnectedClients()
        .map((c) => [c.getHostId(), c] as const),
    );

    const hosts = hostRegistrar.getAllHosts().map((h) => {
      const client = clientByHostId.get(h.hostId);
      return {
        hostId: h.hostId,
        hostName: h.hostName,
        machineId: h.machineId,
        restricted: h.restricted,
        hostType: h.hostType,
        online: !!client,
        version: client?.getClientVersion() || "",
      };
    });

    const payload: HostList = { hubVersion: getHubVersion(), hosts };
    const json = JSON.stringify(payload);

    // Send to the newly connecting client directly
    if (newConnection) {
      newConnection.sendMessage(HubEvents.HOSTS_UPDATED, payload);
    }

    // Broadcast to all connections only if the list changed
    // (new connection may get a harmless duplicate — HOSTS_UPDATED is idempotent)
    if (json !== cachedHostListJson) {
      cachedHostListJson = json;

      logService.log(
        `[Hub:Hosts] Broadcasting host list (${hosts.length} hosts)`,
      );

      naisysServer.broadcastToAll(HubEvents.HOSTS_UPDATED, payload);
    }
  }

  naisysServer.registerEvent(
    HubEvents.CLIENT_CONNECTED,
    (_hostId, connection) => {
      broadcastHostList(connection);
    },
  );

  naisysServer.registerEvent(HubEvents.HOSTS_CHANGED, async () => {
    logService.log("[Hub:Hosts] Received HOSTS_CHANGED, refreshing cache...");
    await hostRegistrar.refreshHosts();
    cachedHostListJson = ""; // Force broadcast
    broadcastHostList();
  });
}
