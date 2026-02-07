import { HostListSchema, HubEvents } from "@naisys/hub-protocol";
import { HubClient } from "../hub/hubClient.js";

/** Receives HOST_LIST pushes from the hub and provides hostId → hostName lookups */
export function createHostService(hubClient: HubClient | undefined) {
  const hostMap = new Map<string, string>();

  if (hubClient) {
    hubClient.registerEvent(HubEvents.HOST_LIST, (data: unknown) => {
      const parsed = HostListSchema.parse(data);

      hostMap.clear();
      for (const host of parsed.hosts) {
        hostMap.set(host.hostId, host.hostName);
      }
    });
  }

  function getHostName(hostId: string): string | undefined {
    return hostMap.get(hostId);
  }

  return { getHostName };
}

export type HostService = ReturnType<typeof createHostService>;
