import { HostListSchema, HubEvents } from "@naisys/hub-protocol";
import table from "text-table";
import { GlobalConfig } from "../globalConfig.js";
import { HubClient } from "../hub/hubClient.js";

interface HostEntry {
  hostName: string;
  online: boolean;
}

/** Receives HOST_LIST pushes from the hub and provides hostId → hostName lookups */
export function createHostService(
  hubClient: HubClient | undefined,
  globalConfig: GlobalConfig,
) {
  const hostMap = new Map<number, HostEntry>();

  if (hubClient) {
    hubClient.registerEvent(HubEvents.HOST_LIST, (data: unknown) => {
      const parsed = HostListSchema.parse(data);

      hostMap.clear();

      for (const host of parsed.hosts) {
        hostMap.set(host.hostId, {
          hostName: host.hostName,
          online: host.online,
        });
      }
    });
  }

  function getHostName(hostId: number): string | undefined {
    return hostMap.get(hostId)?.hostName;
  }

  /** Resolve lazily — HOST_LIST may arrive before CONFIG */
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
    commandName: "ns-host",
    helpText: "List all known hosts and their status",
    isDebug: true,
    handleCommand,

    // HostService API
    getHostName,
    getLocalHostId,
    isHostActive,
  };
}

export type HostService = ReturnType<typeof createHostService>;
