import {
  HostListSchema,
  HostRegisteredSchema,
  HubEvents,
} from "@naisys/hub-protocol";
import table from "text-table";

import { hostCmd } from "../../command/commandDefs.js";
import type { HubClient } from "../../hub/hubClient.js";

interface HostEntry {
  hostName: string;
  restricted: boolean;
  hostType: string;
  online: boolean;
}

/** Receives HOSTS_UPDATED pushes from the hub and provides hostId → hostName lookups */
export function createHostService(hubClient: HubClient | undefined) {
  const hostMap = new Map<number, HostEntry>();
  let localHostId: number | undefined;

  if (hubClient) {
    // Capture our own hostId so we can label ourselves in HOSTS_UPDATED and ignore self-originated relays.
    hubClient.registerEvent(HubEvents.HOST_REGISTERED, (data) => {
      const registered = HostRegisteredSchema.parse(data);
      localHostId = registered.hostId;
    });

    hubClient.registerEvent(HubEvents.HOSTS_UPDATED, (data) => {
      const parsed = HostListSchema.parse(data);

      hostMap.clear();

      for (const host of parsed.hosts) {
        hostMap.set(host.hostId, {
          hostName: host.hostName,
          restricted: host.restricted,
          hostType: host.hostType,
          online: host.online,
        });
      }
    });
  }

  function getHostName(hostId: number): string | undefined {
    return hostMap.get(hostId)?.hostName;
  }

  function getLocalHostId(): number | undefined {
    return localHostId;
  }

  function isHostActive(hostId: number): boolean {
    return hostMap.get(hostId)?.online ?? false;
  }

  function hasNonRestrictedOnlineHost(): boolean {
    for (const entry of hostMap.values()) {
      if (entry.online && !entry.restricted && entry.hostType === "naisys")
        return true;
    }
    return false;
  }

  function handleCommand(): string {
    if (hostMap.size === 0) {
      return "No hosts registered";
    }

    const rows = Array.from(hostMap, ([hostId, entry]) => {
      const isLocal = hostId === localHostId;
      const name = isLocal ? `${entry.hostName} (local)` : entry.hostName;
      return [name, entry.online ? "Online" : "Offline"];
    });

    return table([["Host", "Status"], ...rows], { hsep: " | " });
  }

  return {
    // RegistrableCommand
    command: hostCmd,
    handleCommand,

    // HostService API
    getHostName,
    getLocalHostId,
    isHostActive,
    hasNonRestrictedOnlineHost,
  };
}

export type HostService = ReturnType<typeof createHostService>;
