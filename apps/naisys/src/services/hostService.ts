import {
  HostListSchema,
  HostRegisteredSchema,
  HubEvents,
} from "@naisys/hub-protocol";
import table from "text-table";

import { hostCmd } from "../command/commandDefs.js";
import type { GlobalConfig } from "../globalConfig.js";
import type { HubClient } from "../hub/hubClient.js";
import type { HubClientConfig } from "../hub/hubClientConfig.js";
import type { PromptNotificationService } from "../utils/promptNotificationService.js";

interface HostEntry {
  hostName: string;
  machineId: string;
  restricted: boolean;
  hostType: string;
  online: boolean;
}

/** Receives HOSTS_UPDATED pushes from the hub and provides hostId → hostName lookups */
export function createHostService(
  hubClient: HubClient | undefined,
  hubClientConfig: HubClientConfig | undefined,
  globalConfig: GlobalConfig,
  promptNotification: PromptNotificationService,
) {
  const hostMap = new Map<number, HostEntry>();
  let localMachineId = hubClientConfig?.machineId ?? "";

  if (hubClient) {
    // Handle HOST_REGISTERED — store machineId if we didn't have one
    hubClient.registerEvent(HubEvents.HOST_REGISTERED, (data) => {
      const registered = HostRegisteredSchema.parse(data);
      localMachineId = registered.machineId;
      globalConfig.updateEnvValue("NAISYS_MACHINE_ID", registered.machineId);
      globalConfig.updateEnvValue("NAISYS_HOSTNAME", registered.hostName);
    });

    hubClient.registerEvent(HubEvents.HOSTS_UPDATED, (data) => {
      const parsed = HostListSchema.parse(data);

      hostMap.clear();

      for (const host of parsed.hosts) {
        hostMap.set(host.hostId, {
          hostName: host.hostName,
          machineId: host.machineId,
          restricted: host.restricted,
          hostType: host.hostType,
          online: host.online,
        });

        // Detect hostname rename: if this is our machineId but a different name
        if (
          localMachineId &&
          host.machineId === localMachineId &&
          host.hostName !== process.env.NAISYS_HOSTNAME
        ) {
          const oldName = process.env.NAISYS_HOSTNAME;
          globalConfig.updateEnvValue("NAISYS_HOSTNAME", host.hostName);
          if (oldName) {
            promptNotification.notify({
              wake: "always",
              commentOutput: [
                `Hostname changed: ${oldName} → ${host.hostName}`,
              ],
            });
          }
        }
      }
    });
  }

  function getHostName(hostId: number): string | undefined {
    return hostMap.get(hostId)?.hostName;
  }

  /** Resolve lazily — HOSTS_UPDATED may arrive before VARIABLES_UPDATED */
  function getLocalHostId(): number | undefined {
    if (localMachineId) {
      for (const [hostId, entry] of hostMap) {
        if (entry.machineId === localMachineId) return hostId;
      }
    }

    // Fallback to hostname match
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
      if (entry.online && !entry.restricted && entry.hostType === "naisys")
        return true;
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
