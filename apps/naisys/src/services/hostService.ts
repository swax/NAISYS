import { HostListSchema, HubEvents } from "@naisys/hub-protocol";
import table from "text-table";

import { hostCmd } from "../command/commandDefs.js";
import { GlobalConfig } from "../globalConfig.js";
import { HubClient } from "../hub/hubClient.js";

interface HostEntry {
  hostName: string;
  restricted: boolean;
  online: boolean;
}

/** Receives HOSTS_UPDATED pushes from the hub and provides hostId → hostName lookups */
export function createHostService(
  hubClient: HubClient | undefined,
  globalConfig: GlobalConfig,
) {
  const hostMap = new Map<number, HostEntry>();

  if (hubClient) {
    hubClient.registerEvent(HubEvents.HOSTS_UPDATED, (data: unknown) => {
      const parsed = HostListSchema.parse(data);

      hostMap.clear();

      for (const host of parsed.hosts) {
        hostMap.set(host.hostId, {
          hostName: host.hostName,
          restricted: host.restricted,
          online: host.online,
        });
      }
    });
  }

  function getHostName(hostId: number): string | undefined {
    return hostMap.get(hostId)?.hostName;
  }

  /** Resolve lazily — HOSTS_UPDATED may arrive before VARIABLES_UPDATED */
  function getLocalHostId(): number | undefined {
    const localHostName = globalConfig.globalConfig()?.hostname;
    if (!localHostName) return undefined;

    for (const [hostId, entry] of hostMap) {
      if (entry.hostName === localHostName) return hostId;
    }
    return undefined;
  }

  function isHostActive(hostId: number): boolean {
    return hostMap.get(hostId)?.online ?? false;
  }

  function hasNonRestrictedOnlineHost(): boolean {
    for (const entry of hostMap.values()) {
      if (entry.online && !entry.restricted) return true;
    }
    return false;
  }

  function handleCommand(): string {
    if (hostMap.size === 0) {
      return "No hosts registered";
    }

    const localHostId = getLocalHostId();

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
