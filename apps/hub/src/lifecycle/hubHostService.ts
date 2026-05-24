import type { DualLogger } from "@naisys/common-node";
import type { HostList } from "@naisys/hub-protocol";
import { HostTerminateRequestSchema, HubEvents } from "@naisys/hub-protocol";

import type { NaisysConnection } from "../server/naisysConnection.js";
import type { NaisysServer } from "../server/naisysServer.js";
import { getHubVersion } from "../version.js";
import type { HostRegistrar } from "./hostRegistrar.js";

/** Pushes the host list to all connections when connected hosts change */
export function createHubHostService(
  naisysServer: NaisysServer,
  hostRegistrar: HostRegistrar,
  logService: DualLogger,
) {
  let cachedHostListJson = "";

  function broadcastHostList(newConnection?: NaisysConnection) {
    // Multiple supervisor sockets share one hostId; whichever wins the map slot is fine.
    const clientByHostId = new Map(
      [
        ...naisysServer.getConnectedClients(),
        ...naisysServer.getSupervisorConnections(),
      ].map((c) => [c.getHostId(), c] as const),
    );

    const hosts = hostRegistrar.getAllHosts().map((h) => {
      const client = clientByHostId.get(h.hostId);
      return {
        hostId: h.hostId,
        hostName: h.hostName,
        restricted: h.restricted,
        hostType: h.hostType,
        online: !!client,
        version: client?.getClientVersion() || "",
      };
    });

    const payload: HostList = { hubVersion: getHubVersion(), hosts };
    const json = JSON.stringify(payload);

    if (newConnection) {
      newConnection.sendMessage(HubEvents.HOSTS_UPDATED, payload);
    }

    // HOSTS_UPDATED is idempotent, so only fan out when the payload changed.
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

  naisysServer.registerEvent(HubEvents.CLIENT_DISCONNECTED, () => {
    broadcastHostList();
  });

  naisysServer.registerEvent(HubEvents.HOSTS_CHANGED, async () => {
    logService.log("[Hub:Hosts] Received HOSTS_CHANGED, refreshing cache...");
    await hostRegistrar.refreshHosts();
    cachedHostListJson = ""; // Force broadcast
    broadcastHostList();
  });

  // Relay a terminate request from the supervisor to the target host. The host
  // acks before it begins shutting down, so a successful ack means the request
  // was accepted — not that the process has fully exited yet.
  naisysServer.registerEvent(HubEvents.HOST_TERMINATE, (hostId, data, ack) => {
    try {
      const parsed = HostTerminateRequestSchema.parse(data);

      logService.log(
        `[Hub:Hosts] Relaying host_terminate for host ${parsed.hostId} (from ${hostId})`,
      );

      const sent = naisysServer.sendMessage(
        parsed.hostId,
        HubEvents.HOST_TERMINATE,
        { hostId: parsed.hostId, sourceHostId: hostId },
        (response) => ack(response),
      );

      if (!sent) {
        ack({
          success: false,
          error: `Host ${parsed.hostId} is not connected`,
        });
      }
    } catch (error) {
      logService.error(
        `[Hub:Hosts] host_terminate error from host ${hostId}: ${error}`,
      );
      ack({ success: false, error: String(error) });
    }
  });
}
