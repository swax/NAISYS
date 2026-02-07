import { HostListSchema, HubEvents } from "@naisys/hub-protocol";
import { GlobalConfig } from "../globalConfig.js";
import { HubClient } from "../hub/hubClient.js";

/** Receives HOST_LIST pushes from the hub and provides hostId → hostName lookups */
export function createHostService(
  hubClient: HubClient | undefined,
  globalConfig: GlobalConfig,
) {
  const hostMap = new Map<string, string>();
  let localHostId: string | undefined;

  if (hubClient) {
    hubClient.registerEvent(HubEvents.HOST_LIST, (data: unknown) => {
      const parsed = HostListSchema.parse(data);

      hostMap.clear();
      localHostId = undefined;

      const localHostName = globalConfig.globalConfig()?.hostname;

      for (const host of parsed.hosts) {
        hostMap.set(host.hostId, host.hostName);

        if (localHostName && host.hostName === localHostName) {
          localHostId = host.hostId;
        }
      }
    });
  }

  function getHostName(hostId: string): string | undefined {
    return hostMap.get(hostId);
  }

  function getLocalHostId(): string | undefined {
    return localHostId;
  }

  return { getHostName, getLocalHostId };
}

export type HostService = ReturnType<typeof createHostService>;
